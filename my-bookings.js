"use strict";

const bookingHistoryStatus = document.querySelector("#bookingHistoryStatus");
const bookingHistoryEmpty = document.querySelector("#bookingHistoryEmpty");
const bookingResults = document.querySelector("#bookingResults");
const bookingRecordList = document.querySelector("#bookingRecordList");

function addBookingDetail(container, label, value, className = "") {
    const item = document.createElement("div");
    if (className) item.className = className;
    const term = document.createElement("span");
    term.textContent = label;
    const detail = document.createElement("strong");
    detail.textContent = value;
    item.append(term, detail);
    container.append(item);
}

function formatBookingDate(value) {
    return new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(new Date(value));
}

function renderBooking(booking) {
    const card = document.createElement("article");
    card.className = "booking-record";

    const header = document.createElement("div");
    header.className = "booking-record-header";
    const title = document.createElement("h3");
    title.textContent = `Booking #${booking.bookingId} · ${booking.movie}`;
    const status = document.createElement("span");
    status.className = "booking-record-status";
    status.dataset.status = booking.bookingStatus;
    status.textContent = booking.bookingStatus;
    header.append(title, status);

    const details = document.createElement("div");
    details.className = "booking-record-details";
    addBookingDetail(details, "Showtime", formatBookingDate(`${booking.showDate}T${booking.showTime}:00`));
    addBookingDetail(details, "Auditorium", booking.auditorium);
    addBookingDetail(details, "Seats", booking.seats.join(", ") || "Seats released");
    addBookingDetail(details, "Payment", booking.paymentStatus);
    addBookingDetail(details, "Booked", formatBookingDate(booking.bookingTime));
    addBookingDetail(details, "Total", `₹${Number(booking.amount).toLocaleString("en-IN")}`, "booking-record-total");
    card.append(header, details);
    return card;
}

const bookings = window.SeatixBookingHistory.list();
bookingHistoryStatus.textContent = `${bookings.length} saved booking${bookings.length === 1 ? "" : "s"}`;
bookingHistoryEmpty.hidden = bookings.length > 0;
bookingResults.hidden = bookings.length === 0;
for (const booking of bookings) bookingRecordList.append(renderBooking(booking));