import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const titleSchema = new Schema(
  {
    code: { type: String, unique: true, index: true },          // TT-XXXXXX
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    title: { type: String, required: true, trim: true },
    synopsis: { type: String, default: '', maxlength: 4000 },    // ≤500 words enforced in controller
    genre: { type: String, default: 'Drama', index: true },
    runtime: { type: String, default: '' },
    runtimeMinutes: { type: Number, default: 0 },               // parsed length (drives watch points)

    // ---- media ----
    trailerUrl: { type: String, required: true },               // uploaded ≤3-min trailer (or external)
    movieUrl: { type: String, required: true },                 // full film (YouTube/stream link)
    trailerDurationSec: { type: Number, default: null },        // enforced ≤180s at upload
    trailerSizeBytes: { type: Number, default: null },          // enforced ≤200MB at upload
    posterSmall: { type: String, default: null },               // ~360w thumbnail (lists)
    posterLarge: { type: String, default: null },               // ~800w thumbnail (detail/hero)

    status: { type: String, enum: ['draft', 'pending', 'reviewing', 'scored', 'ended', 'delisted'], default: 'pending', index: true },
    score: { type: Number, default: null, min: 0, max: 10 },    // aggregate /10
    reviewCount: { type: Number, default: 0 },
    watchCount: { type: Number, default: 0 },                   // total completed watches (for trending)
    watchPoints: { type: Number, default: 100 },                // points a critic earns for watching

    // ---- platform curation (admin only) ----
    featured: { type: Boolean, default: false, index: true },   // hand-picked top placement
    priorityBoost: { type: Number, default: 0 },                // manual nudge in ranking

    tags: { type: [String], default: [] },
  },
  { timestamps: true }
);

titleSchema.index({ score: -1 });
titleSchema.index({ createdAt: -1 });
export const Title = model('Title', titleSchema);
