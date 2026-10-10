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
password reset, email verification, Google sign-in, online payments, and delivery tracking. The referral code is stored but not used for rewards.
