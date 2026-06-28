import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Short-lived access token (JWT).
export const signAccessToken = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role, code: user.code }, env.accessSecret, {
    expiresIn: env.accessTtl,
  });

export const verifyAccessToken = (token) => jwt.verify(token, env.accessSecret);

// Opaque refresh token: a random secret returned to the client; only its
// SHA-256 hash is stored server-side (so a DB leak can't be replayed).
export const newRefreshToken = () => {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + env.refreshTtlDays * 864e5);
  return { token, tokenHash, expiresAt };
};

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
