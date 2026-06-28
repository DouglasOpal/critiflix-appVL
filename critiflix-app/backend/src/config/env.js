import dotenv from 'dotenv';
dotenv.config();

const required = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

export const env = {
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/critiflix',
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me',
  refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
  accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
  seedPassword: process.env.SEED_PASSWORD || 'critiflix123',
  adminName: process.env.ADMIN_NAME || 'CritiFlix Admin',
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@critiflix.app').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || '',

  // Payments (optional — flows simulate when unset)
  paystackSecret: process.env.PAYSTACK_SECRET_KEY || '',
  paystackPublic: process.env.PAYSTACK_PUBLIC_KEY || '',
  paystackCallbackUrl: process.env.PAYSTACK_CALLBACK_URL || 'http://localhost:4000/api/me/subscribe/callback',
};

// Warn (don't crash) if running with insecure defaults outside dev.
export function assertProdSecrets() {
  if (env.isProd) {
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) throw new Error(`Missing required env in production: ${missing.join(', ')}`);
  }
}
