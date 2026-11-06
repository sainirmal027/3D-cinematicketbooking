package com.seatix.service;

import com.seatix.database.ScreenInteriorRepository;
import com.seatix.model.ScreenInterior;

import java.sql.SQLException;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

public final class ScreenInteriorService {
    private static final Set<String> REQUIRED_SCREENS = Set.of("IMAX", "STANDARD_2", "STANDARD_3");
    private static final ScreenInteriorRepository REPOSITORY = new ScreenInteriorRepository();

    private ScreenInteriorService() {}

    public static List<ScreenInterior> loadAll() throws SQLException {
        List<ScreenInterior> interiors;
        try {
            interiors = REPOSITORY.findAll();
        } catch (IllegalArgumentException exception) {
            throw new SQLException("The database contains an invalid screen interior configuration.", exception);
        }
        Set<String> loadedScreens = interiors.stream()
                .map(ScreenInterior::screenCode)
                .collect(Collectors.toSet());
        if (interiors.size() != REQUIRED_SCREENS.size() || !loadedScreens.equals(REQUIRED_SCREENS)) {
            throw new IllegalStateException("The database must contain interior settings for all three Seatix screens.");
        }
        return interiors;
    }
}
