import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// A follows B. Drives follower/following counts and the eligibility gate.
const followSchema = new Schema(
  {
    follower: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    following: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);
followSchema.index({ follower: 1, following: 1 }, { unique: true });
export const Follow = model('Follow', followSchema);
