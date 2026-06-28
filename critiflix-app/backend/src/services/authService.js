import { RefreshToken } from '../models/RefreshToken.js';
import { signAccessToken, newRefreshToken, hashToken } from '../utils/tokens.js';
import { unauthorized } from '../utils/ApiError.js';

// Create a fresh access + refresh pair and persist the refresh hash.
export async function issueTokens(user, req) {
  const access = signAccessToken(user);
  const { token, tokenHash, expiresAt } = newRefreshToken();
  await RefreshToken.create({
    user: user._id,
    tokenHash,
    expiresAt,
    userAgent: req?.headers?.['user-agent'] || null,
    ip: req?.ip || null,
  });
  return { accessToken: access, refreshToken: token, expiresAt };
}

// Validate a presented refresh token and rotate it (revoke old, issue new).
export async function rotateRefresh(presented, user, req) {
  const tokenHash = hashToken(presented);
  const existing = await RefreshToken.findOne({ tokenHash });
  if (!existing || existing.revokedAt || existing.expiresAt <= new Date()) {
    throw unauthorized('Refresh token is invalid or expired');
  }
  const pair = await issueTokens(user, req);
  existing.revokedAt = new Date();
  existing.replacedBy = hashToken(pair.refreshToken);
  await existing.save();
  return pair;
}

export async function revokeRefresh(presented) {
  if (!presented) return;
  await RefreshToken.updateOne(
    { tokenHash: hashToken(presented), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

export async function revokeAllForUser(userId) {
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}
