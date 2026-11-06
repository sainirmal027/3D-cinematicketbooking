# Seatix cinema website

Seatix is a Java-served website with a browser-native WebGL auditorium. It uses no JavaScript framework or third-party 3D library. The Java sources and web assets are stored at the repository root; Maven packages the site assets into the server JAR.

## Database setup

Create an empty PostgreSQL database, then run `database/schema.sql` against it. The SQL migration files are for the former MySQL version and are not compatible with this PostgreSQL backend. Existing MySQL records are not automatically copied; migrate them separately before switching databases.

Set the JDBC connection settings in the same terminal used to start the site. The URL is optional for a local PostgreSQL database using the default port and database name.

```powershell
$env:SEATIX_DB_URL = "jdbc:postgresql://localhost:5432/seatix"
$env:SEATIX_DB_USER = "your_postgres_user"
$env:SEATIX_DB_PASSWORD = "your_postgres_password"
```

The site creates its demo guest, supported movie, auditorium and show records when the first booking is made. Do not use the generated demo guest for production customer accounts.

## Run locally

Requirements: JDK 17+, Maven 3.9+, and PostgreSQL.

```powershell
mvn compile exec:java
```

Open [http://localhost:8080](http://localhost:8080). Set `SEATIX_PORT` to change the default port. The website reports the database as unconfigured until the credentials are provided.

## Free backend deployment

The project includes a `Dockerfile` and a Render Blueprint in `render.yaml`. The app and its frontend are served together by the Java backend. For a free demo, use Render's free Docker web service with an external free PostgreSQL database such as Neon:

1. Create a PostgreSQL project with your database provider and run `database/schema.sql` against the database.
2. Push this repository to GitHub and connect it to Render using **New → Blueprint**. Render reads `render.yaml` and builds the Docker image, including the bundled screening videos.
3. When prompted, set `SEATIX_DB_URL` to the PostgreSQL connection URI from your provider (it starts with `postgresql://`). The backend accepts this URI directly and reads its username and password without exposing them as separate variables. Keep the URI in Render's secret environment settings, never in source control.
4. Wait for the deployment, then check `https://<your-service>.onrender.com/api/health`. Bookings are enabled when the response reports `"database":"connected"`.

The Render free web service spins down after inactivity and the Neon free database scales to zero, so the first request after a quiet period can be slow. This route is suitable for a demo, not production. Do not collect real customer data or sell real tickets until the authentication, payment, inventory, privacy, and operational requirements are implemented.

This project is currently a **demo**, not a production ticketing service: payment is simulated, seat availability is not loaded from a live theatre inventory, and customer contact details are stored without account verification or a self-service deletion flow. Visitors are warned to use test contact details only. Do not collect real customer data or sell real tickets until those production requirements are implemented.

### Free static demo: Vercel

The root `vercel.json` publishes only `src/main/resources/web`, which contains the interactive auditorium, supplied posters, and reference layouts. No JavaScript build tooling or package manager is required. This is a **view-only** deployment: Vercel does not run the Java/PostgreSQL backend, and `/api/health` is rewritten to a static response that keeps booking and contact-data collection disabled.

1. Import the private GitHub repository `sanjayudayashankar-dot/seatix` in the Vercel dashboard.
2. Keep the project root at the repository root. Vercel reads `vercel.json`; no build command or environment variables are needed.
3. Deploy, then use the HTTPS URL Vercel gives the project.
4. Open the public site, confirm it says **View-only demo · booking disabled**, and share the URL.

This static demo is separate from the Java server. The Vercel configuration is for static files only and does not provide booking or payment APIs. To enable the backend and bookings, deploy the Docker service described above; do not expose customer contact details in a public demo.

## Website controls

- Choose a movie from the poster shelf to update its poster and title on the curved auditorium screen, then pick a showtime.
- Choose a screen from the auditorium selector; only screens scheduled for the selected movie are available.
- The IMAX screen is rendered at 16:9; Standard screens 2 and 3 are rendered at 2.35:1.
- Use **Test screening** to play `screening-videos/imax.mp4` on IMAX or `screening-videos/standard.mp4` on either Standard screen. These are the two supplied clips; the IMAX copy is H.264/AAC-encoded for browser playback. Both play with audio and are not uploaded.
- The Java screen-interior service loads each room's colors, lighting, and aspect ratio from the `screen_interiors` SQL table. The WebGL renderer builds the ceiling, cove rings, acoustic wall slats, exit doors, aisle step lights, stage, and original seat rows from that screen profile. Screen 2 uses the Standard seat map; Screen 3 has Orchestra seating only, with no Mezzanine or Balcony rows, and a 2.35:1 screen.
- Drag to orbit, right-drag to pan, scroll to zoom, and click individual 3D seats to select them.
- Use **Easy seat map** to select seats by row with larger, keyboard-accessible buttons; selections stay in sync with the 3D view.
- Daily demo showtimes are scheduled across three screens without overlapping screenings on the same screen, allowing a 15-minute changeover based on estimated runtimes. Interstellar and The Dark Knight are scheduled only in IMAX; Resident Evil, Jailer 2, and Baththa are scheduled across Standard Screen 2 and Orchestra Screen 3. Select a film, screen, and available time before choosing seats. Confirm actual runtimes and showtimes before using a live schedule.
- Use “Seat map references” to inspect the supplied layout images.
- Continue to create a pending booking in PostgreSQL. The checkout dialog can simulate either a successful or failed payment; it never asks for card information and does not move money.
- A successful simulated payment opens a booking confirmation screen with the booking reference, movie, seats, total, and payment status.
- Before a booking is created, enter an Indian mobile number and email address. Mobile numbers are normalized to `+91` format and saved with that booking in `booking_contacts`.

## Booking and payment status

Bookings and simulated payment status are written through JDBC. A successful simulation changes the payment to `SUCCESS` and booking to `CONFIRMED`. A failed simulation changes the payment to `FAILED`, cancels the booking and releases its seats. Pending checkouts expire after 15 minutes. The unique `(show_id, seat_id)` database key prevents two concurrent bookings of the same seat. Payment status is always simulated; do not connect it to real card or bank details.
