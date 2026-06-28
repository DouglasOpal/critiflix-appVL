import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const reviewSchema = new Schema(
  {
    title: { type: Schema.Types.ObjectId, ref: 'Title', required: true, index: true },
    critic: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    rating: { type: Number, required: true, min: 1, max: 5 },   // stars
    score: { type: Number, required: true, min: 0, max: 10 },   // rating * 2
    headline: { type: String, default: '' },
    body: { type: String, default: '' },
    tags: { type: [String], default: [] },
  },
  { timestamps: true }
);

// One review per critic per title.
reviewSchema.index({ title: 1, critic: 1 }, { unique: true });
export const Review = model('Review', reviewSchema);
