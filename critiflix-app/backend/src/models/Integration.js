import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// Third-party connections shown on the admin Integrations panel.
const integrationSchema = new Schema(
  {
    key: { type: String, enum: ['whatsapp', 'facebook', 'youtube', 'paystack'], unique: true, required: true },
    name: { type: String, required: true },
    connected: { type: Boolean, default: false },
    meta: { type: Schema.Types.Mixed, default: {} },          // reach30d, delivery, adSpend, redirects24h…
  },
  { timestamps: true }
);
export const Integration = model('Integration', integrationSchema);
