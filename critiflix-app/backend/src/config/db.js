import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);
// Fail fast instead of buffering when the DB is unreachable, so routes can
// return a clean 503 rather than hanging.
mongoose.set('bufferCommands', false);

let connected = false;
export const isDbConnected = () => connected && mongoose.connection.readyState === 1;

export async function connectDB() {
  mongoose.connection.on('connected', () => { connected = true; });
  mongoose.connection.on('disconnected', () => { connected = false; });
  mongoose.connection.on('error', (e) => console.error('[mongo] error:', e.message));

  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: !env.isProd, // build indexes automatically in dev
  });
  connected = true;
  console.log(`[mongo] connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
  connected = false;
}
