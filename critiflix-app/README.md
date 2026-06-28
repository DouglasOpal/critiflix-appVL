# CritiFlix

Film-criticism platform built **exactly to the approved v3 design** (official logo pack, brand red `#E50914`, navy `#13294B`, all-caps CRITIFLIX wordmark, shutter-C mark).

Three parts in one repo:

| Folder    | What it is                                | Stack                                       | Runs here? |
|-----------|--------------------------------------------|---------------------------------------------|------------|
| `server/` | REST API + auth + points engine + admin host | Node.js + Express + **MongoDB/Mongoose** (ESM) | ✅ needs MongoDB |
| `mobile/` | Critic **and** Creator apps (role-gated)   | React Native + Expo (JavaScript)            | ✅ via Expo |
| `admin/`  | Operations console (analytics + management) | Single-page web app (vanilla JS + Chart.js), served by the API | ✅ yes      |

## What's new in this revision

1. **Admin web app** — the static showcase page is replaced by a functional console at `/admin`: admin login, an analytics dashboard (sign-ups, user mix, points-by-action charts, top titles), and management of titles, users, subscriptions, cashouts and integrations — all wired to the live `/api/admin/*` endpoints.
2. **No simulated status bar** — the fake battery/Wi-Fi/`9:41` row is gone; screens now use real device safe-area insets.
3. **Functional trailer upload (≤ 3 min / ≤ 200 MB)** — creators pick a real video; it's validated for length and size and uploaded **on its own** via `POST /api/uploads/video` (multer), served back from `/uploads`. The uploaded trailer is **playable in-app**: the film detail screen streams it with `expo-video`. The upload directory is auto-created on boot (no more `ENOENT`), and the file filter accepts by extension as well as mimetype (Android content-URI safety).
4. **Two poster sizes, uploaded separately** — the poster is its own upload step, independent of the trailer: pick an image, the app resizes it to a small (~360w) and large (~800w) JPEG and uploads each (`POST /api/uploads/image`). Browse lists use the small poster; the detail hero uses the large one. If a creator skips the poster, a frame from the trailer is used as a fallback.
5. **Priority ranking in Browse** — `GET /api/titles?sort=priority|top|new|trending`. `priority` (default "For you") blends rating, recency, trending watch-velocity and the creator's **subscription tier** (Starter < Pro < Studio), so higher plans surface higher. Admins can additionally `feature`/`boost` a title.
6. **No creator self-serve ads** — the in-app "Promote" tab/screen and `POST /api/me/promote` are removed. Visibility now comes from the subscription plan's priority placement plus admin featuring.


The full data model is documented in **[`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md)** (11 collections, indexes, ER diagram, auth design).

---

## 1. Backend — `server/`

### Quickest: Docker (MongoDB + API in one command)

From the repo root:

```bash
docker compose up --build      # API on :4000, admin at :4000/admin, Mongo on :27017
```

This starts MongoDB (data persists in the `mongo_data` volume) and the API, and
seeds demo data on first boot (only if the database is empty). Override secrets or
add Paystack keys via a root `.env` (e.g. `JWT_ACCESS_SECRET=…`, `PAYSTACK_SECRET_KEY=…`)
or your shell environment. Set `SEED_ON_START=false` to skip seeding.

### Or run it directly

Requires **MongoDB** (local `mongod` or a free MongoDB Atlas cluster).

```bash
cd server
npm install
cp .env.example .env          # then edit secrets (see below)
npm run seed                  # bootstrap admin account (clears collections; no demo users)
npm start                     # http://localhost:4000 · admin at /admin
```

### Environment (`.env`)

| Var | Default | Purpose |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/critiflix` | Local mongod or `mongodb+srv://…` Atlas URI |
| `PORT` | `4000` | API port |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | — | Token secrets — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ACCESS_TOKEN_TTL` | `15m` | Access-token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh-token lifetime |
| `BCRYPT_ROUNDS` | `10` | Password hash cost |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Admin account created by `npm run seed` (password auto-generated if unset) |
| `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` | — | Optional. Unset → payment flows run **simulated**; set → live Paystack |
| `PAYSTACK_CALLBACK_URL` | `…/subscribe/callback` | Where Paystack redirects after checkout |

### Payments (Paystack)

Subscriptions and cashouts use **Paystack**, and work with or without keys:

- **No key (default):** subscribe/redeem/payout flows are **simulated** so the whole
  app is runnable out of the box — a subscribe activates the plan immediately, a
  payout settles instantly.
- **With a key:** `POST /api/me/subscribe` returns a Paystack `checkoutUrl`; the plan
  activates on the `charge.success` webhook. Admin `POST /api/admin/cashouts/:id/pay`
  initiates a Paystack **transfer**; `transfer.success`/`failed` webhooks settle it
  (a failed transfer auto-refunds the critic's points).
- **Webhook:** `POST /api/webhooks/paystack` verifies the `x-paystack-signature`
  (HMAC-SHA512 of the raw body). Point your Paystack dashboard webhook here; for local
  testing tunnel it (e.g. `ngrok http 4000`).

### Authentication (full implementation)

Email + password with **bcrypt**, a short-lived **JWT access token**, and a
**rotating, hashed refresh token** (only the SHA-256 hash is stored). Endpoints:

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register` | public | Critic or creator sign-up → user + tokens |
| `POST /api/auth/login` | public | Verify credentials → user + tokens |
| `POST /api/auth/refresh` | public | Rotate access + refresh tokens |
| `POST /api/auth/logout` | public | Revoke a refresh token |
| `GET  /api/auth/me` | access token | Current user |
| `POST /api/auth/forgot-password` | public | Issue reset token (`devToken` returned outside prod) |
| `POST /api/auth/reset-password` | public | Set new password, revoke sessions |
| `POST /api/auth/change-password` | access token | Change password, revoke sessions |

Other routes: `GET /api/titles`, `GET /api/titles/:id`, `POST /api/titles/:id/watch` (**+120**), `POST /api/titles/:id/review` (**+80/+20**, recomputes score); `GET /api/me/points`, `POST /api/me/redeem`, `GET /api/me/referrals`, `POST /api/me/subscribe`, `GET /api/me/studio`, `POST /api/me/promote`; and `GET /api/admin/overview|users|subscriptions|promotions|integrations|cashouts` with action POSTs (admin-only).

### Admin account (after `npm run seed`)

`npm run seed` no longer creates demo critic/creator accounts — real users sign up in the app. It creates a single **admin** account for the console:

| Setting | Source |
|---|---|
| Email | `ADMIN_EMAIL` (default `admin@critiflix.app`) |
| Name | `ADMIN_NAME` (default `CritiFlix Admin`) |
| Password | `ADMIN_PASSWORD` — if unset, a random one is generated and printed by the seed script |

Set `ADMIN_PASSWORD` before seeding to choose your own, or copy the generated password from the seed output.

### Useful scripts

```bash
npm run seed         # bootstrap admin account    (needs MongoDB; no demo users)
npm run check        # load all models + verify auth crypto  (no DB needed)
npm run selftest     # boot API + exercise register/login/watch/review/redeem  (needs MongoDB)
```

`GET /api/health` reports `{ db: "connected" | "down" }`. With buffering disabled, if MongoDB is unreachable the API still serves health/config/admin and returns a clean **503** on DB routes instead of hanging.

## 2. Mobile — `mobile/` (Critic + Creator)

```bash
cd mobile
npm install
npx expo start       # press i (iOS), a (Android), or scan the QR in Expo Go
```

One Expo app with a role gate on sign-in. Real auth: **Create account** / **Sign in**
with email + password, **Forgot password**, plus **Demo critic / Demo creator**
buttons that log in with the seeded accounts. Access + refresh tokens are stored in
AsyncStorage and refreshed transparently on 401.

- **Critic** → browse trailers → open the full film on YouTube → return → rate & review → earn points → redeem/cash out → refer.
- **Creator** → register studio → pick a plan → submit a 3-min trailer + ≤500-word synopsis + full-movie link → manage titles → run WhatsApp/Facebook promos → Studio settings.

**Pointing the app at the API**

- iOS simulator / web: `http://localhost:4000` works as-is.
- **Physical device:** set your machine's LAN IP, e.g.
  `EXPO_PUBLIC_API_BASE=http://192.168.1.20:4000 npx expo start` (same Wi-Fi).

## 3. Admin console — `admin/`

Served by the backend at **http://localhost:4000/admin**. Six panels: Overview, Users, Subscriptions, Promotions, Integrations, Points & Cashouts.

---

## What's real vs. scaffolded

- **Real & working:** MongoDB/Mongoose data layer (11 collections), full email/password auth (register, login, JWT access + rotating refresh tokens, password reset, bcrypt, role gating), points/watch/review/redeem/subscription/promotion/admin logic, **Paystack-backed subscriptions & cashouts** (live-capable, with signed webhooks; simulated when no key), a one-command **Docker Compose** stack, and the served admin console.
- **Native, design-accurate, runs in Expo:** every screen, wired to the API with real auth + seeded data; Plans opens the Paystack checkout URL when one is returned.
- **Stubbed for demo:** social-login is replaced by email/password + demo-account buttons (no OAuth); logo/trailer uploads are UI placeholders (no object storage); WhatsApp/Facebook promotion delivery is modelled in the schema/API but not connected to live providers.

> **Note on validation:** this build was checked with `npm run check` (all 11 models compile, bcrypt/JWT/refresh-hash verified), `node --check` on every file, a graceful-degradation boot (health/config/admin up, DB routes → 503), and a full Babel parse + import/export cross-check of the mobile app. A live end-to-end run against a real MongoDB (`npm run seed` → `npm run selftest`) is the one step to do on your machine once `MONGODB_URI` points at a running database.

## Project layout

```
critiflix-app/
├── docs/DATABASE_SCHEMA.md          complete data model (11 collections, ER diagram, auth)
├── server/
│   ├── .env.example
│   └── src/
│       ├── config/{env,db}.js       env loader · Mongo connection
│       ├── models/                  User, Title, Review, Watch, PointsLedger,
│       │                            Subscription, Promotion, Cashout, Integration,
│       │                            RefreshToken, PasswordReset (+ index.js)
│       ├── middleware/{auth,error}.js
│       ├── services/{authService,pointsService}.js
│       ├── utils/{ApiError,asyncHandler,ids,tokens}.js
│       ├── routes/{auth,titles,me,admin}.js
│       ├── scripts/check-models.js  seed.js  selftest.js  index.js
├── mobile/   App.js  src/{api,theme,components,context,navigation}/  src/screens/{auth,critic,creator}/
└── admin/    index.html             (the v3 design, served at /admin)
```

## What's new — eligibility, payouts, OTP, follows, tracked watching

1. **Earning eligibility** — critics must reach **200 followers** and **1000 reviews** before points start counting and before they can cash out. Progress is shown on the Points screen; the cashout button stays locked until both thresholds are met (also enforced server-side on `/api/me/redeem`).
2. **Dynamic per-title points** — each title's watch reward is computed from the creator's plan and the film's length, ratioed and clamped to **50–150** (`starter 50 · pro 90 · studio 120` base, plus up to +30 for length).
3. **Payout pool** — only **50% of subscription revenue** funds critic payouts. The admin Revenue page shows the pool, what's allocated and what's remaining; cashouts that would exceed the remaining pool are rejected.
4. **Tracked watching (75%)** — instead of a blind redirect, the full film plays in an **in-app YouTube player** (WebView + IFrame API) that reports real progress. Review unlocks only after **75%** is watched, and watch points are granted once at that point. (True watch-time tracking is impossible once a user leaves to the external YouTube app, so the film is played in-app where progress can be measured.)
5. **Trailer pop-up + responsive media** — the trailer plays in a **modal pop-up** (`expo-video`) before the user commits to the full film, and the hero/poster placeholders are now responsive (16:9 aspect ratios rather than fixed heights).
6. **Keyboard never blocks inputs** — `Screen` now wraps content in a `KeyboardAvoidingView` with a tap-through `ScrollView`, applied app-wide.
7. **Email/phone OTP + confirmation at signup** — creating an account (critic *or* creator) now requires confirming a 6-digit code sent to the email (or phone): the new "Confirm your email" step calls the server, which re-verifies the code as it creates the account, so unconfirmed accounts are never created. The same OTP also powers passwordless sign-in for existing users (`/api/auth/otp/request` + `/verify`, and a `code` is now required by `/api/auth/register`). With no SMS/email provider configured the code is *simulated* (logged server-side and returned as `devCode`); set `OTP_PROVIDER` to wire a real sender.
8. **Follow creators + profiles** — tap a creator to open their profile (studio details, follower count, their titles) and follow/unfollow them.
9. **Admin upgrades** — a **Revenue** page (MRR, ARPU, revenue-by-plan, payout pool), a **Messages** composer to broadcast promotional announcements to all users / critics / creators, plus per-creator plan changes and an eligibility column on Users.
10. **Real logo** — the admin portal now uses the exact CritiFlix shutter mark from the brand pack.

> Note on OTP & SMS: phone/email delivery needs a provider (e.g. Termii, Twilio, SendGrid). Until `OTP_PROVIDER` is set, OTP runs in simulated mode so the flow is fully testable.

## Latest changes — responsive trailer, channel logo, keyboard, no demo accounts

- **Responsive trailer placeholder** — the trailer hero scales with screen width and is capped on large screens, so it looks right on iPhone, Android and iPad (the in-app player and trailer pop-up are 16:9 and scale too). iPad is now a first-class target (`ios.supportsTablet: true`).
- **Channel logo upload** — creators can upload a square studio/channel logo from the Studio screen; it's resized, uploaded, saved to the profile (`POST /api/me/logo`) and shown across the app.
- **Keyboard never blocks inputs** — every input screen now scrolls inside a `KeyboardAvoidingView` (`keyboardShouldPersistTaps`), and Android uses `softwareKeyboardLayoutMode: "resize"`, so fields stay visible above the keyboard on Android, iPhone and iPad.
- **No demo accounts** — `npm run seed` no longer creates demo critics/creators or sample titles. It bootstraps a single admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (a password is generated and printed if you don't set one). Users and creators sign up in the app.
