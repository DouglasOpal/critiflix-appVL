import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const promotionSchema = new Schema(
  {
    code: { type: String, unique: true, index: true },        // PR-XXXXXX
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: Schema.Types.ObjectId, ref: 'Title', required: true },
    channels: { type: [{ type: String, enum: ['whatsapp', 'facebook', 'feed'] }], default: [] },
    budget: { type: Number, default: 0 },
    spent: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    conversion: { type: Number, default: 0 },                 // %
    status: { type: String, enum: ['review', 'live', 'ended', 'rejected'], default: 'review', index: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
  },
  { timestamps: true }
);
export const Promotion = model('Promotion', promotionSchema);
