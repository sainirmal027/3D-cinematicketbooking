"use strict";

const movies = [
    { id: "interstellar", title: "Interstellar", genre: "Sci-fi · Adventure", rating: "8.7", poster: "/interstellar.png", durationMinutes: 169, screenings: { imax: ["10:00", "16:15"] } },
    { id: "dark-knight", title: "The Dark Knight", genre: "Action · Crime", rating: "9.0", poster: "/dark-knight.png", durationMinutes: 152, screenings: { imax: ["13:15", "19:30"] } },
    { id: "resident-evil", title: "Resident Evil", genre: "Action · Horror", rating: "7.4", poster: "/resident-evil.png", durationMinutes: 120, screenings: { standard2: ["10:00", "18:00"], standard3: ["13:15", "21:15"] } },
    { id: "jailer2", title: "Jailer 2", genre: "Action · Drama", rating: "8.1", poster: "/jailer2.png", durationMinutes: 150, screenings: { standard2: ["12:15", "20:15"], standard3: ["15:30"] } },
    { id: "baththa", title: "Baththa", genre: "Action · Romance", rating: "7.2", poster: "/baththa.png", durationMinutes: 140, screenings: { standard2: ["15:15"], standard3: ["10:30", "18:30"] } }
];

const screens = {
    standard2: {
        screenCode: "STANDARD_2", label: "Screen 2 · Standard · 2.35:1", name: "Screen 2 · Standard · 2.35:1",
        interior: { aspectRatio: 2.35, wallColor: "#19130F", ceilingColor: "#0A0908", trimColor: "#70431E", accentColor: "#EFA23A", seatColor: "#1A1715", aisleLightColor: "#FFC05B", wallSlatCount: 20, ceilingStarCount: 180, ringLightCount: 2 }
    },
    imax: {
        screenCode: "IMAX", label: "Screen 1 · IMAX · 16:9", name: "Screen 1 · IMAX · 16:9",
        interior: { aspectRatio: 16 / 9, wallColor: "#17110D", ceilingColor: "#090807", trimColor: "#6B3B16", accentColor: "#F3A63B", seatColor: "#171514", aisleLightColor: "#FFB64A", wallSlatCount: 24, ceilingStarCount: 240, ringLightCount: 2 }
    },
    standard3: {
        screenCode: "STANDARD_3", label: "Screen 3 · Orchestra · 2.35:1", name: "Screen 3 · Orchestra · 2.35:1",
        interior: { aspectRatio: 2.35, wallColor: "#18120E", ceilingColor: "#080807", trimColor: "#75451D", accentColor: "#F2A641", seatColor: "#1A1715", aisleLightColor: "#FFB34C", wallSlatCount: 22, ceilingStarCount: 200, ringLightCount: 2 }
    }
};

function validateScreenSchedule() {
    const scheduleByScreen = new Map();
    for (const movie of movies) {
        for (const [screen, times] of Object.entries(movie.screenings)) {
            const screenings = scheduleByScreen.get(screen) ?? [];
            for (const time of times) {
                const [hours, minutes] = time.split(":").map(Number);
                screenings.push({ movie: movie.title, start: hours * 60 + minutes, duration: movie.durationMinutes });
            }
            scheduleByScreen.set(screen, screenings);
        }
    }

    for (const [screen, screenings] of scheduleByScreen) {
        screenings.sort((first, second) => first.start - second.start);
        for (let index = 1; index < screenings.length; index++) {
            const previous = screenings[index - 1];
            if (screenings[index].start < previous.start + previous.duration + 15) {
                throw new Error(`The ${screen} screen schedule has overlapping screenings.`);
            }
        }
    }
}

validateScreenSchedule();

const priceTable = {
    standard2: { standard: 260, premium: 380 },
    standard3: {
        Orchestra: { standard: 350, premium: 500 }
    },
    imax: { standard: 300, premium: 420 }
};

const selectedSeatIds = new Set();
const requestedMovieId = new URLSearchParams(window.location.search).get("movie");
let activeMovie = movies.find((movie) => movie.id === requestedMovieId) ?? movies[0];
let activeTime = "";
let activeDate = "";
let activeLayout = "imax";
let currentSeats = [];
let renderer;
let toastTimeout;
let pendingBooking = null;
let bookingEnabled = false;
let paymentQrRequestId = 0;
let paymentQrObjectUrl = null;

const movieShelf = document.querySelector("#movieShelf");
const seatList = document.querySelector("#selectedList");
const countLabel = document.querySelector("#selectedCount");
const ticketCount = document.querySelector("#ticketCount");
const ticketPrice = document.querySelector("#ticketPrice");
const feeLabel = document.querySelector("#convenienceFee");
const totalLabel = document.querySelector("#totalPrice");
const clearButton = document.querySelector("#clearSelection");
const continueButton = document.querySelector("#continueButton");
const bookingAvailability = document.querySelector("#bookingAvailability");
const layoutPicker = document.querySelector("#layoutPicker");
const toast = document.querySelector("#toast");
const seatTooltip = document.querySelector("#seatTooltip");
const seatMapView = document.querySelector("#seatMapView");
const seatMapToggle = document.querySelector("#seatMapToggle");
const auditoriumModeLabel = document.querySelector("#auditoriumModeLabel");
const contactDialog = document.querySelector("#contactDialog");
const contactForm = document.querySelector("#contactForm");
const contactFormError = document.querySelector("#contactFormError");
const createBookingButton = document.querySelector("#createBookingButton");
const paymentDialog = document.querySelector("#paymentDialog");
const paymentStatusPanel = document.querySelector("#paymentStatusPanel");
const paymentStatusTitle = document.querySelector("#paymentStatusTitle");
const paymentStatusMessage = document.querySelector("#paymentStatusMessage");
const paymentActions = document.querySelector("#paymentActions");
const retryPaymentButton = document.querySelector("#retryPayment");
const closePaymentButton = document.querySelector("#closePaymentDialog");
const bookingSuccessPage = document.querySelector("#bookingSuccessPage");
const selectedMovieTitle = document.querySelector("#selectedMovieTitle");
const paymentQrImage = document.querySelector("#paymentQrImage");
const paymentQrPlaceholder = document.querySelector("#paymentQrPlaceholder");
const paymentQrMessage = document.querySelector("#paymentQrMessage");
const screeningVideo = document.querySelector("#screeningVideo");
const screeningStatus = document.querySelector("#screeningStatus");
const screeningPlayButton = document.querySelector("#screeningPlayButton");
const screeningPauseButton = document.querySelector("#screeningPauseButton");
const screeningStopButton = document.querySelector("#screeningStopButton");
const screeningFiles = {
    imax: { url: "/screening-videos/imax.mp4" },
    standard: { url: "/screening-videos/standard.mp4" }
};
let activeScreeningType = null;
if (selectedMovieTitle) selectedMovieTitle.textContent = activeMovie.title;

function renderMovieShelf() {
    if (!movieShelf) return;
    movieShelf.replaceChildren();
    for (const movie of movies) {
        const card = document.createElement("button");
        card.className = "movie-card";
        card.type = "button";
        card.setAttribute("aria-pressed", String(movie.id === activeMovie.id));
        if (movie.id === activeMovie.id) card.classList.add("selected");

        const poster = document.createElement("img");
        poster.className = "movie-poster";
        poster.src = movie.poster;
        poster.alt = `${movie.title} poster`;
        poster.loading = "lazy";

        const copy = document.createElement("span");
        copy.className = "movie-copy";
        const title = document.createElement("span");
        title.className = "movie-title";
        title.textContent = movie.title;
        const genre = document.createElement("span");
        genre.className = "movie-genre";
        genre.textContent = movie.genre;
        const rating = document.createElement("span");
        rating.className = "movie-rating";
        rating.textContent = `★ ${movie.rating}  ·  4K`;
        copy.append(title, genre, rating);
        card.append(poster, copy);
        card.addEventListener("click", () => {
            if (activeMovie.id === movie.id) return;
            activeMovie = movie;
            renderer?.setMovie(movie);
            activeLayout = Object.keys(movie.screenings)[0];
            layoutPicker.value = activeLayout;
            updateShowtimeOptions();
            changeLayout(activeLayout);
            renderMovieShelf();
            showToast(`${movie.title} selected`);
        });
        movieShelf.append(card);
    }
}

function makeSeat(layout, section, row, seatNumber, x, y, z, premium, unavailable) {
    const category = premium ? "premium" : "standard";
    const prices = priceTable[layout];
    return {
        id: `${layout}-${section}-${row}-${seatNumber}`,
        section,
        row,
        seatNumber,
        x,
        y,
        z,
        category,
        price: prices[section]?.[category] ?? prices[category],
        unavailable
    };
}

function addThreeBlocks(seats, config) {
    const { layout, section, rows, y = 0.14, z = -8, spacing = 0.62, rowRise = 0.18, count = 30, premiumRows = [], accessible = false } = config;
    rows.forEach((row, rowIndex) => {
        const seatCount = typeof count === "function" ? count(rowIndex) : count;
        const leftSeats = Math.ceil(seatCount * 0.23);
        const rightSeats = Math.ceil(seatCount * 0.23);
        const centerSeats = seatCount - leftSeats - rightSeats;
        for (let seatNumber = 1; seatNumber <= seatCount; seatNumber++) {
            let x;
            let block;
            if (seatNumber <= leftSeats) {
                block = "Left";
                x = -12.6 + (seatNumber - 1) * spacing;
            } else if (seatNumber <= leftSeats + centerSeats) {
                block = "Centre";
                x = -4.8 + (seatNumber - leftSeats - 1) * spacing;
            } else {
                block = "Right";
                x = 7.7 + (seatNumber - leftSeats - centerSeats - 1) * spacing;
            }
            const curvedZ = z + rowIndex * 0.72 + Math.abs(x) * 0.018;
            const premium = premiumRows.includes(rowIndex) && block === "Centre";
            const isAccessible = accessible && rowIndex === 4 && block === "Centre"
                && [2, 3].includes(seatNumber - leftSeats);
            const seat = makeSeat(layout, section, row, seatNumber, x, y + rowIndex * rowRise, curvedZ, premium, false);
            seat.category = isAccessible ? "standard" : seat.category;
            seat.accessible = isAccessible;
            seat.unavailable = (rowIndex * 37 + seatNumber * 13 + section.length) % 97 === 0;
            seats.push(seat);
        }
    });
}

function createLayout(layout) {
    const seats = [];
    if (layout === "imax") {
        const rows = ["U", "T", "S", "R", "Q", "P", "O", "N", "M", "L", "K", "J", "H", "G", "F", "E", "D", "C", "B", "A", "V", "W", "X"];
        addThreeBlocks(seats, {
            layout, section: "IMAX", rows, z: -8.8, spacing: 0.61,
            count: (index) => index < 10 ? 28 : index < 20 ? 30 : 26,
            premiumRows: [8, 9, 10, 11, 12], accessible: true
        });
    } else if (layout === "standard3") {
        addThreeBlocks(seats, {
            layout, section: "Orchestra",
            rows: ["CC", "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X"],
            z: -11, spacing: 0.61, count: (index) => index < 8 ? 30 : 34,
            premiumRows: [6, 7, 8, 9, 10]
        });
    } else {
        addThreeBlocks(seats, {
            layout, section: "Standard",
            rows: ["AA", "BB", "CC", "DD", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"],
            z: -8, spacing: 0.66, count: (index) => index < 4 ? 22 : 24,
            premiumRows: [9, 10, 11], accessible: true
        });
    }
    return seats;
}

function currency(amount) {
    return `₹${amount.toLocaleString("en-IN")}`;
}

function updateSelection() {
    const selected = currentSeats.filter((seat) => selectedSeatIds.has(seat.id));
    const tickets = selected.reduce((sum, seat) => sum + seat.price, 0);
    const fee = selected.length * 15;
    countLabel.textContent = selected.length === 0 ? "No seats selected"
        : `${selected.length} seat${selected.length === 1 ? "" : "s"} selected`;
    ticketCount.textContent = `(${selected.length})`;
    ticketPrice.textContent = currency(tickets);
    feeLabel.textContent = currency(fee);
    totalLabel.textContent = currency(tickets + fee);
    clearButton.disabled = selected.length === 0;
    continueButton.disabled = selected.length === 0 || !bookingEnabled;
    seatList.replaceChildren();

    if (selected.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-selection";
        empty.textContent = "Your seats will appear here";
        seatList.append(empty);
    } else {
        for (const seat of selected) {
            const item = document.createElement("li");
            const name = document.createElement("span");
            name.textContent = `${seat.section} · ${seat.row}${seat.seatNumber}`;
            const price = document.createElement("small");
            price.textContent = currency(seat.price);
            item.append(name, price);
            seatList.append(item);
        }
    }

    renderer?.setSelectedSeats(selectedSeatIds);
    for (const button of seatMapView.querySelectorAll(".seat-map-seat")) {
        const selected = selectedSeatIds.has(button.dataset.seatId);
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
    }
}

function renderSeatMap() {
    seatMapView.replaceChildren();
    const screen = document.createElement("div");
    screen.className = "seat-map-screen";
    screen.textContent = "SCREEN";
    seatMapView.append(screen);
    const sections = new Map();
    for (const seat of currentSeats) {
        if (!sections.has(seat.section)) sections.set(seat.section, new Map());
        const rows = sections.get(seat.section);
        if (!rows.has(seat.row)) rows.set(seat.row, []);
        rows.get(seat.row).push(seat);
    }

    for (const [sectionName, rows] of sections) {
        const section = document.createElement("section");
        section.className = "seat-map-section";
        const heading = document.createElement("h3");
        heading.className = "seat-map-section-title";
        heading.textContent = sectionName;
        section.append(heading);

        for (const [rowName, seats] of rows) {
            const row = document.createElement("div");
            row.className = "seat-map-row";
            row.setAttribute("role", "group");
            row.setAttribute("aria-label", `${sectionName}, row ${rowName}`);
            const label = document.createElement("span");
            label.className = "seat-map-row-label";
            label.textContent = rowName;
            row.append(label);

            seats.sort((first, second) => first.seatNumber - second.seatNumber);
            let previousSeat = null;
            for (const seat of seats) {
                const button = document.createElement("button");
                button.className = "seat-map-seat";
                if (seat.category === "premium") button.classList.add("premium");
                button.type = "button";
                button.textContent = seat.seatNumber;
                button.dataset.seatId = seat.id;
                button.disabled = seat.unavailable;
                button.setAttribute("aria-pressed", "false");
                const status = seat.unavailable ? "unavailable" : `${seat.category}, ${currency(seat.price)}`;
                button.setAttribute("aria-label", `${sectionName}, row ${rowName}, seat ${seat.seatNumber}, ${status}`);
                button.title = `${sectionName} · Row ${rowName} · Seat ${seat.seatNumber} · ${seat.unavailable ? "Unavailable" : currency(seat.price)}`;
                if (previousSeat && seat.x - previousSeat.x > 2) button.classList.add("aisle-before");
                button.addEventListener("click", () => selectSeat(seat));
                row.append(button);
                previousSeat = seat;
            }
            section.append(row);
        }
        seatMapView.append(section);
    }
}

function changeLayout(layout) {
    if (activeScreeningType && activeScreeningType !== screeningTypeForLayout(layout)) stopScreening();
    activeLayout = layout;
    selectedSeatIds.clear();
    currentSeats = createLayout(layout);
    renderer?.setInterior(screens[layout].interior);
    renderer?.setSeats(currentSeats);
    renderSeatMap();
    updateSelection();
    seatTooltip.textContent = `${currentSeats.length.toLocaleString("en-IN")} seats · Click available seats to select`;
    updateScreeningControls();
}

function screeningTypeForLayout(layout) {
    return layout === "imax" ? "imax" : "standard";
}

function updateScreeningControls() {
    const type = screeningTypeForLayout(activeLayout);
    const file = screeningFiles[type];
    const isCurrentVideo = activeScreeningType === type
        && screeningVideo.src === new URL(file.url, window.location.href).href;
    screeningPlayButton.textContent = `Play on ${screens[activeLayout].label.split(" · ")[0]}`;
    screeningPlayButton.disabled = false;
    screeningPauseButton.disabled = !isCurrentVideo;
    screeningPauseButton.textContent = isCurrentVideo && screeningVideo.paused ? "Resume" : "Pause";
    screeningStopButton.disabled = !activeScreeningType;
}

function stopScreening() {
    screeningVideo.pause();
    screeningVideo.removeAttribute("src");
    screeningVideo.load();
    activeScreeningType = null;
    renderer?.setVideo(null);
    updateScreeningControls();
    screeningStatus.textContent = "Test screening stopped.";
}

async function playScreening() {
    const type = screeningTypeForLayout(activeLayout);
    const file = screeningFiles[type];
    if (!file) return;

    if (activeScreeningType !== type
            || screeningVideo.src !== new URL(file.url, window.location.href).href) {
        screeningVideo.pause();
        screeningVideo.src = file.url;
        screeningVideo.load();
        activeScreeningType = type;
    } else if (screeningVideo.ended) {
        screeningVideo.currentTime = 0;
    }

    try {
        screeningVideo.muted = false;
        await screeningVideo.play();
        renderer?.setVideo(screeningVideo);
        screeningStatus.textContent = `Playing with audio on ${screens[activeLayout].label.split(" · ")[0]}.`;
    } catch (error) {
        activeScreeningType = null;
        renderer?.setVideo(null);
        screeningStatus.textContent = `Could not play this video: ${error.message}`;
        console.error("Could not start the local test screening.", error);
    }
    updateScreeningControls();
}

screeningPlayButton.addEventListener("click", playScreening);
screeningPauseButton.addEventListener("click", async () => {
    if (screeningVideo.paused) {
        await playScreening();
        return;
    }
    screeningVideo.pause();
    screeningStatus.textContent = "Test screening paused.";
    updateScreeningControls();
});
screeningStopButton.addEventListener("click", stopScreening);
screeningVideo.addEventListener("ended", () => {
    screeningStatus.textContent = "Test screening finished.";
    updateScreeningControls();
});
screeningVideo.addEventListener("error", () => {
    if (!activeScreeningType) return;
    const message = screeningVideo.error?.message || "The assigned local video could not be loaded.";
    screeningStatus.textContent = `Could not load this video: ${message}`;
    updateScreeningControls();
});

seatMapToggle.addEventListener("click", () => {
    const showMap = seatMapView.hidden;
    seatMapView.hidden = !showMap;
    seatMapView.parentElement.classList.toggle("map-mode", showMap);
    seatMapToggle.textContent = showMap ? "Back to 3D view" : "Easy seat map";
    seatMapToggle.setAttribute("aria-pressed", String(showMap));
    auditoriumModeLabel.textContent = showMap ? "EASY SEAT MAP" : "LIVE 3D VIEW";
    if (showMap) seatMapView.querySelector(".seat-map-seat:not(:disabled)")?.focus();
});

function showToast(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function updateShowtimeOptions() {
    const now = new Date();
    const today = localDateString(now);
    const selectedDate = document.querySelector("#showDate").value;
    const compatibleScreens = Object.keys(activeMovie.screenings);
    if (!compatibleScreens.includes(activeLayout)) activeLayout = compatibleScreens[0];
    for (const option of layoutPicker.options) {
        option.disabled = !compatibleScreens.includes(option.value);
    }
    layoutPicker.value = activeLayout;

    const screenChip = document.querySelector("#screenName");
    screenChip.textContent = screens[activeLayout].name;
    const times = activeMovie.screenings[activeLayout] ?? [];
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const availableTimes = times.filter((time) => selectedDate !== today || time > currentTime);
    if (!availableTimes.includes(activeTime)) activeTime = availableTimes[0] ?? "";

    const timeOptions = document.querySelector("#timeOptions");
    timeOptions.replaceChildren();
    for (const time of times) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "time-button";
        button.dataset.time = time;
        button.textContent = new Intl.DateTimeFormat("en-IN", {
            hour: "numeric", minute: "2-digit", hour12: true
        }).format(new Date(`2000-01-01T${time}:00`));
        button.disabled = !availableTimes.includes(time);
        button.classList.toggle("active", !button.disabled && time === activeTime);
        button.addEventListener("click", () => {
            if (time === activeTime) return;
            activeTime = time;
            timeOptions.querySelectorAll(".time-button").forEach((item) => {
                item.classList.toggle("active", item.dataset.time === activeTime);
            });
            selectedSeatIds.clear();
            updateSelection();
        });
        timeOptions.append(button);
    }
    if (times.length === 0) {
        const message = document.createElement("span");
        message.className = "no-showtimes";
        message.textContent = "No screenings on this screen";
        timeOptions.append(message);
    } else if (availableTimes.length === 0) {
        const message = document.createElement("span");
        message.className = "no-showtimes";
        message.textContent = "No more screenings today";
        timeOptions.append(message);
    }
    activeDate = selectedDate;
    const formatChip = document.querySelector(".format-chip");
    formatChip.setAttribute("aria-label", screens[activeLayout].name);
    formatChip.querySelector(".screen-label").textContent = screens[activeLayout].name;
}

function isScheduledShow(movieTitle, layout, time) {
    const movie = movies.find((item) => item.title === movieTitle);
    return Boolean(movie?.screenings[layout]?.includes(time));
}

function applyScreenInteriors(interiors) {
    if (!Array.isArray(interiors) || interiors.length !== Object.keys(screens).length) {
        throw new Error("The screen interior configuration must contain all three screens.");
    }
    const loadedCodes = new Set();
    for (const config of interiors) {
        const layout = Object.keys(screens).find((key) => screens[key].screenCode === config.screenCode);
        if (!layout || loadedCodes.has(config.screenCode) || !Number.isFinite(config.aspectRatio)
                || config.aspectRatio <= 1 || !/^#[0-9a-f]{6}$/i.test(config.wallColor)
                || !/^#[0-9a-f]{6}$/i.test(config.ceilingColor)
                || !/^#[0-9a-f]{6}$/i.test(config.trimColor)
                || !/^#[0-9a-f]{6}$/i.test(config.accentColor)
                || !/^#[0-9a-f]{6}$/i.test(config.seatColor)
                || !/^#[0-9a-f]{6}$/i.test(config.aisleLightColor)) {
            throw new Error(`Invalid screen interior configuration for ${config.screenCode ?? "unknown screen"}.`);
        }
        loadedCodes.add(config.screenCode);
        const ratioLabel = config.aspectRatio > 2.2 ? "2.35:1" : "16:9";
        screens[layout].name = `${config.screenName} · ${ratioLabel}`;
        screens[layout].interior = config;
    }
    renderer?.setInterior(screens[activeLayout].interior);
}

async function loadScreenInteriors() {
    let response;
    try {
        response = await fetch("/api/screens/interiors");
        if (!response.ok) throw new Error(`Interior service returned ${response.status}.`);
    } catch (apiError) {
        console.warn("Could not load screen interiors from the Java/PostgreSQL service; trying bundled defaults.", apiError);
        try {
            response = await fetch("/screen-interiors.json");
            if (!response.ok) throw new Error(`Bundled screen interiors returned ${response.status}.`);
        } catch (fallbackError) {
            console.error("Could not load screen interior configuration.", fallbackError);
            showToast("Screen interior configuration could not be loaded.");
            return;
        }
    }
    try {
        applyScreenInteriors(await response.json());
    } catch (error) {
        console.error("Invalid screen interior configuration.", error);
        showToast("Screen interior configuration is invalid.");
    }
}

async function postForm(url, values) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams(values)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Seatix request failed (${response.status}).`);
    return result;
}

function clearPaymentQr(placeholder = "QR is only available while checkout is pending.") {
    paymentQrRequestId++;
    if (paymentQrObjectUrl) URL.revokeObjectURL(paymentQrObjectUrl);
    paymentQrObjectUrl = null;
    paymentQrImage.removeAttribute("src");
    paymentQrImage.hidden = true;
    paymentQrPlaceholder.textContent = placeholder;
    paymentQrPlaceholder.hidden = false;
}

async function loadPaymentQr(bookingId) {
    clearPaymentQr("Preparing demo QR…");
    const requestId = paymentQrRequestId;
    try {
        const response = await fetch(`/api/bookings/${bookingId}/payment/qr`, { method: "POST" });
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || `QR service returned ${response.status}.`);
        }
        const image = await response.blob();
        if (image.type !== "image/png") throw new Error("Seatix returned an invalid QR image.");
        if (requestId !== paymentQrRequestId) return;
        paymentQrObjectUrl = URL.createObjectURL(image);
        paymentQrImage.src = paymentQrObjectUrl;
        paymentQrImage.hidden = false;
        paymentQrPlaceholder.hidden = true;
    } catch (error) {
        if (requestId !== paymentQrRequestId) return;
        paymentQrPlaceholder.textContent = "Demo QR unavailable";
        paymentQrMessage.textContent = `Use the simulation buttons below. ${error.message}`;
        console.warn("Could not load a simulated payment QR code.", error);
    }
}

function openPaymentDialog(booking) {
    pendingBooking = booking;
    document.querySelector("#checkoutBookingId").textContent = `#${booking.bookingId}`;
    const showDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" })
        .format(new Date(`${activeDate}T00:00:00`));
    document.querySelector("#checkoutMovie").textContent =
        `${activeMovie.title} · ${screens[activeLayout].label} · ${showDate}, ${activeTime}`;
    document.querySelector("#checkoutSeats").textContent = booking.seats.join(", ");
    document.querySelector("#checkoutTotal").textContent = currency(booking.total);
    setPaymentStatus("PENDING", "Payment pending", "No payment has been processed.");
    paymentActions.hidden = false;
    retryPaymentButton.hidden = true;
    closePaymentButton.disabled = true;
    paymentDialog.showModal();
    paymentQrMessage.textContent = "Scan with another device's QR reader. Use the buttons below to simulate a result; no money moves.";
    loadPaymentQr(booking.bookingId);
}

function saveBookingHistory(booking) {
    window.SeatixBookingHistory.save({
        bookingId: booking.bookingId,
        bookingTime: new Date().toISOString(),
        bookingStatus: booking.bookingStatus || "PENDING",
        paymentStatus: "PENDING",
        amount: Number(booking.total),
        movie: activeMovie.title,
        showDate: activeDate,
        showTime: activeTime,
        auditorium: screens[activeLayout].name,
        seats: booking.seats
    });
}

function setPaymentStatus(status, title, message) {
    paymentStatusPanel.dataset.status = status;
    paymentStatusTitle.textContent = title;
    paymentStatusMessage.textContent = message;
    document.querySelector("#paymentStatusIcon").textContent =
        status === "SUCCESS" ? "✓" : status === "FAILED" ? "!" : "…";
}

function showBookingConfirmation(booking, amount) {
    const showDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" })
        .format(new Date(`${activeDate}T00:00:00`));
    document.querySelector("#successBookingId").textContent = `#${booking.bookingId}`;
    document.querySelector("#successMovie").textContent =
        `${activeMovie.title} · ${screens[activeLayout].label} · ${showDate}, ${activeTime}`;
    document.querySelector("#successSeats").textContent = booking.seats.join(", ");
    document.querySelector("#successTotal").textContent = currency(amount);
    document.querySelector("#successPayment").textContent = "Successful · simulated";
    paymentDialog.close();
    bookingSuccessPage.hidden = false;
    bookingSuccessPage.focus();
}

async function simulatePayment(outcome) {
    if (!pendingBooking) return;
    for (const button of paymentActions.querySelectorAll("button")) button.disabled = true;
    paymentStatusMessage.textContent = "Updating the payment record…";
    try {
        const result = await postForm(`/api/bookings/${pendingBooking.bookingId}/payment`, { outcome });
        const total = Number(result.total);
        if (!Number.isFinite(total)) {
            throw new Error("Seatix did not return a valid payment total.");
        }
        pendingBooking.paymentStatus = result.paymentStatus;
        pendingBooking.bookingStatus = result.bookingStatus;
        pendingBooking.total = total;
        window.SeatixBookingHistory.update(result.bookingId, {
            bookingStatus: result.bookingStatus,
            paymentStatus: result.paymentStatus,
            amount: total
        });
        if (result.paymentStatus === "SUCCESS" && result.bookingStatus === "CONFIRMED") {
            for (const seat of currentSeats) {
                if (selectedSeatIds.has(seat.id)) seat.unavailable = true;
            }
            selectedSeatIds.clear();
            updateSelection();
            paymentActions.hidden = true;
            retryPaymentButton.hidden = true;
            showBookingConfirmation(pendingBooking, total);
        } else if (result.paymentStatus === "FAILED") {
            const expired = result.bookingStatus === "CANCELLED" && outcome === "success";
            setPaymentStatus("FAILED", expired ? "Checkout expired · no charge made" : "Payment failed · no charge made",
                expired ? "This pending checkout expired. Your seats have been released." : "Your payment is recorded as failed and the seats have been released.");
            paymentActions.hidden = true;
            retryPaymentButton.hidden = false;
            clearPaymentQr("Checkout ended");
            paymentQrMessage.textContent = "This demo QR is no longer active. No money was charged.";
        } else {
            throw new Error("The payment status returned by Seatix was not final.");
        }
        closePaymentButton.disabled = false;
        showToast(`Booking #${result.bookingId}: payment ${result.paymentStatus.toLowerCase()}.`);
    } catch (error) {
        paymentStatusMessage.textContent = error.message;
        showToast(error.message);
        for (const button of paymentActions.querySelectorAll("button")) button.disabled = false;
    }
}

function selectSeat(seat) {
    if (seat.unavailable) {
        showToast("That seat is marked unavailable in this sample layout.");
        return;
    }
    if (selectedSeatIds.has(seat.id)) selectedSeatIds.delete(seat.id);
    else selectedSeatIds.add(seat.id);
    updateSelection();
}

function connectServiceStatus() {
    const status = document.querySelector("#serviceStatus");
    fetch("/api/health")
        .then((response) => {
            if (!response.ok) throw new Error(`Seatix server returned ${response.status}`);
            return response.json();
        })
        .then((data) => {
            if (data.status !== "ok") {
                status.textContent = "View-only demo · booking disabled";
                bookingAvailability.textContent = "Bookings are disabled in this public demo.";
                return;
            }
            bookingEnabled = data.database === "connected";
            status.textContent = bookingEnabled
                ? "Database connected · simulated payments"
                : "View-only demo · booking disabled";
            bookingAvailability.textContent = bookingEnabled
                ? "Booking checkout is available; payments are simulated."
                : "Bookings are disabled in this public demo.";
            updateSelection();
        })
        .catch(() => {
            bookingEnabled = false;
            status.textContent = "View-only demo · booking disabled";
            bookingAvailability.textContent = "Bookings are disabled in this public demo.";
            updateSelection();
        });
}

renderMovieShelf();

const showDateInput = document.querySelector("#showDate");
showDateInput.min = localDateString();
const localTime = `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
const hasShowtimeToday = movies.some((movie) =>
    Object.values(movie.screenings).some((times) => times.some((time) => time > localTime)));
const defaultShowDate = new Date();
if (!hasShowtimeToday) defaultShowDate.setDate(defaultShowDate.getDate() + 1);
showDateInput.value = localDateString(defaultShowDate);
showDateInput.addEventListener("change", () => {
    updateShowtimeOptions();
    selectedSeatIds.clear();
    updateSelection();
});

layoutPicker.addEventListener("change", () => {
    activeLayout = layoutPicker.value;
    updateShowtimeOptions();
    changeLayout(activeLayout);
});
clearButton.addEventListener("click", () => {
    selectedSeatIds.clear();
    updateSelection();
});
continueButton.addEventListener("click", () => {
    if (!bookingEnabled) return;
    const seats = currentSeats.filter((seat) => selectedSeatIds.has(seat.id));
    if (seats.length === 0) return;
    contactFormError.hidden = true;
    contactFormError.textContent = "";
    contactDialog.showModal();
    document.querySelector("#contactPhone").focus();
});

contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!contactForm.reportValidity()) return;
    const seats = currentSeats.filter((seat) => selectedSeatIds.has(seat.id));
    if (seats.length === 0) {
        contactDialog.close();
        showToast("Select at least one seat to continue.");
        return;
    }
    const submitLabel = createBookingButton.innerHTML;
    createBookingButton.disabled = true;
    createBookingButton.textContent = "Creating booking…";
    continueButton.disabled = true;
    if (!activeTime || !isScheduledShow(activeMovie.title, activeLayout, activeTime)) {
        contactFormError.textContent = "Choose an available screening before continuing.";
        contactFormError.hidden = false;
        createBookingButton.disabled = false;
        createBookingButton.innerHTML = submitLabel;
        updateSelection();
        return;
    }
    const form = {
        movie: activeMovie.title,
        layout: activeLayout,
        date: activeDate,
        time: activeTime,
        phone: document.querySelector("#contactPhone").value.trim(),
        email: document.querySelector("#contactEmail").value.trim(),
        seats: seats.map((seat) => `${seat.section}:${seat.row}:${seat.seatNumber}`).join(",")
    };
    try {
        const booking = await postForm("/api/bookings", form);
        saveBookingHistory(booking);
        contactDialog.close();
        openPaymentDialog(booking);
    } catch (error) {
        contactFormError.textContent = error.message;
        contactFormError.hidden = false;
        showToast(error.message);
    } finally {
        createBookingButton.disabled = false;
        createBookingButton.innerHTML = submitLabel;
        updateSelection();
    }
});

const referenceDialog = document.querySelector("#referenceDialog");
document.querySelector("#referencesButton").addEventListener("click", () => referenceDialog.showModal());
document.querySelector("#referencesButtonBottom").addEventListener("click", () => referenceDialog.showModal());
document.querySelector("#closeDialog").addEventListener("click", () => referenceDialog.close());
document.querySelector("#closeContactDialog").addEventListener("click", () => contactDialog.close());
document.querySelector("#cancelContactDialog").addEventListener("click", () => contactDialog.close());
document.querySelector("#simulatePaymentSuccess").addEventListener("click", () => simulatePayment("success"));
document.querySelector("#simulatePaymentFailure").addEventListener("click", () => simulatePayment("failed"));
document.querySelector("#bookingSuccessDone").addEventListener("click", () => {
    window.location.assign("/");
});
retryPaymentButton.addEventListener("click", () => {
    paymentDialog.close();
    pendingBooking = null;
});
closePaymentButton.addEventListener("click", () => {
    if (pendingBooking?.paymentStatus === "PENDING") return;
    paymentDialog.close();
    pendingBooking = null;
});
paymentDialog.addEventListener("cancel", (event) => {
    if (pendingBooking?.paymentStatus === "PENDING") event.preventDefault();
    else pendingBooking = null;
});
paymentDialog.addEventListener("close", () => clearPaymentQr());

try {
    renderer = new SeatixRenderer(document.querySelector("#auditoriumCanvas"), {
        onSeatClick: selectSeat,
        onSeatHover: (seat) => {
            seatTooltip.textContent = seat
                ? `${seat.section} · Row ${seat.row} · Seat ${seat.seatNumber} · ${currency(seat.price)}${seat.unavailable ? " · Unavailable" : ""}`
                : "Drag to look around · Click a seat to select";
        }
    });
    renderer.setMovie(activeMovie);
    renderer.setSeats(currentSeats);
    document.querySelector("#zoomIn").addEventListener("click", () => renderer.zoom(-3));
    document.querySelector("#zoomOut").addEventListener("click", () => renderer.zoom(3));
    document.querySelector("#resetCamera").addEventListener("click", () => renderer.resetCamera());
} catch (error) {
    seatTooltip.textContent = "WebGL could not start. Enable hardware acceleration or try a WebGL-compatible browser.";
    document.querySelector("#serviceStatus").textContent = "3D rendering unavailable";
    console.error("Could not initialize the Seatix 3D auditorium.", error);
}

updateShowtimeOptions();
changeLayout(activeLayout);
connectServiceStatus();
loadScreenInteriors();
