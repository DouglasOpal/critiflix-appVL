import { Router } from 'express';
import { Title } from '../models/Title.js';
import { Review } from '../models/Review.js';
import { Watch } from '../models/Watch.js';
import { PointsLedger } from '../models/PointsLedger.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { titleCode } from '../utils/ids.js';
import { protect, requireRole } from '../middleware/auth.js';
import { award } from '../services/pointsService.js';
import { POINTS, PLANS, titleWatchPoints, runtimeToMinutes, WATCH_REQUIRED_PCT } from '../points.js';
import { MAX_VIDEO_BYTES, MAX_TRAILER_SECONDS } from './uploads.js';

const r = Router();

const creatorLite = 'name code channelUrl avatarColor plan followers';
const PLAN_WEIGHT = { starter: 1, pro: 2, studio: 3 };

const shape = (t) => {
  const o = t.toObject ? t.toObject({ versionKey: false }) : t;
  return { ...o, id: o._id, reward: o.watchPoints };
};

// Rank titles. "priority" (default) blends rating, recency, trending and the
// creator's subscription tier so higher plans surface higher.
function rank(titles, sort) {
  const now = Date.now();
  const maxWatch = Math.max(1, ...titles.map((t) => t.watchCount || 0));
  const scored = titles.map((t) => {
    const ageDays = (now - new Date(t.createdAt).getTime()) / 86400000;
    const recency = Math.max(0, 1 - ageDays / 30);
    const rating = (t.score || 0) / 10;
    const trending = (t.watchCount || 0) / maxWatch;
    const planW = PLAN_WEIGHT[t.creator?.plan] || 1;
    const priority = (t.featured ? 1000 : 0) + (t.priorityBoost || 0) * 10 + planW * 2 + rating * 5 + recency * 3 + trending * 4;
    return { t, rating, trending, priority, createdAt: new Date(t.createdAt).getTime() };
  });
  const cmp = {
    top: (a, b) => b.rating - a.rating || (b.t.reviewCount || 0) - (a.t.reviewCount || 0),
    new: (a, b) => b.createdAt - a.createdAt,
    trending: (a, b) => b.trending - a.trending || b.priority - a.priority,
    priority: (a, b) => b.priority - a.priority,
  }[sort] || ((a, b) => b.priority - a.priority);
  return scored.sort(cmp).map((x) => x.t);
}

// Browse feed. ?sort=priority|top|new|trending  &genre=Drama
// Only admin-approved titles are visible to users.
const VISIBLE = ['reviewing', 'scored'];
r.get('/', protect(false), asyncHandler(async (req, res) => {
  const { sort = 'priority', genre } = req.query;
  const q = { status: { $in: VISIBLE } };
  if (genre && genre !== 'All') q.genre = genre;
  const titles = await Title.find(q).populate('creator', creatorLite).lean();
  res.json(rank(titles, sort).map((t) => ({ ...t, id: t._id, reward: t.watchPoints })));
}));

// Title detail. Pending/delisted titles are only viewable by their creator or an admin.
r.get('/:id', protect(false), asyncHandler(async (req, res) => {
  const t = await Title.findById(req.params.id).populate('creator', creatorLite).lean();
  if (!t) throw notFound('Title not found');
  const isOwner = req.user && String(t.creator?._id) === String(req.user._id);
  const isAdmin = req.user && req.user.role === 'admin';
  if (!VISIBLE.includes(t.status) && !isOwner && !isAdmin) throw notFound('Title not found');
  const reviews = await Review.find({ title: t._id }).populate('critic', 'name code rank avatarColor avatarUrl').sort({ createdAt: -1 }).lean();
  let watch = null;
  if (req.user) watch = await Watch.findOne({ critic: req.user._id, title: t._id }).lean();
  res.json({ ...t, id: t._id, reward: t.watchPoints, requiredWatchPct: WATCH_REQUIRED_PCT, reviews, watch });
}));

// Creator submits a title. watchPoints are set from plan + film length (50–150).
r.post('/', protect(), requireRole('creator'), asyncHandler(async (req, res) => {
  const {
    title, synopsis = '', genre, runtime, trailerUrl, movieUrl,
    trailerDurationSec, trailerSizeBytes, posterSmall, posterLarge,
  } = req.body || {};

  if (!title || !trailerUrl || !movieUrl) throw badRequest('Title, an uploaded trailer and the full-movie link are required');
  const words = synopsis.trim().split(/\s+/).filter(Boolean).length;
  if (words > 500) throw badRequest('Synopsis must be 500 words or fewer');
  if (trailerDurationSec && trailerDurationSec > MAX_TRAILER_SECONDS) throw badRequest('Trailer must be 3 minutes or shorter');
  if (trailerSizeBytes && trailerSizeBytes > MAX_VIDEO_BYTES) throw badRequest('Trailer must be 200MB or smaller');

  const plan = PLANS[req.user.plan] || PLANS.starter;
  const active = await Title.countDocuments({ creator: req.user._id, status: { $ne: 'ended' } });
  if (active >= plan.activeTitles) throw badRequest(`Your ${plan.name} plan allows ${plan.activeTitles} active title(s). Upgrade to add more.`);

  const runtimeMinutes = runtimeToMinutes(runtime);
  const watchPoints = titleWatchPoints(req.user.plan, runtimeMinutes);

  const t = await Title.create({
    code: titleCode(), creator: req.user._id,
    title, synopsis, genre: genre || 'Drama', runtime: runtime || '', runtimeMinutes,
    trailerUrl, movieUrl,
    trailerDurationSec: trailerDurationSec || null, trailerSizeBytes: trailerSizeBytes || null,
    posterSmall: posterSmall || null, posterLarge: posterLarge || null,
    status: 'pending', watchPoints, // awaits admin approval before users can see it
  });
  await t.populate('creator', creatorLite);
  res.status(201).json(shape(t));
}));

// Creator edits their own title's properties. Edits do NOT require re-approval —
// an already-approved title stays live; a pending one stays pending.
r.patch('/:id', protect(), requireRole('creator'), asyncHandler(async (req, res) => {
  const t = await Title.findById(req.params.id);
  if (!t) throw notFound('Title not found');
  if (String(t.creator) !== String(req.user._id)) throw badRequest('You can only edit your own titles');
  if (t.status === 'delisted') throw badRequest('This title was delisted by an admin and can’t be edited');

  const { title, synopsis, genre, runtime, trailerUrl, movieUrl, posterSmall, posterLarge } = req.body || {};
  if (synopsis !== undefined) {
    if (synopsis.trim().split(/\s+/).filter(Boolean).length > 500) throw badRequest('Synopsis must be 500 words or fewer');
    t.synopsis = synopsis;
  }
  if (title !== undefined) t.title = title;
  if (genre !== undefined) t.genre = genre;
  if (runtime !== undefined) { t.runtime = runtime; t.runtimeMinutes = runtimeToMinutes(runtime); t.watchPoints = titleWatchPoints(req.user.plan, t.runtimeMinutes); }
  if (trailerUrl !== undefined) t.trailerUrl = trailerUrl;
  if (movieUrl !== undefined) t.movieUrl = movieUrl;
  if (posterSmall !== undefined) t.posterSmall = posterSmall;
  if (posterLarge !== undefined) t.posterLarge = posterLarge;
  await t.save();
  await t.populate('creator', creatorLite);
  res.json(shape(t));
}));

// Critic reports watch progress. Watched time is credited by WALL-CLOCK: between
// reports we add at most the real time elapsed, so scrubbing/fast-forwarding the
// player can't accrue watch credit. The 75% gate is measured on this real time.
r.post('/:id/watch', protect(), requireRole('critic'), asyncHandler(async (req, res) => {
  const t = await Title.findById(req.params.id);
  if (!t) throw notFound('Title not found');
  const playhead = Math.max(0, Number(req.body?.watchedSeconds) || 0);   // current player position
  const durationSeconds = Math.max(0, Number(req.body?.durationSeconds) || 0);

  let w = await Watch.findOne({ critic: req.user._id, title: t._id });
  if (!w) w = new Watch({ critic: req.user._id, title: t._id });
  if (durationSeconds) w.durationSeconds = durationSeconds;

  const now = Date.now();
  if (w.lastReportAt) {
    const wallElapsed = (now - new Date(w.lastReportAt).getTime()) / 1000;   // real seconds since last report
    const playheadDelta = playhead - (w.lastPlayhead || 0);                  // how far the player moved
    // Credit forward playback only, capped to real elapsed time (+small buffer for jitter).
    if (playheadDelta > 0) {
      const credit = Math.min(playheadDelta, wallElapsed * 1.5 + 2);
      w.cumulativeSeconds = (w.cumulativeSeconds || 0) + Math.max(0, credit);
    }
  }
  if (durationSeconds) w.cumulativeSeconds = Math.min(w.cumulativeSeconds, durationSeconds);
  w.lastPlayhead = playhead;
  w.lastReportAt = new Date(now);
  w.watchedSeconds = Math.max(w.watchedSeconds || 0, playhead);             // furthest, for display
  w.percent = w.durationSeconds ? Math.min(1, w.cumulativeSeconds / w.durationSeconds) : 0;
  if (w.percent >= WATCH_REQUIRED_PCT) w.completed = true;

  let awarded = 0;
  if (w.completed && !w.awarded) {
    awarded = await award(req.user, 'watch', t.watchPoints, t.title, t._id);
    w.awarded = true;
    t.watchCount = (t.watchCount || 0) + 1;
    await t.save();
    await req.user.save();
  }
  await w.save();
  res.json({ percent: w.percent, completed: w.completed, required: WATCH_REQUIRED_PCT, awarded, balance: req.user.points });
}));

// Critic posts a rating + review. Requires having watched ≥75% of the film.
r.post('/:id/review', protect(), requireRole('critic'), asyncHandler(async (req, res) => {
  const t = await Title.findById(req.params.id);
  if (!t) throw notFound('Title not found');

  const w = await Watch.findOne({ critic: req.user._id, title: t._id });
  if (!w || w.percent < WATCH_REQUIRED_PCT) {
    throw badRequest(`Watch at least ${Math.round(WATCH_REQUIRED_PCT * 100)}% of the film before reviewing`);
  }

  const { rating, headline, body, tags } = req.body || {};
  if (!rating || rating < 1 || rating > 5) throw badRequest('Rating 1–5 required');

  let review;
  try {
    review = await Review.create({
      title: t._id, critic: req.user._id, rating, score: Math.round(rating * 2 * 10) / 10,
      headline: headline || '', body: body || '', tags: tags || [],
    });
  } catch (e) {
    if (e.code === 11000) throw conflict('You have already reviewed this title');
    throw e;
  }

  const agg = await Review.aggregate([
    { $match: { title: t._id } },
    { $group: { _id: '$title', avg: { $avg: '$score' }, count: { $sum: 1 } } },
  ]);
  t.reviewCount = agg[0]?.count || 1;
  t.score = Math.round((agg[0]?.avg || review.score) * 10) / 10;
  if (t.reviewCount >= 12) t.status = 'scored';
  await t.save();

  // reviewCount counts toward earning eligibility and must grow even pre-eligibility.
  req.user.reviewCount = (req.user.reviewCount || 0) + 1;
  // Award review/rating points ONCE per title — a repeat review yields no points.
  const alreadyAwarded = await PointsLedger.exists({ user: req.user._id, title: t._id, type: { $in: ['review', 'rating'] } });
  let earned = 0;
  if (!alreadyAwarded) {
    earned =
      (await award(req.user, 'review', POINTS.review, t.title, t._id)) +
      (await award(req.user, 'rating', POINTS.rating, t.title, t._id));
  }
  await req.user.save();

  res.status(201).json({ review, awarded: earned, score: t.score, balance: req.user.points, reviewCount: req.user.reviewCount });
}));

export default r;
