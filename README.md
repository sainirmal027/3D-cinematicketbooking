# 🎬 Seatix - 3D Cinema Ticket Booking System

A modern, immersive 3D cinema ticket booking and theater management application built with Java, modern web technologies, and an interactive 3D auditorium experience.

![Seatix Preview](three_screen_overview.png)

---

## ✨ Features

* **Interactive 3D Auditoriums:** Experience a visually engaging seat selection process using custom-rendered layouts and theater interiors (IMAX, Standard, and VIP rooms).
* **Real-time Seat Selection:** Seamlessly pick, reserve, and manage seats across multiple screen types with instant updates.
* **Integrated Booking & Payments:** Supports secure booking workflows, contact info management, and payment processing QR codes.
* **Dynamic Media Support:** Includes high-definition screening trailers and immersive visual assets managed via Git LFS.
* **Robust Backend:** Powered by a solid Java backend architecture (`BookingService`, `SeatixServer`, and PostgreSQL database connectivity).

---

## 🛠️ Tech Stack

* **Backend:** Java (JDK 17+), Maven, PostgreSQL, Custom HTTP Server (`SeatixServer.java`)
* **Frontend:** HTML5, CSS3 (`styles.css`), JavaScript (`app.js`), interactive 3D/Canvas rendering elements
* **Deployment & Storage:** Docker, Render, Git LFS (Large File Storage for trailers and high-res assets)

---

## 🚀 Live Demo

Explore the live application deployed on the cloud:
👉 **[Launch Seatix Live App](https://seatix-rbwr.onrender.com/)**

---

## 💻 Local Setup & Installation

If you want to run the project locally on your machine, follow these steps:

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/sainirmal027/3D-cinematicketbooking.git](https://github.com/sainirmal027/3D-cinematicketbooking.git)
   cd 3D-cinematicketbooking

2. **Configure Database:**
   * Set up a local PostgreSQL database named `seatix`.
   * Run the initialization scripts located in the `database/` folder (such as `schema.sql`).

3. **Set Environment Variables:**
   ```bash
   export SEATIX_DB_URL="jdbc:postgresql://localhost:5432/seatix"
   export SEATIX_DB_USER="your_postgres_user"
   export SEATIX_DB_PASSWORD="your_postgres_password"

4. Build and Run:

Bash
mvn compile exec:java

5. Open your browser and navigate to http://localhost:8080.

Other than that tiny formatting check, your README is totally ready to go and looks like a top-tier developer project repository! How are you feeling about how the whole project turned out?
