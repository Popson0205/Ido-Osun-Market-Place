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

## Storefront
Marketplace-style home page: rotating banner, category icons, Deals, Just in, and local stores. Search covers products, vendors and categories; shop pages have category chips, sorting and Load more. Each product has a detail page (photo, price, discount, description, vendor, share, ask the vendor on WhatsApp) and the cart steppers work from any page. On phones there is a bottom bar (Home, Categories, Cart, Account); on desktop the grid widens automatically.
Vendors can set an optional **old price** (shows a -% badge and puts the product in Deals) and a short **description** from the dashboard.

## Demo data for presentations
Admin screen > **Demo data** > *Load demo products*. It adds 9 sample stores and 28 products across all categories (9 with deal prices) with placeholder images. Enter your own WhatsApp number when asked, so orders placed during the demo open in your WhatsApp. The alert shows a demo vendor login so you can show the vendor dashboard. *Remove demo data* deletes everything it created and nothing else. Remove the demo data before opening to the public.
To use real photos, replace files in `seed/images/` (same names, JPEG, under 400 KB) and press Reload. Edit `seed/demo.json` to change names, prices or descriptions.

## Order alerts
Vendors see a badge on the account icon and a NEW tag on fresh orders in their dashboard. For email alerts too, create a free account at resend.com, verify your sending address, and set `RESEND_API_KEY` and `MAIL_FROM`. Without them the app simply skips email.

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
password reset, email verification, Google sign-in, and delivery tracking. The referral code is stored but not used for rewards.
