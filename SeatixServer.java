package com.seatix;

import com.seatix.service.BookingService;
import com.seatix.model.ScreenInterior;
import com.seatix.service.ScreenInteriorService;
import com.seatix.service.BookingService.BookingException;
import com.seatix.service.BookingService.CreatedBooking;
import com.seatix.service.BookingService.PaymentResult;
import com.seatix.service.BookingService.RequestedSeat;
import com.seatix.service.PaymentQrService;
import com.seatix.database.DatabaseConnection;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class SeatixServer {
    private static final int MAX_REQUEST_BYTES = 16_384;
    private static final Pattern PAYMENT_PATH = Pattern.compile("^/api/bookings/(\\d+)/payment$");
    private static final Pattern PAYMENT_QR_PATH = Pattern.compile("^/api/bookings/(\\d+)/payment/qr$");
    private static final Pattern BYTE_RANGE = Pattern.compile("^bytes=(\\d*)-(\\d*)$");

    private SeatixServer() {}

    public static void main(String[] args) throws IOException {
        int port = resolvePort(args);
        String host = System.getenv().getOrDefault("SEATIX_HOST", "127.0.0.1");
        HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 0);
        ExecutorService executor = Executors.newFixedThreadPool(8);
        server.setExecutor(executor);
        server.createContext("/", SeatixServer::handleRequest);
        server.start();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.stop(0);
            executor.shutdown();
        }));
        System.out.println("Seatix is running at http://localhost:" + port);
    }

    private static int resolvePort(String[] args) {
        String configuredPort = args.length > 0
                ? args[0]
                : System.getenv().getOrDefault("SEATIX_PORT", System.getenv("PORT"));
        int port = configuredPort == null || configuredPort.isBlank()
                ? 8080
                : Integer.parseInt(configuredPort);
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("SEATIX_PORT must be between 1 and 65535.");
        }
        return port;
    }

    private static void handleRequest(HttpExchange exchange) throws IOException {
        String method = exchange.getRequestMethod();
        String path = exchange.getRequestURI().getPath();
        if ("GET".equals(method) && "/api/health".equals(path)) {
            respondJson(exchange, 200, "{\"status\":\"ok\",\"payment\":\"SIMULATED\",\"database\":"
                    + jsonString(databaseStatus()) + "}");
            return;
        }
        if ("GET".equals(method) && "/api/screens/interiors".equals(path)) {
            handleScreenInteriors(exchange);
            return;
        }
        if ("POST".equals(method)) {
            if (!isSameOriginRequest(exchange)) {
                respondJson(exchange, 403, jsonError("Cross-origin booking requests are not allowed."));
                return;
            }
            if ("/api/bookings".equals(path)) {
                handleCreateBooking(exchange);
                return;
            }
            Matcher paymentPath = PAYMENT_PATH.matcher(path == null ? "" : path);
            if (paymentPath.matches()) {
                handlePayment(exchange, paymentPath.group(1));
                return;
            }
            Matcher paymentQrPath = PAYMENT_QR_PATH.matcher(path == null ? "" : path);
            if (paymentQrPath.matches()) {
                handlePaymentQr(exchange, paymentQrPath.group(1));
                return;
            }
            if ("/api/payment-qr/scan".equals(path)) {
                handlePaymentQrScan(exchange);
                return;
            }
        }
        if (!method.equals("GET") && !method.equals("HEAD")) {
            exchange.getResponseHeaders().set("Allow", "GET, HEAD, POST");
            respond(exchange, 405, "text/plain; charset=utf-8", "Method not allowed.".getBytes(StandardCharsets.UTF_8));
            return;
        }

        if ("/api/health".equals(path)) {
            respondJson(exchange, 405, "{\"error\":\"Use GET for the service health endpoint.\"}");
            return;
        }
        if (path == null || path.contains("\\") || path.contains("\0") || containsParentDirectory(path)) {
            respond(exchange, 400, "text/plain; charset=utf-8", "Invalid path.".getBytes(StandardCharsets.UTF_8));
            return;
        }

        String resourcePath = "/web" + (path.equals("/") ? "/index.html" : path);
        try (InputStream resource = SeatixServer.class.getResourceAsStream(resourcePath)) {
            if (resource == null) {
                respond(exchange, 404, "text/plain; charset=utf-8", "Not found.".getBytes(StandardCharsets.UTF_8));
                return;
            }
            Headers headers = exchange.getResponseHeaders();
            headers.set("X-Content-Type-Options", "nosniff");
            headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
            headers.set("Content-Security-Policy",
                    "default-src 'self'; img-src 'self'; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
            respondStaticResource(exchange, path, resource.readAllBytes());
        } finally {
            exchange.close();
        }
    }

    private static void handleCreateBooking(HttpExchange exchange) throws IOException {
        if (!isConfiguredForPayment(exchange)) return;
        try {
            Map<String, String> form = parseRequestForm(exchange);
            LocalDate showDate = LocalDate.parse(required(form, "date"));
            LocalTime showTime = LocalTime.parse(required(form, "time"));
            List<RequestedSeat> seats = parseSeats(required(form, "seats"));
            CreatedBooking booking = BookingService.create(required(form, "movie"), required(form, "layout"),
                    showDate, showTime, required(form, "phone"), required(form, "email"), seats);
            respondJson(exchange, 201, "{\"bookingId\":" + booking.bookingId()
                    + ",\"bookingStatus\":\"" + booking.bookingStatus()
                    + "\",\"paymentStatus\":\"PENDING\",\"total\":" + booking.total()
                    + ",\"seats\":" + jsonArray(booking.seats()) + "}");
        } catch (BookingException exception) {
            respondJson(exchange, exception.statusCode(), jsonError(exception.getMessage()));
        } catch (DateTimeParseException exception) {
            respondJson(exchange, 400, jsonError("The show date or time is invalid."));
        } catch (IllegalArgumentException exception) {
            respondJson(exchange, 400, jsonError(exception.getMessage()));
        } catch (IllegalStateException exception) {
            respondJson(exchange, 503, jsonError(exception.getMessage()));
        } catch (SQLException exception) {
            reportDatabaseError("Could not create Seatix booking.", exception);
            if (exception.getErrorCode() == 1062) {
                respondJson(exchange, 409, jsonError("One or more seats were just booked. Refresh seat availability and try again."));
            } else {
                respondJson(exchange, databaseUnavailable(exception) ? 503 : 500,
                        jsonError(databaseUnavailable(exception)
                                ? "Seatix could not connect to PostgreSQL. Check the database settings and try again."
                                : "Seatix could not save the booking. No payment has been processed."));
            }
        }
    }

    private static void handleScreenInteriors(HttpExchange exchange) throws IOException {
        try {
            String body = ScreenInteriorService.loadAll().stream()
                    .map(SeatixServer::screenInteriorJson)
                    .collect(java.util.stream.Collectors.joining(",", "[", "]"));
            respondJson(exchange, 200, body);
        } catch (IllegalStateException exception) {
            respondJson(exchange, 503, jsonError(exception.getMessage()));
        } catch (SQLException exception) {
            reportDatabaseError("Could not load Seatix screen interiors.", exception);
            respondJson(exchange, databaseUnavailable(exception) ? 503 : 500,
                    jsonError(databaseUnavailable(exception)
                            ? "Seatix could not connect to PostgreSQL while loading screen interiors."
                            : "Seatix could not load screen interiors from PostgreSQL."));
        }
    }

    private static String screenInteriorJson(ScreenInterior interior) {
        return "{\"screenCode\":" + jsonString(interior.screenCode())
                + ",\"screenName\":" + jsonString(interior.screenName())
                + ",\"screenType\":" + jsonString(interior.screenType())
                + ",\"aspectRatio\":" + interior.aspectRatio()
                + ",\"wallColor\":" + jsonString(interior.wallColor())
                + ",\"ceilingColor\":" + jsonString(interior.ceilingColor())
                + ",\"trimColor\":" + jsonString(interior.trimColor())
                + ",\"accentColor\":" + jsonString(interior.accentColor())
                + ",\"seatColor\":" + jsonString(interior.seatColor())
                + ",\"aisleLightColor\":" + jsonString(interior.aisleLightColor())
                + ",\"wallSlatCount\":" + interior.wallSlatCount()
                + ",\"ceilingStarCount\":" + interior.ceilingStarCount()
                + ",\"ringLightCount\":" + interior.ringLightCount() + "}";
    }

    private static void handlePayment(HttpExchange exchange, String bookingIdValue) throws IOException {
            if (!isConfiguredForPayment(exchange)) return;
            try {
                long bookingId = Long.parseLong(bookingIdValue);
                Map<String, String> form = parseRequestForm(exchange);
                String outcome = required(form, "outcome");
                if (!outcome.equals("success") && !outcome.equals("failed")) {
                    throw new IllegalArgumentException("Choose a supported simulated payment outcome.");
                }
                PaymentResult result = BookingService.simulatePayment(bookingId, outcome.equals("success"));
                respondJson(exchange, 200, "{\"bookingId\":" + result.bookingId()
                        + ",\"bookingStatus\":\"" + result.bookingStatus()
                        + "\",\"paymentStatus\":\"" + result.paymentStatus()
                        + "\",\"total\":" + result.amount().toPlainString() + "}");
            } catch (BookingException exception) {
                respondJson(exchange, exception.statusCode(), jsonError(exception.getMessage()));
            } catch (IllegalArgumentException exception) {
                respondJson(exchange, 400, jsonError(exception.getMessage()));
            } catch (IllegalStateException exception) {
                respondJson(exchange, 503, jsonError(exception.getMessage()));
            } catch (SQLException exception) {
                reportDatabaseError("Could not update Seatix payment status.", exception);
                respondJson(exchange, databaseUnavailable(exception) ? 503 : 500,
                        jsonError(databaseUnavailable(exception)
                                ? "Seatix could not connect to PostgreSQL. The payment remains unchanged."
                                : "Seatix could not update the payment status."));
            }
        }

    private static void handlePaymentQr(HttpExchange exchange, String bookingIdValue) throws IOException {
        if (!isConfiguredForPayment(exchange)) return;
        try {
            long bookingId = Long.parseLong(bookingIdValue);
            byte[] image = PaymentQrService.issueQr(bookingId);
            respond(exchange, 201, "image/png", image);
        } catch (BookingException exception) {
            respondJson(exchange, exception.statusCode(), jsonError(exception.getMessage()));
        } catch (IllegalArgumentException exception) {
            respondJson(exchange, 400, jsonError("The booking reference is invalid."));
        } catch (IllegalStateException exception) {
            respondJson(exchange, 503, jsonError(exception.getMessage()));
        } catch (SQLException exception) {
            reportDatabaseError("Could not issue a Seatix demo payment QR code.", exception);
            respondJson(exchange, databaseUnavailable(exception) ? 503 : 500,
                    jsonError(databaseUnavailable(exception)
                            ? "Seatix could not connect to PostgreSQL to issue the payment QR code."
                            : "Seatix could not issue the payment QR code."));
        }
    }

    private static void handlePaymentQrScan(HttpExchange exchange) throws IOException {
        if (!isConfiguredForPayment(exchange)) return;
        try {
            Map<String, String> form = parseRequestForm(exchange);
            String payload = form.get("payload");
            if (payload == null || payload.isBlank()) {
                throw new IllegalArgumentException("The scanned QR payload is required.");
            }
            PaymentResult result = PaymentQrService.recordScan(payload);
            respondJson(exchange, 200, "{\"bookingId\":" + result.bookingId()
                    + ",\"bookingStatus\":\"" + result.bookingStatus()
                    + "\",\"paymentStatus\":\"" + result.paymentStatus()
                    + "\",\"total\":" + result.amount().toPlainString() + "}");
        } catch (BookingException exception) {
            respondJson(exchange, exception.statusCode(), jsonError(exception.getMessage()));
        } catch (IllegalArgumentException exception) {
            respondJson(exchange, 400, jsonError(exception.getMessage()));
        } catch (IllegalStateException exception) {
            respondJson(exchange, 503, jsonError(exception.getMessage()));
        } catch (SQLException exception) {
            reportDatabaseError("Could not record a Seatix demo payment QR scan.", exception);
            respondJson(exchange, databaseUnavailable(exception) ? 503 : 500,
                    jsonError(databaseUnavailable(exception)
                            ? "Seatix could not connect to PostgreSQL to record the QR scan."
                            : "Seatix could not record the QR scan."));
        }
    }

    private static boolean isConfiguredForPayment(HttpExchange exchange) throws IOException {
            if (DatabaseConnection.isConfigured()) return true;
            respondJson(exchange, 503, jsonError(
                    "PostgreSQL is not configured. Set SEATIX_DB_USER and SEATIX_DB_PASSWORD before starting Seatix."));
            return false;
        }

        private static String databaseStatus() {
            if (!DatabaseConnection.isConfigured()) return "not_configured";
            try (Connection connection = DatabaseConnection.open()) {
                return connection.isValid(2) ? "connected" : "unavailable";
            } catch (SQLException exception) {
                reportDatabaseError("Seatix health check could not connect to PostgreSQL.", exception);
                return "unavailable";
            }
        }

        private static boolean isSameOriginRequest(HttpExchange exchange) {
            String origin = exchange.getRequestHeaders().getFirst("Origin");
            String hostHeader = exchange.getRequestHeaders().getFirst("Host");
            return isSameOrigin(origin, hostHeader);
        }

        static boolean isSameOrigin(String origin, String hostHeader) {
            if (origin == null || origin.isBlank()) return true;
            try {
                java.net.URI originUri = java.net.URI.create(origin);
                if (hostHeader == null || hostHeader.isBlank()
                        || originUri.getHost() == null
                        || originUri.getRawPath() != null && !originUri.getRawPath().isEmpty()
                        || originUri.getRawQuery() != null
                        || originUri.getRawFragment() != null
                        || originUri.getRawUserInfo() != null
                        || !("http".equalsIgnoreCase(originUri.getScheme())
                        || "https".equalsIgnoreCase(originUri.getScheme()))) {
                    return false;
                }

                java.net.URI requestUri = java.net.URI.create("http://" + hostHeader);
                if (requestUri.getHost() == null
                        || requestUri.getRawUserInfo() != null
                        || requestUri.getRawPath() != null && !requestUri.getRawPath().isEmpty()
                        || requestUri.getRawQuery() != null
                        || requestUri.getRawFragment() != null
                        || !originUri.getHost().equalsIgnoreCase(requestUri.getHost())) {
                    return false;
                }

                int originPort = originUri.getPort() >= 0 ? originUri.getPort()
                        : "https".equalsIgnoreCase(originUri.getScheme()) ? 443 : 80;
                int requestPort = requestUri.getPort();
                return requestPort >= 0
                        ? originPort == requestPort
                        : originPort == 80 || originPort == 443;
            } catch (IllegalArgumentException exception) {
                return false;
            }
        }

    private static Map<String, String> parseRequestForm(HttpExchange exchange) throws IOException {
            String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
            if (contentType == null || !contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
                throw new IllegalArgumentException("Expected an application/x-www-form-urlencoded request.");
            }
            byte[] body;
            try (InputStream input = exchange.getRequestBody()) {
                body = input.readNBytes(MAX_REQUEST_BYTES + 1);
            }
            if (body.length > MAX_REQUEST_BYTES) {
                throw new IllegalArgumentException("The booking request is too large.");
            }
            Map<String, String> values = new HashMap<>();
            for (String pair : new String(body, StandardCharsets.UTF_8).split("&")) {
                int separator = pair.indexOf('=');
                String key = URLDecoder.decode(separator < 0 ? pair : pair.substring(0, separator), StandardCharsets.UTF_8);
                String value = URLDecoder.decode(separator < 0 ? "" : pair.substring(separator + 1), StandardCharsets.UTF_8);
                if (values.putIfAbsent(key, value) != null) {
                    throw new IllegalArgumentException("Duplicate booking fields are not allowed.");
                }
            }
            return values;
        }

    private static List<RequestedSeat> parseSeats(String seatsValue) {
            List<RequestedSeat> seats = new ArrayList<>();
            for (String item : seatsValue.split(",", -1)) {
                String[] fields = item.split(":", -1);
                if (fields.length != 3 || !fields[1].matches("[A-Z]{1,2}") || !fields[2].matches("\\d{1,2}")) {
                    throw new IllegalArgumentException("The selected seat list is invalid.");
                }
                String section = fields[0];
                if (!section.equals("IMAX") && !section.equals("Standard") && !section.equals("Orchestra")
                        && !section.equals("Mezzanine") && !section.equals("Balcony")) {
                    throw new IllegalArgumentException("The selected seat section is invalid.");
                }
                seats.add(new RequestedSeat(section, fields[1], Integer.parseInt(fields[2])));
            }
            return seats;
        }

    private static String required(Map<String, String> form, String name) {
            String value = form.get(name);
            if (value == null || value.isBlank()) {
                throw new IllegalArgumentException("Missing required booking field: " + name + ".");
            }
            return value;
        }

    private static String jsonArray(List<String> values) {
            return values.stream().map(SeatixServer::jsonString).collect(java.util.stream.Collectors.joining(",", "[", "]"));
        }

    private static String jsonString(String value) {
            StringBuilder escaped = new StringBuilder("\"");
            for (char character : value.toCharArray()) {
                switch (character) {
                    case '"' -> escaped.append("\\\"");
                    case '\\' -> escaped.append("\\\\");
                    case '\n' -> escaped.append("\\n");
                    case '\r' -> escaped.append("\\r");
                    case '\t' -> escaped.append("\\t");
                    default -> {
                        if (character < 0x20) escaped.append(String.format("\\u%04x", (int) character));
                        else escaped.append(character);
                    }
                }
            }
            return escaped.append('"').toString();
        }

    private static String jsonError(String message) {
            return "{\"error\":" + jsonString(message) + "}";
        }

    private static void respondJson(HttpExchange exchange, int status, String body) throws IOException {
            respond(exchange, status, "application/json; charset=utf-8", body.getBytes(StandardCharsets.UTF_8));
        }

    private static boolean databaseUnavailable(SQLException exception) {
            return exception.getSQLState() != null && exception.getSQLState().startsWith("08");
        }

    private static void reportDatabaseError(String message, SQLException exception) {
            System.err.println(message + " SQLState=" + exception.getSQLState() + " errorCode=" + exception.getErrorCode());
            exception.printStackTrace(System.err);
        }
    private static boolean containsParentDirectory(String path) {
        for (String segment : path.split("/")) {
            if (segment.equals("..")) {
                return true;
            }
        }
        return false;
    }

    private static String contentType(String path) {
        if (path.equals("/") || path.equals("/index.html")) return "text/html; charset=utf-8";
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (path.endsWith(".json")) return "application/json; charset=utf-8";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".mp4")) return "video/mp4";
        return "application/octet-stream";
    }

    private static void respondStaticResource(HttpExchange exchange, String path, byte[] body) throws IOException {
        String type = contentType(path);
        boolean headRequest = exchange.getRequestMethod().equals("HEAD");
        Headers headers = exchange.getResponseHeaders();
        if (path.endsWith(".mp4")) {
            headers.set("Accept-Ranges", "bytes");
            String rangeHeader = exchange.getRequestHeaders().getFirst("Range");
            if (rangeHeader != null) {
                try {
                    ByteRange range = parseByteRange(rangeHeader, body.length);
                    headers.set("Content-Range", "bytes " + range.start() + "-" + range.end() + "/" + body.length);
                    headers.set("Content-Length", Integer.toString(range.length()));
                    if (headRequest) {
                        exchange.sendResponseHeaders(206, -1);
                        exchange.close();
                    } else {
                        respond(exchange, 206, type,
                                java.util.Arrays.copyOfRange(body, range.start(), range.end() + 1));
                    }
                } catch (IllegalArgumentException exception) {
                    headers.set("Content-Range", "bytes */" + body.length);
                    respond(exchange, 416, type, new byte[0]);
                }
                return;
            }
        }
        if (headRequest) {
            headers.set("Content-Length", Integer.toString(body.length));
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        } else {
            respond(exchange, 200, type, body);
        }
    }

    private static ByteRange parseByteRange(String rangeHeader, int contentLength) {
        Matcher matcher = BYTE_RANGE.matcher(rangeHeader.trim());
        if (!matcher.matches() || contentLength == 0) {
            throw new IllegalArgumentException("Invalid byte range.");
        }
        String startValue = matcher.group(1);
        String endValue = matcher.group(2);
        if (startValue.isEmpty() && endValue.isEmpty()) {
            throw new IllegalArgumentException("Invalid byte range.");
        }
        if (startValue.isEmpty()) {
            long suffixLength = Long.parseLong(endValue);
            if (suffixLength <= 0) {
                throw new IllegalArgumentException("Invalid byte range.");
            }
            int start = (int) Math.max(0, contentLength - Math.min(suffixLength, contentLength));
            return new ByteRange(start, contentLength - 1);
        }
        long start = Long.parseLong(startValue);
        if (start >= contentLength) {
            throw new IllegalArgumentException("Invalid byte range.");
        }
        long end = endValue.isEmpty() ? contentLength - 1 : Long.parseLong(endValue);
        if (end < start) {
            throw new IllegalArgumentException("Invalid byte range.");
        }
        return new ByteRange((int) start, (int) Math.min(end, contentLength - 1));
    }

    private record ByteRange(int start, int end) {
        private int length() {
            return end - start + 1;
        }
    }

    private static void respond(HttpExchange exchange, int status, String contentType, byte[] body) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        boolean headRequest = exchange.getRequestMethod().equals("HEAD");
        exchange.sendResponseHeaders(status, headRequest ? -1 : body.length);
        if (!headRequest && body.length > 0) {
            exchange.getResponseBody().write(body);
        }
        exchange.close();
    }
}
