# Ido-Osun Market

Node.js + Express + PostgreSQL marketplace. Vendors register, an admin approves them, vendors manage their own products, and every order is sent to that vendor's WhatsApp.

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`.
3. `npm start` and open http://localhost:3000 (tables are created automatically on first start).

## Become admin
Register on the site with the exact email set in `ADMIN_EMAIL`. That account gets the admin role and sees "Approve vendors" under the account icon.

## How it works
- **Vendor signup:** the "registering as a vendor" toggle creates the account plus a store with status `pending`.
- **Approval:** only `approved` stores appear publicly. Admin can approve, reject or suspend.
- **Vendor dashboard:** edit store details, add/hide/delete products, change prices, see recent orders.
- **Ordering:** the cart is grouped by store. The server recomputes prices from the database, saves the order, and returns a `wa.me` link to that vendor's number with the order text. The vendor sees it in their dashboard too.

## Maps and shop locations
- **Vendors mark their shop on a map** when they register (required) and can move the pin later from the dashboard. They tap the map, drag the pin, use their phone's GPS, or search a town or landmark. Nobody types coordinates. There is a Streets/Satellite switch, an optional landmark field ("opposite the market"), and a choice to hide the exact pin from buyers (for home-based vendors). Admins always see it.
- **Buyers** see a map and "Get directions" on each store page, and a **Store map** page (bottom bar, footer, home page) with "Stores near me", which sorts by distance. A hidden pin is never exposed anywhere public, and no distance is calculated for it.
- **Admin site** (`/admin`) has a **Map** tab with the **Vendor map**: every vendor with a pin, coloured by status (approved, pending, rejected, suspended), with filters, a popup with owner, WhatsApp and approve/reject buttons, "Show on map" on each vendor, a list of vendors with no pin yet, and **Download GeoJSON** (WGS84 points, ready for QGIS or ArcGIS).
- **Data:** `stores.lat`, `lng`, `address`, `location_public` (plain WGS84). Server rule: a pin must be inside Nigeria's bounding box (lat 4 to 14, lng 2.6 to 14.8). Distances use the haversine formula in SQL. If you later need spatial queries (radius, polygons, clustering), enable PostGIS on Railway (use their PostGIS template database), add a `geography(Point,4326)` column filled from lat/lng, and swap the distance query.
- **Libraries and tiles:** Leaflet 1.9.4 is bundled in `public/vendor/leaflet` (no CDN needed). Streets tiles come from OpenStreetMap's public servers, which are fine for a community launch; if traffic grows, use a tile provider (MapTiler, Stadia, Mapbox and others) and change the URL in `newMap()` in `public/index.html`. The Satellite layer uses Esri World Imagery with attribution; check Esri's terms before commercial use, or remove that layer. Place search uses OpenStreetMap's Nominatim, only when a vendor presses Search (their usage policy asks for light use, so use a geocoding provider if you expect heavy use).
- **Existing vendors** (added before this version) have no pin: the dashboard asks them to add one, and the admin map lists them as "No location yet". The demo stores have approximate pins around Ido-Osun, Osogbo, Ede and Ikirun.

## Storefront
Marketplace-style home page: rotating banner, category icons, Deals, Just in, and local stores. Search covers products, vendors and categories; shop pages have category chips, sorting and Load more. Each product has a detail page (photo, price, discount, description, vendor, share, ask the vendor on WhatsApp) and the cart steppers work from any page. On phones there is a bottom bar (Home, Categories, Cart, Account); on desktop the grid widens automatically.
Vendors can set an optional **old price** (shows a -% badge and puts the product in Deals) and a short **description** from the dashboard.

## Demo data for presentations
Admin screen > **Demo data** > *Load demo products*. It adds 9 sample stores and 28 products across all categories (9 with deal prices) with placeholder images. Enter your own WhatsApp number when asked, so orders placed during the demo open in your WhatsApp. The alert shows a demo vendor login so you can show the vendor dashboard. *Remove demo data* deletes everything it created and nothing else. Remove the demo data before opening to the public.
To use real photos, replace files in `seed/images/` (same names, JPEG, under 400 KB) and press Reload. Edit `seed/demo.json` to change names, prices or descriptions.

## Offline mode
Pages and products people have opened recently (and their photos) are saved on the phone and still open without internet, with an "You are offline" banner because prices may be out of date. Placing orders, logging in and the vendor dashboard need a connection. Pages that were never opened show a friendly "Try again" message instead of an error.

## Install guide
`#/install` explains how to add the app to the home screen on Android and iPhone and shows a QR code. The home page shows a small "Get the app" strip on phones (it can be dismissed). The poster at `/poster.html` has a third QR code that opens the install guide.

## Phone notifications for vendors
Vendors can turn on notifications from their dashboard, and every new order then buzzes their phone. To enable it on the server, run `npm run vapid` once, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (for example `mailto:you@example.com`) on Railway and keep the private key secret. Without these the notification card simply does not appear. On iPhone (iOS 16.4 or later) the vendor must first add the app to the Home Screen and open it from there. Notifications are only accepted from the phone makers' own push services.

## Email (Brevo)
Brevo sends: new-order alerts to vendors, a welcome email to new vendors, a new-vendor alert to you (the admin), approved / rejected / suspended emails to vendors, and password reset links ("Forgot password?" on the login page). Vendors also see a badge on the account icon and a NEW tag on fresh orders in their dashboard. Without the email settings the app works as before and simply skips email.
1. Create a Brevo account at brevo.com.
2. Add and verify your sender address (Settings, then Senders, Domains & Dedicated IPs, then Senders). An address on a domain you own works best.
3. Create an API key (Settings, then API Keys, then Generate a new API key). Brevo's menus change now and then.
4. On Railway add `BREVO_API_KEY`, `MAIL_FROM` (the verified sender), `MAIL_FROM_NAME` (optional) and `APP_URL` (your live site address, for example `https://market.yourdomain.com`, no trailing slash).
5. Open the admin screen and press **Send me a test email**. If Brevo rejects it, the message tells you why (most often the sender is not verified yet).
Brevo's free plan has a daily sending limit, so check the current number on their pricing page. Demo accounts are never emailed. Password reset needs both Brevo and `APP_URL`, because the link in the email is built from it. Reset links work once and expire after an hour; a person who is already logged in elsewhere stays logged in until their session expires (7 days).

## Safety pages and reports
The footer links to About, Safety tips, FAQ, Terms of service, Privacy policy and Contact. Set `ADMIN_WHATSAPP` so the Contact page and footer show your WhatsApp number. Each store has a "Report this store" button; reports appear at the top of the admin screen with Resolve and Suspend store buttons. The terms and privacy texts are a plain-language starting point: have a lawyer review them before launch and edit them in `public/index.html` (`PG` object).

## Install app and QR poster
The site is installable on phones (an "Install app" link appears in the footer when the browser allows it). Open `/poster.html` on your live domain to print a poster with two QR codes: one to shop, one to register as a vendor.

## Photos
Vendors add a store photo and a photo per product from their dashboard. The browser shrinks each photo to about 900px JPEG (under 400 KB) before upload, and the server keeps it in PostgreSQL, so no extra storage service or Railway volume is needed. This is fine for hundreds of products; if you grow to thousands, move images to Cloudflare R2 or S3.

## Deploy on Railway
1. Push this folder to a GitHub repo (the `.gitignore` below keeps secrets out: add `.env` and `node_modules`).
2. Railway: New Project > Deploy from GitHub repo.
3. In the same project: New > Database > Add PostgreSQL.
4. Open the web service > Variables and add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (reference to the Postgres service)
   - `JWT_SECRET` = a long random string (24+ characters)
   - `ADMIN_EMAIL` = the email you will register as admin
5. Web service > Settings > Networking > Generate Domain (or add your own domain).
6. Open the domain, register with `ADMIN_EMAIL`, and you are the admin.

If the app logs a database SSL error, set `DB_SSL` to `true` or `false` to match your database.

## Not included yet
Email verification, Google sign-in, and delivery tracking. The referral code is stored but not used for rewards.
