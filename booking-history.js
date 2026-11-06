"use strict";

(() => {
    const storageKey = "seatix.bookingHistory";
    const maxSavedBookings = 50;
    const allowedFields = [
        "bookingStatus", "paymentStatus", "amount"
    ];

    function list() {
        try {
            const bookings = JSON.parse(localStorage.getItem(storageKey) || "[]");
            return Array.isArray(bookings) ? bookings : [];
        } catch {
            return [];
        }
    }

    function persist(bookings) {
        try {
            localStorage.setItem(storageKey, JSON.stringify(bookings.slice(0, maxSavedBookings)));
        } catch (error) {
            console.warn("Could not save booking history in this browser.", error);
        }
    }

    function save(booking) {
        const summary = {
            bookingId: String(booking.bookingId),
            bookingTime: String(booking.bookingTime),
            bookingStatus: String(booking.bookingStatus),
            paymentStatus: String(booking.paymentStatus),
            amount: Number(booking.amount),
            movie: String(booking.movie),
            showDate: String(booking.showDate),
            showTime: String(booking.showTime),
            auditorium: String(booking.auditorium),
            seats: Array.isArray(booking.seats) ? booking.seats.map(String) : []
        };
        const bookings = list().filter((item) => item.bookingId !== summary.bookingId);
        bookings.unshift(summary);
        persist(bookings);
    }

    function update(bookingId, changes) {
        const bookings = list();
        const booking = bookings.find((item) => item.bookingId === String(bookingId));
        if (!booking) return;
        for (const field of allowedFields) {
            if (Object.hasOwn(changes, field)) booking[field] = changes[field];
        }
        persist(bookings);
    }

    window.SeatixBookingHistory = Object.freeze({ list, save, update });
})();