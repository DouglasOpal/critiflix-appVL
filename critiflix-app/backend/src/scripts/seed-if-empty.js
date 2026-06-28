// Seeds the database only when it's empty (so container restarts don't wipe data).
import mongoose from 'mongoose';
import { spawnSync } from 'child_process';
import { env } from '../config/env.js';

try {
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 8000 });
  const count = await mongoose.connection.collection('users').countDocuments();
  await mongoose.disconnect();
  if (count === 0) {
    console.log('[seed-if-empty] empty database — creating admin account');
    spawnSync('node', ['src/seed.js'], { stdio: 'inherit' });
  } else {
    console.log(`[seed-if-empty] ${count} users already present — skipping seed`);
  }
} catch (e) {
  console.error('[seed-if-empty] could not check/seed:', e.message);
}
