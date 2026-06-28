import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    code: { type: String, unique: true, index: true },          // CR-2041 / CT-0188 / AD-0001
    role: { type: String, enum: ['critic', 'creator', 'admin'], required: true, index: true },

    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone: { type: String, default: null, trim: true, index: true, sparse: true },
    whatsapp: { type: String, default: null, trim: true, index: true, sparse: true }, // for promos/alerts
    avatarUrl: { type: String, default: null },        // uploaded profile picture
    passwordHash: { type: String, required: true, select: false }, // never returned by default
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },

    avatarColor: { type: String, default: '#13294B' },
    status: {
      type: String,
      enum: ['active', 'pending', 'verified', 'banned'],
      default: 'active',
    },

    // ---- critic fields ----
    points: { type: Number, default: 0, min: 0 },     // redeemable points balance
    followers: { type: Number, default: 0 },          // people who follow this user
    following: { type: Number, default: 0 },          // people this user follows
    reviewCount: { type: Number, default: 0 },        // published reviews (eligibility)
    rank: { type: String, default: 'Bronze Critic' },
    rankNo: { type: Number, default: null },
    referralCode: { type: String, unique: true, sparse: true, index: true },
    referredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // ---- creator (studio) fields ----
    channelUrl: { type: String, default: null },
    otherUrl: { type: String, default: null },
    country: { type: String, default: 'Nigeria' },
    genre: { type: String, default: null },
    logoUrl: { type: String, default: null },
    plan: { type: String, enum: ['starter', 'pro', 'studio'], default: 'starter' },
    planRenews: { type: Date, default: null },
    balance: { type: Number, default: 0 },            // creator earnings (₦)

    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Hash helper used by controllers when creating/updating credentials.
userSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, env.bcryptRounds);

userSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

// Shape returned to clients (no hash, expose code as id-friendly field).
userSchema.methods.toPublic = function () {
  const u = this.toObject({ versionKey: false });
  delete u.passwordHash;
  return u;
};

export const User = model('User', userSchema);
