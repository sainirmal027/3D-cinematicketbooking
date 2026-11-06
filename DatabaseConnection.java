package com.seatix.database;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Properties;

public final class DatabaseConnection {
    private static final String DEFAULT_URL =
            "jdbc:postgresql://localhost:5432/seatix";

    private DatabaseConnection() {}

    public static boolean isConfigured() {
        String url = System.getenv("SEATIX_DB_URL");
        if (isPostgresUri(url)) {
            try {
                parsePostgresUri(url);
                return true;
            } catch (SQLException exception) {
                return false;
            }
        }
        return hasValue("SEATIX_DB_USER") && hasValue("SEATIX_DB_PASSWORD");
    }

    public static Connection open() throws SQLException {
        String url = System.getenv("SEATIX_DB_URL");
        if (isPostgresUri(url)) {
            PostgresUri connectionUri = parsePostgresUri(url);
            Properties properties = new Properties();
            properties.setProperty("user", connectionUri.user());
            properties.setProperty("password", connectionUri.password());
            return DriverManager.getConnection(connectionUri.jdbcUrl(), properties);
        }

        String user = System.getenv("SEATIX_DB_USER");
        String password = System.getenv("SEATIX_DB_PASSWORD");
        if (user == null || user.isBlank() || password == null) {
            throw new IllegalStateException(
                    "Database credentials are not configured. Set SEATIX_DB_USER and SEATIX_DB_PASSWORD.");
        }
        return DriverManager.getConnection(url == null || url.isBlank() ? DEFAULT_URL : url, user, password);
    }

    private static boolean isPostgresUri(String value) {
        return value != null && (value.startsWith("postgres://") || value.startsWith("postgresql://"));
    }

    private static PostgresUri parsePostgresUri(String value) throws SQLException {
        try {
            URI uri = URI.create(value);
            String userInfo = uri.getRawUserInfo();
            int separator = userInfo == null ? -1 : userInfo.indexOf(':');
            if (!("postgres".equals(uri.getScheme()) || "postgresql".equals(uri.getScheme()))
                    || uri.getHost() == null || uri.getRawPath() == null || uri.getRawPath().length() < 2
                    || separator < 1 || separator == userInfo.length() - 1 || uri.getRawFragment() != null) {
                throw new SQLException(
                        "SEATIX_DB_URL must be a PostgreSQL connection URI with a database, username, and password.");
            }

            String authority = uri.getRawAuthority().substring(userInfo.length() + 1);
            String jdbcUrl = "jdbc:postgresql://" + authority + uri.getRawPath()
                    + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
            String user = decodeUriComponent(userInfo.substring(0, separator));
            String password = decodeUriComponent(userInfo.substring(separator + 1));
            if (user.isBlank() || password.isBlank()) {
                throw new SQLException("SEATIX_DB_URL must include a non-empty username and password.");
            }
            return new PostgresUri(jdbcUrl, user, password);
        } catch (IllegalArgumentException exception) {
            throw new SQLException("SEATIX_DB_URL is not a valid PostgreSQL connection URI.", exception);
        }
    }

    private static String decodeUriComponent(String value) {
        return URLDecoder.decode(value.replace("+", "%2B"), StandardCharsets.UTF_8);
    }

    private record PostgresUri(String jdbcUrl, String user, String password) {}

    private static boolean hasValue(String name) {
        String value = System.getenv(name);
        return value != null && !value.isBlank();
    }
}
