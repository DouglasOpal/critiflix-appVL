import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// Records a completed watch (critic returned from the full film) — also the
// idempotency guard so watch points are only awarded once per title.
const watchSchema = new Schema(
  {
    critic: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: Schema.Types.ObjectId, ref: 'Title', required: true, index: true },
    watchedSeconds: { type: Number, default: 0 },     // furthest progress reached
    durationSeconds: { type: Number, default: 0 },    // total film length (from player)
    percent: { type: Number, default: 0, min: 0, max: 1 }, // watchedSeconds / durationSeconds
    cumulativeSeconds: { type: Number, default: 0 },  // real watched time (anti fast-forward)
    lastPlayhead: { type: Number, default: 0 },       // last reported player position
    lastReportAt: { type: Date, default: null },      // wall-clock of last report
    completed: { type: Boolean, default: false },     // crossed the 75% gate -> review unlocked
    awarded: { type: Boolean, default: false },       // watch points already granted
  },
  { timestamps: true }
);
watchSchema.index({ critic: 1, title: 1 }, { unique: true });
export const Watch = model('Watch', watchSchema);
