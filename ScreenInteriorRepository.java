package com.seatix.database;

import com.seatix.model.ScreenInterior;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

public final class ScreenInteriorRepository {
    public List<ScreenInterior> findAll() throws SQLException {
        String query = "SELECT screen_code, screen_name, screen_type, screen_aspect_ratio, "
                + "wall_color, ceiling_color, trim_color, accent_color, seat_color, aisle_light_color, "
                + "wall_slat_count, ceiling_star_count, ring_light_count "
                + "FROM screen_interiors ORDER BY screen_code";
        List<ScreenInterior> interiors = new ArrayList<>();
        try (Connection connection = DatabaseConnection.open();
             PreparedStatement statement = connection.prepareStatement(query);
             ResultSet result = statement.executeQuery()) {
            while (result.next()) {
                interiors.add(new ScreenInterior(
                        result.getString("screen_code"),
                        result.getString("screen_name"),
                        result.getString("screen_type"),
                        result.getDouble("screen_aspect_ratio"),
                        result.getString("wall_color"),
                        result.getString("ceiling_color"),
                        result.getString("trim_color"),
                        result.getString("accent_color"),
                        result.getString("seat_color"),
                        result.getString("aisle_light_color"),
                        result.getInt("wall_slat_count"),
                        result.getInt("ceiling_star_count"),
                        result.getInt("ring_light_count")));
            }
        }
        return List.copyOf(interiors);
    }
}
