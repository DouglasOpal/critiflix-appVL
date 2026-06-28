import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { env, assertProdSecrets } from './config/env.js';
import { connectDB, isDbConnected } from './config/db.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

import authRoutes from './routes/auth.js';
import titleRoutes from './routes/titles.js';
import meRoutes from './routes/me.js';
import adminRoutes from './routes/admin.js';
import uploadRoutes from './routes/uploads.js';
import socialRoutes from './routes/social.js';
import webhookRoutes from './routes/webhooks.js';
import { POINTS, PLANS, REDEEM_RATE, EARN_MIN_FOLLOWERS, EARN_MIN_REVIEWS, WATCH_REQUIRED_PCT, PAYOUT_POOL_RATIO } from './points.js';
import { paystackEnabled } from './services/paystack.js';
import { MAX_VIDEO_BYTES, MAX_TRAILER_SECONDS } from './routes/uploads.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());

// Webhooks must read the RAW body for signature verification, so mount before json().
app.use('/api/webhooks', webhookRoutes);

app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'critiflix-api', db: isDbConnected() ? 'connected' : 'down' }));
app.get('/api/config', (_req, res) => res.json({
  points: POINTS, plans: PLANS, redeemRate: REDEEM_RATE,
  earn: { minFollowers: EARN_MIN_FOLLOWERS, minReviews: EARN_MIN_REVIEWS },
  watchRequiredPct: WATCH_REQUIRED_PCT,
  payoutPoolRatio: PAYOUT_POOL_RATIO,
  payments: { paystack: paystackEnabled, publicKey: env.paystackPublic || null },
  upload: { maxVideoBytes: MAX_VIDEO_BYTES, maxTrailerSeconds: MAX_TRAILER_SECONDS },
}));

app.use('/api/auth', authRoutes);
app.use('/api/titles', titleRoutes);
app.use('/api/me', meRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api', socialRoutes);

// Serve uploaded trailers + posters
app.use('/uploads', express.static(join(__dirname, '../uploads')));

// Admin web console at /admin
app.use('/admin', express.static(join(__dirname, '../../admin')));

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  assertProdSecrets();

  // Listen on all interfaces (0.0.0.0) so physical devices on the same Wi-Fi can
  // reach it via the machine's LAN IP, not just localhost.
  app.listen(env.port, '0.0.0.0', () =>
    console.log(`CritiFlix API on http://0.0.0.0:${env.port}  (reachable at http://<your-LAN-IP>:${env.port})  ·  admin at /admin`)
  );

  // Connect to MongoDB in the background. DB-backed routes return 503 until ready.
  connectDB().catch((e) => {
    console.error(`[mongo] could not connect: ${e.message}`);
    console.error('[mongo] Start MongoDB and set MONGODB_URI. The server keeps running; DB routes return 503 until connected.');
  });
}
start();

export { app };
