import mongoose from 'mongoose';
import crypto from 'crypto';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import {
  User, Title, Review, Watch, PointsLedger, Subscription, Promotion, Cashout, Integration, RefreshToken, PasswordReset,
  Follow, Otp, Announcement,
} from './models/index.js';

// Production-clean bootstrap: NO demo critic/creator accounts, titles or sample
// activity. Creates only the admin account (from env) and the service connectors
// so the admin console works. Real users sign up through the app.
async function run() {
  await connectDB();
  console.log('[seed] clearing collections…');
  await Promise.all([
    User, Title, Review, Watch, PointsLedger, Subscription, Promotion, Cashout, Integration, RefreshToken, PasswordReset,
    Follow, Otp, Announcement,
  ].map((M) => M.deleteMany({})));

  // ---- admin account (operational, not a demo login) ----
  const adminPassword = env.adminPassword || crypto.randomBytes(9).toString('base64url');
  const generated = !env.adminPassword;
  await User.create({
    code: 'AD-0001', role: 'admin', name: env.adminName, email: env.adminEmail,
    passwordHash: await User.hashPassword(adminPassword), status: 'active', avatarColor: '#E50914', emailVerified: true,
  });

  // ---- service connectors (toggled on in the admin console once configured) ----
  await Integration.create([
    { key: 'whatsapp', name: 'WhatsApp Business', connected: false, meta: {} },
    { key: 'facebook', name: 'Facebook / Meta', connected: false, meta: {} },
    { key: 'youtube', name: 'YouTube Data API', connected: false, meta: {} },
    { key: 'paystack', name: 'Paystack payouts', connected: false, meta: {} },
  ]);

  console.log('[seed] done. Admin account created:');
  console.log(`[seed]   email:    ${env.adminEmail}`);
  if (generated) {
    console.log(`[seed]   password: ${adminPassword}   <-- generated; set ADMIN_PASSWORD to choose your own`);
  } else {
    console.log('[seed]   password: (from ADMIN_PASSWORD)');
  }
  console.log('[seed] No demo accounts were created. Users and creators sign up in the app.');
  await disconnectDB();
  process.exit(0);
}

run().catch(async (e) => {
  console.error('[seed] failed:', e.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
