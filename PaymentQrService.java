package com.seatix.service;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.qrcode.QRCodeWriter;
import com.seatix.database.DatabaseConnection;
import com.seatix.service.BookingService.BookingException;
import com.seatix.service.BookingService.PaymentResult;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.regex.Pattern;

public final class PaymentQrService {
    private static final String PAYLOAD_PREFIX = "seatix-demo://payment/";
    private static final Pattern TOKEN_PATTERN = Pattern.compile("[A-Za-z0-9_-]{43}");
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final int TOKEN_BYTES = 32;
    private static final int QR_IMAGE_SIZE = 320;

    private PaymentQrService() {}

    public static byte[] issueQr(long bookingId) throws SQLException, BookingException {
        String token = createToken();
        byte[] image = createQrImage(PAYLOAD_PREFIX + token);

        try (Connection connection = DatabaseConnection.open()) {
            connection.setAutoCommit(false);
            try {
                boolean expired;
                try (PreparedStatement statement = connection.prepareStatement(
                        "SELECT b.status AS booking_status, p.payment_status, "
                                + "b.booking_time < CURRENT_TIMESTAMP - INTERVAL '15 minutes' AS expired "
                                + "FROM bookings b JOIN payments p ON p.booking_id = b.booking_id "
                                + "WHERE b.booking_id = ? FOR UPDATE OF b, p")) {
                    statement.setLong(1, bookingId);
                    try (ResultSet result = statement.executeQuery()) {
                        if (!result.next()) throw new BookingException(404, "Booking was not found.");
                        if (!"PENDING".equals(result.getString("booking_status"))
                                || !"PENDING".equals(result.getString("payment_status"))) {
                            throw new BookingException(409, "Only a pending simulated payment can use a QR code.");
                        }
                        expired = result.getBoolean("expired");
                    }
                }
                if (expired) throw new BookingException(410, "This pending checkout has expired.");

                try (PreparedStatement statement = connection.prepareStatement(
                        "UPDATE payment_qr_tokens SET status = 'REVOKED' "
                                + "WHERE booking_id = ? AND status = 'PENDING'")) {
                    statement.setLong(1, bookingId);
                    statement.executeUpdate();
                }
                try (PreparedStatement statement = connection.prepareStatement(
                        "INSERT INTO payment_qr_tokens (booking_id, token_hash, expires_at) "
                                + "SELECT ?, ?, booking_time + INTERVAL '15 minutes' "
                                + "FROM bookings WHERE booking_id = ?")) {
                    statement.setLong(1, bookingId);
                    statement.setString(2, hashToken(token));
                    statement.setLong(3, bookingId);
                    statement.executeUpdate();
                }
                connection.commit();
                return image;
            } catch (SQLException | BookingException | RuntimeException exception) {
                rollback(connection, exception);
                throw exception;
            }
        }
    }

    public static PaymentResult recordScan(String payload) throws SQLException, BookingException {
        String token = parseToken(payload);
        String tokenHash = hashToken(token);

        try (Connection connection = DatabaseConnection.open()) {
            connection.setAutoCommit(false);
            try {
                long qrId;
                long bookingId;
                try (PreparedStatement statement = connection.prepareStatement(
                        "SELECT qr_id, booking_id FROM payment_qr_tokens WHERE token_hash = ?")) {
                    statement.setString(1, tokenHash);
                    try (ResultSet result = statement.executeQuery()) {
                        if (!result.next()) throw new BookingException(404, "This Seatix demo QR code is invalid.");
                        qrId = result.getLong("qr_id");
                        bookingId = result.getLong("booking_id");
                    }
                }

                String bookingStatus;
                String paymentStatus;
                BigDecimal amount;
                boolean bookingExpired;
                try (PreparedStatement statement = connection.prepareStatement(
                        "SELECT b.status AS booking_status, p.payment_status, p.amount, "
                                + "b.booking_time < CURRENT_TIMESTAMP - INTERVAL '15 minutes' AS expired "
                                + "FROM bookings b JOIN payments p ON p.booking_id = b.booking_id "
                                + "WHERE b.booking_id = ? FOR UPDATE OF b, p")) {
                    statement.setLong(1, bookingId);
                    try (ResultSet result = statement.executeQuery()) {
                        if (!result.next()) throw new BookingException(404, "Booking was not found.");
                        bookingStatus = result.getString("booking_status");
                        paymentStatus = result.getString("payment_status");
                        amount = result.getBigDecimal("amount");
                        bookingExpired = result.getBoolean("expired");
                    }
                }

                String qrStatus;
                boolean qrExpired;
                try (PreparedStatement statement = connection.prepareStatement(
                        "SELECT status, expires_at <= CURRENT_TIMESTAMP AS expired "
                                + "FROM payment_qr_tokens WHERE qr_id = ? FOR UPDATE")) {
                    statement.setLong(1, qrId);
                    try (ResultSet result = statement.executeQuery()) {
                        if (!result.next()) throw new BookingException(404, "This Seatix demo QR code was not found.");
                        qrStatus = result.getString("status");
                        qrExpired = result.getBoolean("expired");
                    }
                }
                if (!"PENDING".equals(qrStatus)) {
                    throw new BookingException(409, "This Seatix demo QR code has already been used or revoked.");
                }

                if (!"PENDING".equals(paymentStatus) || !"PENDING".equals(bookingStatus)) {
                    updateQrStatus(connection, qrId, "REVOKED");
                    connection.commit();
                    return new PaymentResult(bookingId, bookingStatus, paymentStatus, amount);
                }
                if (bookingExpired || qrExpired) {
                    BookingService.updatePaymentAndBooking(connection, bookingId, "FAILED", "CANCELLED");
                    BookingService.releaseBookingSeats(connection, bookingId);
                    updateQrStatus(connection, qrId, "EXPIRED");
                    connection.commit();
                    return new PaymentResult(bookingId, "CANCELLED", "FAILED", amount);
                }

                BookingService.updatePaymentAndBooking(connection, bookingId, "SUCCESS", "CONFIRMED");
                markQrScanned(connection, qrId);
                connection.commit();
                return new PaymentResult(bookingId, "CONFIRMED", "SUCCESS", amount);
            } catch (SQLException | BookingException | RuntimeException exception) {
                rollback(connection, exception);
                throw exception;
            }
        }
    }

    private static String createToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String parseToken(String payload) throws BookingException {
        if (payload == null || !payload.startsWith(PAYLOAD_PREFIX)) {
            throw new BookingException(400, "The scanned value is not a Seatix demo payment QR code.");
        }
        String token = payload.substring(PAYLOAD_PREFIX.length());
        if (!TOKEN_PATTERN.matcher(token).matches()) {
            throw new BookingException(400, "The scanned Seatix demo payment QR code is malformed.");
        }
        return token;
    }

    private static String hashToken(String token) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.US_ASCII));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available.", exception);
        }
    }

    private static byte[] createQrImage(String payload) {
        try {
            var hints = Map.of(EncodeHintType.MARGIN, 2);
            var matrix = new QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE,
                    QR_IMAGE_SIZE, QR_IMAGE_SIZE, hints);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            MatrixToImageWriter.writeToStream(matrix, "PNG", output);
            return output.toByteArray();
        } catch (WriterException | IOException exception) {
            throw new IllegalStateException("The simulated payment QR code could not be generated.", exception);
        }
    }

    private static void updateQrStatus(Connection connection, long qrId, String status) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "UPDATE payment_qr_tokens SET status = ? WHERE qr_id = ?")) {
            statement.setString(1, status);
            statement.setLong(2, qrId);
            statement.executeUpdate();
        }
    }

    private static void markQrScanned(Connection connection, long qrId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "UPDATE payment_qr_tokens SET status = 'SCANNED', scanned_at = CURRENT_TIMESTAMP "
                        + "WHERE qr_id = ? AND status = 'PENDING'")) {
            statement.setLong(1, qrId);
            if (statement.executeUpdate() != 1) {
                throw new SQLException("The simulated payment QR code was no longer pending.");
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
}