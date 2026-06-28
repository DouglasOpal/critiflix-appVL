import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// Stores only the SHA-256 hash of each issued refresh token. Supports rotation
// (revokedAt) and automatic cleanup (TTL index on expiresAt).
const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null },              // tokenHash of the rotated successor
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: true }
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup
refreshTokenSchema.virtual('active').get(function () {
  return !this.revokedAt && this.expiresAt > new Date();
});
export const RefreshToken = model('RefreshToken', refreshTokenSchema);
