-- Legacy MySQL migration. The current backend uses PostgreSQL; use schema.sql
-- to initialize a new PostgreSQL database.

-- Run once only against a database created from the previous Seatix schema.
-- These keys are already present when the current schema.sql creates the tables.
ALTER TABLE auditoriums
    ADD UNIQUE KEY uq_cinema_auditorium (cinema_name, auditorium_name);

ALTER TABLE movies
    ADD UNIQUE KEY uq_movie_title (title);

ALTER TABLE shows
    ADD UNIQUE KEY uq_movie_auditorium_start (movie_id, auditorium_id, starts_at);

ALTER TABLE booking_seats
    ADD UNIQUE KEY uq_booking_seat (booking_id, seat_id);

ALTER TABLE payments
    ADD UNIQUE KEY uq_booking_payment (booking_id);
