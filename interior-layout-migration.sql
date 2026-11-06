-- Legacy MySQL migration. The current backend uses PostgreSQL; use schema.sql
-- to initialize a new PostgreSQL database.

CREATE TABLE IF NOT EXISTS screen_interiors (
    screen_code VARCHAR(24) PRIMARY KEY,
    screen_name VARCHAR(80) NOT NULL,
    screen_type ENUM('IMAX','STANDARD') NOT NULL,
    screen_aspect_ratio DECIMAL(6,5) NOT NULL,
    wall_color CHAR(7) NOT NULL,
    ceiling_color CHAR(7) NOT NULL,
    trim_color CHAR(7) NOT NULL,
    accent_color CHAR(7) NOT NULL,
    seat_color CHAR(7) NOT NULL,
    aisle_light_color CHAR(7) NOT NULL,
    wall_slat_count INT NOT NULL,
    ceiling_star_count INT NOT NULL,
    ring_light_count INT NOT NULL
);

INSERT INTO screen_interiors
    (screen_code, screen_name, screen_type, screen_aspect_ratio, wall_color, ceiling_color,
     trim_color, accent_color, seat_color, aisle_light_color, wall_slat_count,
     ceiling_star_count, ring_light_count)
VALUES
    ('IMAX', 'Screen 1 · IMAX', 'IMAX', 1.77778, '#17110D', '#090807', '#6B3B16', '#F3A63B', '#171514', '#FFB64A', 24, 240, 2),
    ('STANDARD_2', 'Screen 2 · Standard', 'STANDARD', 2.35000, '#19130F', '#0A0908', '#70431E', '#EFA23A', '#1A1715', '#FFC05B', 20, 180, 2),
    ('STANDARD_3', 'Screen 3 · Orchestra', 'STANDARD', 2.35000, '#18120E', '#080807', '#75451D', '#F2A641', '#1A1715', '#FFB34C', 22, 200, 2)
ON DUPLICATE KEY UPDATE
    screen_name = VALUES(screen_name),
    screen_type = VALUES(screen_type),
    screen_aspect_ratio = VALUES(screen_aspect_ratio),
    wall_color = VALUES(wall_color),
    ceiling_color = VALUES(ceiling_color),
    trim_color = VALUES(trim_color),
    accent_color = VALUES(accent_color),
    seat_color = VALUES(seat_color),
    aisle_light_color = VALUES(aisle_light_color),
    wall_slat_count = VALUES(wall_slat_count),
    ceiling_star_count = VALUES(ceiling_star_count),
    ring_light_count = VALUES(ring_light_count);
