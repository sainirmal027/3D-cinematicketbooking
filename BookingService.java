package com.seatix.service;

import com.seatix.database.DatabaseConnection;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

public final class BookingService {
    private static final String DEMO_EMAIL = "demo-booking@seatix.local";
    private static final Pattern EMAIL_PATTERN = Pattern.compile(
            "^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
                    + "(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$");
    private static final int SERVICE_FEE_PER_TICKET = 15;
    private static final int MAX_SEATS_PER_BOOKING = 12;

    private BookingService() {}

    public static CreatedBooking create(String movieTitle, String layoutName, LocalDate showDate,
                                        LocalTime showTime, String phoneNumber, String email,
                                        List<RequestedSeat> requestedSeats)
            throws SQLException, BookingException {
        Layout layout = Layout.fromValue(layoutName);
        String normalizedPhone = normalizeIndianPhoneNumber(phoneNumber);
        String normalizedEmail = normalizeEmail(email);
        if (!SUPPORTED_MOVIES.contains(movieTitle)) {
            throw new BookingException(400, "Choose a movie from the Seatix movie list.");
        }
        if (!SCHEDULED_SHOWS.contains(new ScheduledShow(movieTitle, layout, showTime))) {
            throw new BookingException(400, "That movie is not scheduled in the selected screen at this time.");
        }
        LocalDateTime showStartsAt = LocalDateTime.of(showDate, showTime);
        if (!showStartsAt.isAfter(LocalDateTime.now()) || showDate.isAfter(LocalDate.now().plusDays(90))) {
            throw new BookingException(400, "The selected show date is outside the booking window.");
        }
        if (requestedSeats.isEmpty() || requestedSeats.size() > MAX_SEATS_PER_BOOKING) {
            throw new BookingException(400, "Select between 1 and 12 seats to continue.");
        }

        List<PricedSeat> seats = validateAndPrice(layout, requestedSeats);
        int ticketsTotal = seats.stream().mapToInt(seat -> seat.price().intValueExact()).sum();
        int total = ticketsTotal + SERVICE_FEE_PER_TICKET * seats.size();

        try (Connection connection = DatabaseConnection.open()) {
            connection.setAutoCommit(false);
            try {
                releaseExpiredBookings(connection);
                long userId = ensureDemoUser(connection);
                long movieId = ensureMovie(connection, movieTitle);
                long auditoriumId = ensureAuditorium(connection, layout);
                long showId = ensureShow(connection, movieId, auditoriumId, showStartsAt);
                List<Long> seatIds = new ArrayList<>();
                for (PricedSeat seat : seats) {
                    seatIds.add(ensureSeat(connection, auditoriumId, seat));
                }

                long bookingId = insertBooking(connection, userId, showId, total);
                insertBookingContact(connection, bookingId, normalizedPhone, normalizedEmail);
                insertBookingSeats(connection, bookingId, showId, seats, seatIds);
                insertPendingPayment(connection, bookingId, total);
                connection.commit();
                return new CreatedBooking(bookingId, "PENDING", total, seats.stream().map(PricedSeat::label).toList());
            } catch (SQLException | RuntimeException exception) {
                rollback(connection, exception);
                throw exception;
            }
        }
    }

    private static String normalizeIndianPhoneNumber(String phoneNumber) throws BookingException {
        if (phoneNumber == null) {
            throw new BookingException(400, "Enter a valid Indian mobile number.");
        }
        String compact = phoneNumber.trim().replaceAll("[\\s()-]", "");
        if (compact.startsWith("+91")) {
            compact = compact.substring(3);
        } else if (compact.startsWith("91") && compact.length() == 12) {
            compact = compact.substring(2);
        } else if (compact.startsWith("0") && compact.length() == 11) {
            compact = compact.substring(1);
        }
        if (!compact.matches("[6-9][0-9]{9}")) {
            throw new BookingException(400, "Enter a valid 10-digit Indian mobile number.");
        }
        return "+91" + compact;
    }

    private static String normalizeEmail(String email) throws BookingException {
        if (email == null) {
            throw new BookingException(400, "Enter a valid email address.");
        }
        String normalized = email.trim().toLowerCase(java.util.Locale.ROOT);
        if (normalized.length() > 254 || !EMAIL_PATTERN.matcher(normalized).matches()) {
            throw new BookingException(400, "Enter a valid email address.");
        }
        return normalized;
    }

    public static PaymentResult simulatePayment(long bookingId, boolean succeed) throws SQLException, BookingException {
        try (Connection connection = DatabaseConnection.open()) {
            connection.setAutoCommit(false);
            try {
                String bookingStatus;
                boolean expired;
                try (PreparedStatement statement = connection.prepareStatement(
                        "SELECT status, booking_time < CURRENT_TIMESTAMP - INTERVAL '15 minutes' AS expired "
                                + "FROM bookings WHERE booking_id = ? FOR UPDATE")) {
                    statement.setLong(1, bookingId);
                    try (ResultSet result = statement.executeQuery()) {
                        if (!result.next()) throw new BookingException(404, "Booking was not found.");
                        bookingStatus = result.getString("status");
                        expired = result.getBoolean("expired");
                    }
                }

                String paymentStatus;
                BigDecimal amount;
                try (PreparedStatement statement = connection.prepareStatement(
                        "SELECT payment_status, amount FROM payments WHERE booking_id = ? FOR UPDATE")) {
                    statement.setLong(1, bookingId);
                    try (ResultSet result = statement.executeQuery()) {
                        if (!result.next()) throw new BookingException(404, "Payment was not found.");
                        paymentStatus = result.getString("payment_status");
                        amount = result.getBigDecimal("amount");
                    }
                }

                if (expired && "PENDING".equals(paymentStatus)) {
                    updatePaymentAndBooking(connection, bookingId, "FAILED", "CANCELLED");
                    releaseBookingSeats(connection, bookingId);
                    updatePendingPaymentQrCodes(connection, bookingId, "EXPIRED");
                    connection.commit();
                    return new PaymentResult(bookingId, "CANCELLED", "FAILED", amount);
                }
                if (!"PENDING".equals(paymentStatus)) {
                    updatePendingPaymentQrCodes(connection, bookingId, "REVOKED");
                    connection.commit();
                    return new PaymentResult(bookingId, bookingStatus, paymentStatus, amount);
                }

                String nextPaymentStatus = succeed ? "SUCCESS" : "FAILED";
                String nextBookingStatus = succeed ? "CONFIRMED" : "CANCELLED";
                updatePaymentAndBooking(connection, bookingId, nextPaymentStatus, nextBookingStatus);
                if (!succeed) {
                    releaseBookingSeats(connection, bookingId);
                }
                updatePendingPaymentQrCodes(connection, bookingId, "REVOKED");
                connection.commit();
                return new PaymentResult(bookingId, nextBookingStatus, nextPaymentStatus, amount);
            } catch (SQLException | BookingException | RuntimeException exception) {
                rollback(connection, exception);
                throw exception;
            }
        }
    }

    private static List<PricedSeat> validateAndPrice(Layout layout, List<RequestedSeat> requestedSeats)
            throws BookingException {
        List<PricedSeat> seats = new ArrayList<>();
        Set<String> unique = new HashSet<>();
        for (RequestedSeat requested : requestedSeats) {
            String key = requested.section() + "-" + requested.row() + "-" + requested.seatNumber();
            if (!unique.add(key)) throw new BookingException(400, "The seat list contains a duplicate seat.");
            seats.add(layout.priceSeat(requested));
        }
        return seats;
    }

    private static long ensureDemoUser(Connection connection) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO users (full_name, email, password_hash) VALUES ('Seatix Demo Guest', ?, 'DEMO_ONLY_NO_LOGIN') "
                    + "ON CONFLICT (email) DO NOTHING")) {
            statement.setString(1, DEMO_EMAIL);
            statement.executeUpdate();
        }
        return selectId(connection, "SELECT user_id FROM users WHERE email = ?", DEMO_EMAIL);
    }

    private static void releaseExpiredBookings(Connection connection) throws SQLException {
        String expiredBookings = "SELECT booking_id FROM bookings WHERE status = 'PENDING' "
                + "AND booking_time < CURRENT_TIMESTAMP - INTERVAL '15 minutes'";
        try (PreparedStatement statement = connection.prepareStatement(
                "UPDATE payments SET payment_status = 'FAILED' WHERE payment_status = 'PENDING' "
                        + "AND booking_id IN (" + expiredBookings + ")")) {
            statement.executeUpdate();
        }
        try (PreparedStatement statement = connection.prepareStatement(
                "DELETE FROM booking_seats WHERE booking_id IN (" + expiredBookings + ")")) {
            statement.executeUpdate();
        }
        try (PreparedStatement statement = connection.prepareStatement(
            "UPDATE payment_qr_tokens SET status = 'EXPIRED' WHERE status = 'PENDING' "
                + "AND booking_id IN (" + expiredBookings + ")")) {
            statement.executeUpdate();
        }
        try (PreparedStatement statement = connection.prepareStatement(
                "UPDATE bookings SET status = 'CANCELLED' WHERE status = 'PENDING' "
                        + "AND booking_time < CURRENT_TIMESTAMP - INTERVAL '15 minutes'")) {
            statement.executeUpdate();
        }
    }

    static void updatePaymentAndBooking(Connection connection, long bookingId,
                                                String paymentStatus, String bookingStatus)
            throws SQLException, BookingException {
        try (PreparedStatement statement = connection.prepareStatement(
                "UPDATE payments SET payment_status = ? WHERE booking_id = ? AND payment_status = 'PENDING'")) {
            statement.setString(1, paymentStatus);
            statement.setLong(2, bookingId);
            if (statement.executeUpdate() != 1) {
                throw new BookingException(409, "Payment is no longer pending.");
            }
        }
        try (PreparedStatement statement = connection.prepareStatement(
                "UPDATE bookings SET status = ? WHERE booking_id = ? AND status = 'PENDING'")) {
            statement.setString(1, bookingStatus);
            statement.setLong(2, bookingId);
            if (statement.executeUpdate() != 1) {
                throw new BookingException(409, "Booking is no longer pending.");
            }
        }
    }

    static void releaseBookingSeats(Connection connection, long bookingId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "DELETE FROM booking_seats WHERE booking_id = ?")) {
            statement.setLong(1, bookingId);
            statement.executeUpdate();
        }
    }

    private static void updatePendingPaymentQrCodes(Connection connection, long bookingId, String status)
            throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "UPDATE payment_qr_tokens SET status = ? WHERE booking_id = ? AND status = 'PENDING'")) {
            statement.setString(1, status);
            statement.setLong(2, bookingId);
            statement.executeUpdate();
        }
    }

    private static long ensureMovie(Connection connection, String title) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO movies (title) VALUES (?) ON CONFLICT (title) DO NOTHING")) {
            statement.setString(1, title);
            statement.executeUpdate();
        }
        return selectId(connection, "SELECT movie_id FROM movies WHERE title = ?", title);
    }

    private static long ensureAuditorium(Connection connection, Layout layout) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO auditoriums (cinema_name, auditorium_name, auditorium_type) VALUES ('Seatix Cinemas', ?, ?) "
                        + "ON CONFLICT (cinema_name, auditorium_name) DO NOTHING")) {
            statement.setString(1, layout.displayName);
            statement.setString(2, layout.databaseType);
            statement.executeUpdate();
        }
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT auditorium_id FROM auditoriums WHERE cinema_name = 'Seatix Cinemas' AND auditorium_name = ?")) {
            statement.setString(1, layout.displayName);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new SQLException("Seatix auditorium could not be loaded.");
                return result.getLong(1);
            }
        }
    }

    private static long ensureShow(Connection connection, long movieId, long auditoriumId,
                                   LocalDateTime startTime) throws SQLException {
        Timestamp startsAt = Timestamp.valueOf(startTime);
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO shows (movie_id, auditorium_id, starts_at) VALUES (?, ?, ?) "
                        + "ON CONFLICT (movie_id, auditorium_id, starts_at) DO NOTHING")) {
            statement.setLong(1, movieId);
            statement.setLong(2, auditoriumId);
            statement.setTimestamp(3, startsAt);
            statement.executeUpdate();
        }
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT show_id FROM shows WHERE movie_id = ? AND auditorium_id = ? AND starts_at = ? FOR UPDATE")) {
            statement.setLong(1, movieId);
            statement.setLong(2, auditoriumId);
            statement.setTimestamp(3, startsAt);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new SQLException("Seatix showtime could not be loaded.");
                return result.getLong(1);
            }
        }
    }

    private static long ensureSeat(Connection connection, long auditoriumId, PricedSeat seat) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO seats (auditorium_id, section_name, row_label, seat_number, category, base_price) "
                        + "VALUES (?, ?, ?, ?, ?, ?) "
                        + "ON CONFLICT (auditorium_id, section_name, row_label, seat_number) DO NOTHING")) {
            statement.setLong(1, auditoriumId);
            statement.setString(2, seat.section());
            statement.setString(3, seat.row());
            statement.setInt(4, seat.number());
            statement.setString(5, seat.category());
            statement.setBigDecimal(6, seat.price());
            statement.executeUpdate();
        }
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT seat_id, category, base_price FROM seats "
                        + "WHERE auditorium_id = ? AND section_name = ? AND row_label = ? AND seat_number = ? FOR UPDATE")) {
            statement.setLong(1, auditoriumId);
            statement.setString(2, seat.section());
            statement.setString(3, seat.row());
            statement.setInt(4, seat.number());
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new SQLException("Seat could not be loaded.");
                if (!seat.category().equals(result.getString("category"))
                        || seat.price().compareTo(result.getBigDecimal("base_price")) != 0) {
                    throw new SQLException("The stored seat map differs from the current Seatix layout.");
                }
                return result.getLong("seat_id");
            }
        }
    }

    private static long insertBooking(Connection connection, long userId, long showId, int total) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO bookings (user_id, show_id, total_amount, status) VALUES (?, ?, ?, 'PENDING')",
                Statement.RETURN_GENERATED_KEYS)) {
            statement.setLong(1, userId);
            statement.setLong(2, showId);
            statement.setBigDecimal(3, BigDecimal.valueOf(total));
            statement.executeUpdate();
            try (ResultSet keys = statement.getGeneratedKeys()) {
                if (!keys.next()) throw new SQLException("Could not create the booking.");
                return keys.getLong(1);
            }
        }
    }

    private static void insertBookingContact(Connection connection, long bookingId, String phoneNumber,
                                             String email) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO booking_contacts (booking_id, phone_e164, email) VALUES (?, ?, ?)")) {
            statement.setLong(1, bookingId);
            statement.setString(2, phoneNumber);
            statement.setString(3, email);
            statement.executeUpdate();
        }
    }

    private static void insertBookingSeats(Connection connection, long bookingId, long showId,
                                           List<PricedSeat> seats, List<Long> seatIds) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO booking_seats (booking_id, show_id, seat_id, price) VALUES (?, ?, ?, ?)")) {
            for (int index = 0; index < seats.size(); index++) {
                statement.setLong(1, bookingId);
                statement.setLong(2, showId);
                statement.setLong(3, seatIds.get(index));
                statement.setBigDecimal(4, seats.get(index).price());
                statement.addBatch();
            }
            statement.executeBatch();
        }
    }

    private static void insertPendingPayment(Connection connection, long bookingId, int amount) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO payments (booking_id, amount, payment_method, payment_status) "
                        + "VALUES (?, ?, 'SIMULATED', 'PENDING')")) {
            statement.setLong(1, bookingId);
            statement.setBigDecimal(2, BigDecimal.valueOf(amount));
            statement.executeUpdate();
        }
    }

    private static long selectId(Connection connection, String sql, String value) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, value);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new SQLException("Seatix booking record could not be loaded.");
                return result.getLong(1);
            }
        }
    }

    private static void rollback(Connection connection, Exception original) {
        try {
            connection.rollback();
        } catch (SQLException rollbackFailure) {
            original.addSuppressed(rollbackFailure);
        }
    }

    public record RequestedSeat(String section, String row, int seatNumber) {}
    public record CreatedBooking(long bookingId, String bookingStatus, int total,
                                 List<String> seats) {}
    public record PaymentResult(long bookingId, String bookingStatus, String paymentStatus,
                                BigDecimal amount) {}
    private record ScheduledShow(String movie, Layout layout, LocalTime time) {}
    private record PricedSeat(String section, String row, int number, String category,
                              BigDecimal price, String label) {}

    private enum Layout {
        IMAX("imax", "Screen 1 · IMAX", "IMAX"),
        STANDARD_2("standard2", "Screen 2 · Standard", "STANDARD"),
        STANDARD_3("standard3", "Orchestra / Mezzanine", "ORCHESTRA");

        private final String value;
        private final String displayName;
        private final String databaseType;

        Layout(String value, String displayName, String databaseType) {
            this.value = value;
            this.displayName = displayName;
            this.databaseType = databaseType;
        }

        private static Layout fromValue(String value) throws BookingException {
            for (Layout layout : values()) if (layout.value.equals(value)) return layout;
            throw new BookingException(400, "Choose a valid Seatix auditorium.");
        }

        private PricedSeat priceSeat(RequestedSeat seat) throws BookingException {
            String[] rows;
            int rowIndex;
            int count;
            boolean premium;
            boolean accessible = false;
            String expectedSection;
            int standardPrice;
            int premiumPrice;

            if (this == IMAX) {
                rows = new String[]{"U", "T", "S", "R", "Q", "P", "O", "N", "M", "L", "K", "J",
                        "H", "G", "F", "E", "D", "C", "B", "A", "V", "W", "X"};
                expectedSection = "IMAX";
                standardPrice = 300;
                premiumPrice = 420;
                rowIndex = indexOf(rows, seat.row());
                count = rowIndex < 0 ? 0 : rowIndex < 10 ? 28 : rowIndex < 20 ? 30 : 26;
                premium = rowIndex >= 8 && rowIndex <= 12;
            } else if (this == STANDARD_2) {
                rows = new String[]{"AA", "BB", "CC", "DD", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"};
                expectedSection = "Standard";
                standardPrice = 260;
                premiumPrice = 380;
                rowIndex = indexOf(rows, seat.row());
                count = rowIndex < 0 ? 0 : rowIndex < 4 ? 22 : 24;
                premium = rowIndex >= 9 && rowIndex <= 11;
                accessible = rowIndex == 4 && isAccessibleSeat(seat.seatNumber(), count);
            } else if (this == STANDARD_3) {
                expectedSection = seat.section();
                rows = switch (seat.section()) {
                    case "Orchestra" -> new String[]{"CC", "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L",
                            "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X"};
                    default -> throw new BookingException(400, "The selected seat is not in this auditorium.");
                };
                standardPrice = 350;
                premiumPrice = 500;
                rowIndex = indexOf(rows, seat.row());
                count = rowIndex < 0 ? 0 : rowIndex < 8 ? 30 : 34;
                premium = rowIndex >= 6 && rowIndex <= 10;
            } else {
                throw new BookingException(400, "Choose a valid Seatix screen.");
            }

            if (!expectedSection.equals(seat.section()) || rowIndex < 0
                    || seat.seatNumber() < 1 || seat.seatNumber() > count) {
                throw new BookingException(400, "One or more selected seats do not match the auditorium layout.");
            }
            int leftSeats = (int) Math.ceil(count * 0.23);
            int rightSeats = leftSeats;
            int centreEnd = count - rightSeats;
            boolean centreSeat = seat.seatNumber() > leftSeats && seat.seatNumber() <= centreEnd;
            String category = accessible ? "ACCESSIBLE" : premium && centreSeat ? "PREMIUM" : "STANDARD";
            int price = category.equals("PREMIUM") ? premiumPrice : standardPrice;
            return new PricedSeat(seat.section(), seat.row(), seat.seatNumber(), category,
                    BigDecimal.valueOf(price), seat.section() + " · " + seat.row() + seat.seatNumber());
        }

        private static boolean isAccessibleSeat(int seatNumber, int count) {
            int leftSeats = (int) Math.ceil(count * 0.23);
            return seatNumber > leftSeats && seatNumber - leftSeats >= 2 && seatNumber - leftSeats <= 3;
        }

        private static int indexOf(String[] values, String value) {
            for (int index = 0; index < values.length; index++) if (values[index].equals(value)) return index;
            return -1;
        }
    }

    public static final class BookingException extends Exception {
        private static final long serialVersionUID = 1L;
        private final int statusCode;

        public BookingException(int statusCode, String message) {
            super(message);
            this.statusCode = statusCode;
        }

        public int statusCode() {
            return statusCode;
        }
    }

    private static final Set<String> SUPPORTED_MOVIES = Set.of(
            "Interstellar", "The Dark Knight", "Resident Evil", "Jailer 2", "Baththa");
    private static final Set<ScheduledShow> SCHEDULED_SHOWS = Set.of(
            new ScheduledShow("Interstellar", Layout.IMAX, LocalTime.of(10, 0)),
            new ScheduledShow("Interstellar", Layout.IMAX, LocalTime.of(16, 15)),
            new ScheduledShow("The Dark Knight", Layout.IMAX, LocalTime.of(13, 15)),
            new ScheduledShow("The Dark Knight", Layout.IMAX, LocalTime.of(19, 30)),
            new ScheduledShow("Resident Evil", Layout.STANDARD_2, LocalTime.of(10, 0)),
            new ScheduledShow("Resident Evil", Layout.STANDARD_2, LocalTime.of(18, 0)),
            new ScheduledShow("Jailer 2", Layout.STANDARD_2, LocalTime.of(12, 15)),
            new ScheduledShow("Jailer 2", Layout.STANDARD_2, LocalTime.of(20, 15)),
            new ScheduledShow("Baththa", Layout.STANDARD_2, LocalTime.of(15, 15)),
            new ScheduledShow("Baththa", Layout.STANDARD_3, LocalTime.of(10, 30)),
            new ScheduledShow("Baththa", Layout.STANDARD_3, LocalTime.of(18, 30)),
            new ScheduledShow("Resident Evil", Layout.STANDARD_3, LocalTime.of(13, 15)),
            new ScheduledShow("Resident Evil", Layout.STANDARD_3, LocalTime.of(21, 15)),
            new ScheduledShow("Jailer 2", Layout.STANDARD_3, LocalTime.of(15, 30)));
}
