import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// Creator subscription record / history. The user's *current* plan is also
// denormalised onto User.plan for fast reads; this collection is the source of truth.
const subscriptionSchema = new Schema(
  {
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: String, enum: ['starter', 'pro', 'studio'], required: true },
    price: { type: Number, required: true },                 // ₦/mo at purchase
    status: { type: String, enum: ['pending', 'active', 'canceled', 'past_due'], default: 'active', index: true },
    provider: { type: String, enum: ['paystack', 'manual'], default: 'manual' },
    providerRef: { type: String, default: null },
    reference: { type: String, default: null },              // Paystack transaction reference
    startedAt: { type: Date, default: Date.now },
    renewsAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
  },
  { timestamps: true }
);
export const Subscription = model('Subscription', subscriptionSchema);
