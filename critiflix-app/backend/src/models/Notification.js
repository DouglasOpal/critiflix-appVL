import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// In-app notifications: new-title alerts, promotions, status changes.
const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['new_title', 'promo', 'system', 'title_status'], default: 'system' },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    data: { type: Object, default: {} },          // e.g. { titleId }
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);
notificationSchema.index({ user: 1, createdAt: -1 });
export const Notification = model('Notification', notificationSchema);
