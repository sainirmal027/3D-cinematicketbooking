package com.seatix.model;

import java.util.Set;

public record ScreenInterior(
        String screenCode,
        String screenName,
        String screenType,
        double aspectRatio,
        String wallColor,
        String ceilingColor,
        String trimColor,
        String accentColor,
        String seatColor,
        String aisleLightColor,
        int wallSlatCount,
        int ceilingStarCount,
        int ringLightCount) {

    private static final Set<String> SCREEN_CODES = Set.of("IMAX", "STANDARD_2", "STANDARD_3");

    public ScreenInterior {
        if (screenCode == null || !SCREEN_CODES.contains(screenCode)
                || screenName == null || screenName.isBlank()
                || screenType == null || !Set.of("IMAX", "STANDARD").contains(screenType)
                || !Double.isFinite(aspectRatio) || aspectRatio < 1.0 || aspectRatio > 3.0
                || screenCode.equals("IMAX") != screenType.equals("IMAX")
                || screenCode.equals("IMAX") && Math.abs(aspectRatio - 16.0 / 9.0) > 0.00001
                || !screenCode.equals("IMAX") && Math.abs(aspectRatio - 2.35) > 0.00001
                || !isColor(wallColor) || !isColor(ceilingColor) || !isColor(trimColor)
                || !isColor(accentColor) || !isColor(seatColor) || !isColor(aisleLightColor)
                || wallSlatCount < 0 || wallSlatCount > 40
                || ceilingStarCount < 0 || ceilingStarCount > 400
                || ringLightCount < 0 || ringLightCount > 4) {
            throw new IllegalArgumentException("Invalid screen interior configuration.");
        }
    }

    private static boolean isColor(String value) {
        return value != null && value.matches("#[0-9A-Fa-f]{6}");
    }
}
