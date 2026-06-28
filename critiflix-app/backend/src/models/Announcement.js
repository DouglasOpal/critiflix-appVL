import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// Admin -> users/creators broadcast (promotional messages, product news).
const announcementSchema = new Schema(
  {
    audience: { type: String, enum: ['all', 'critics', 'creators'], default: 'all', index: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    channel: { type: String, enum: ['in_app', 'whatsapp', 'email'], default: 'in_app' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
announcementSchema.index({ createdAt: -1 });
export const Announcement = model('Announcement', announcementSchema);
