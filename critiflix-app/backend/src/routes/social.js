import { Router } from 'express';
import { User } from '../models/User.js';
import { Title } from '../models/Title.js';
import { Follow } from '../models/Follow.js';
import { Review } from '../models/Review.js';
import { Announcement } from '../models/Announcement.js';
import { Notification } from '../models/Notification.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/ApiError.js';
import { protect } from '../middleware/auth.js';

const r = Router();

// Public critic profile: rank, followers, review count and recent reviews.
r.get('/critics/:id', protect(false), asyncHandler(async (req, res) => {
  const critic = await User.findOne({ _id: req.params.id, role: 'critic' })
    .select('name code avatarColor followers following reviewCount rank rankNo createdAt')
    .lean();
  if (!critic) throw notFound('Critic not found');

  const reviews = await Review.find({ critic: critic._id })
    .populate('title', 'title genre posterSmall')
    .select('rating score headline body createdAt title')
    .sort({ createdAt: -1 }).limit(20).lean();

  let isFollowing = false;
  if (req.user) isFollowing = !!(await Follow.exists({ follower: req.user._id, following: critic._id }));

  res.json({
    ...critic, id: critic._id, isFollowing,
    reviews: reviews.map((rv) => ({
      ...rv, id: rv._id,
      title: rv.title ? { ...rv.title, id: rv.title._id } : null,
    })),
  });
}));

// Public creator profile: studio details, follower count, their published titles.
r.get('/creators/:id', protect(false), asyncHandler(async (req, res) => {
  const creator = await User.findOne({ _id: req.params.id, role: 'creator' })
    .select('name code avatarColor channelUrl otherUrl genre country plan followers logoUrl createdAt')
    .lean();
  if (!creator) throw notFound('Creator not found');

  const titles = await Title.find({ creator: creator._id, status: { $ne: 'draft' } })
    .select('title genre score reviewCount watchCount posterSmall watchPoints status createdAt')
    .sort({ createdAt: -1 }).lean();

  let isFollowing = false;
  if (req.user) isFollowing = !!(await Follow.exists({ follower: req.user._id, following: creator._id }));

  res.json({ ...creator, id: creator._id, titles: titles.map((t) => ({ ...t, id: t._id })), isFollowing });
}));

// Follow any user (creator or critic). Updates both counts.
r.post('/users/:id/follow', protect(), asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) throw badRequest("You can't follow yourself");
  const target = await User.findById(req.params.id);
  if (!target) throw notFound('User not found');
  try {
    await Follow.create({ follower: req.user._id, following: target._id });
    await User.updateOne({ _id: target._id }, { $inc: { followers: 1 } });
    await User.updateOne({ _id: req.user._id }, { $inc: { following: 1 } });
  } catch (e) {
    if (e.code === 11000) return res.json({ following: true, followers: target.followers });
    throw e;
  }
  const fresh = await User.findById(target._id).select('followers').lean();
  res.status(201).json({ following: true, followers: fresh.followers });
}));

r.delete('/users/:id/follow', protect(), asyncHandler(async (req, res) => {
  const removed = await Follow.findOneAndDelete({ follower: req.user._id, following: req.params.id });
  if (removed) {
    await User.updateOne({ _id: req.params.id, followers: { $gt: 0 } }, { $inc: { followers: -1 } });
    await User.updateOne({ _id: req.user._id, following: { $gt: 0 } }, { $inc: { following: -1 } });
  }
  const fresh = await User.findById(req.params.id).select('followers').lean();
  res.json({ following: false, followers: fresh?.followers || 0 });
}));

// Announcements the signed-in user should see (audience-filtered).
r.get('/announcements', protect(), asyncHandler(async (req, res) => {
  const aud = req.user.role === 'creator' ? ['all', 'creators'] : ['all', 'critics'];
  const items = await Announcement.find({ audience: { $in: aud } }).sort({ createdAt: -1 }).limit(20).lean();
  res.json(items.map((a) => ({ ...a, id: a._id })));
}));

// In-app notifications for the signed-in user.
r.get('/notifications', protect(), asyncHandler(async (req, res) => {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  const unread = await Notification.countDocuments({ user: req.user._id, read: false });
  res.json({ unread, notifications: items.map((n) => ({ ...n, id: n._id })) });
}));

r.get('/notifications/unread-count', protect(), asyncHandler(async (req, res) => {
  res.json({ unread: await Notification.countDocuments({ user: req.user._id, read: false }) });
}));

r.post('/notifications/read', protect(), asyncHandler(async (req, res) => {
  const { id } = req.body || {};
  const filter = id ? { _id: id, user: req.user._id } : { user: req.user._id, read: false };
  await Notification.updateMany(filter, { $set: { read: true } });
  res.json({ ok: true });
}));

export default r;
