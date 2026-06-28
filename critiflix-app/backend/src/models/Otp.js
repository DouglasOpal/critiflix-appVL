import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// One-time passcodes for email/phone verification + passwordless login.
const otpSchema = new Schema(
  {
    channel: { type: String, enum: ['email', 'phone'], required: true },
    destination: { type: String, required: true, lowercase: true, trim: true, index: true },
    codeHash: { type: String, required: true },          // sha256 of the 6-digit code
    attempts: { type: Number, default: 0 },
    consumed: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // auto-purge expired codes
export const Otp = model('Otp', otpSchema);
