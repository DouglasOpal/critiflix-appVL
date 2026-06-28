import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const passwordResetSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PasswordReset = model('PasswordReset', passwordResetSchema);
