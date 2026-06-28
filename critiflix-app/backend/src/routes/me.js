import { Router } from 'express';
import { Title } from '../models/Title.js';
import { Review } from '../models/Review.js';
import { Watch } from '../models/Watch.js';
import { PointsLedger } from '../models/PointsLedger.js';
import { Cashout } from '../models/Cashout.js';
import { Subscription } from '../models/Subscription.js';
import { User } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden } from '../utils/ApiError.js';
import { protect } from '../middleware/auth.js';
import { cashoutCode } from '../utils/ids.js';
import { POINTS, PLANS, REDEEM_RATE, CASHOUT_FEE, isEligibleToEarn, EARN_MIN_FOLLOWERS, EARN_MIN_REVIEWS } from '../points.js';
import { initializeTransaction, newReference } from '../services/paystack.js';
import { activatePlan, getPayoutBudget } from '../services/billing.js';
import { env } from '../config/env.js';

const r = Router();
r.use(protect());

// Critic: points balance + earn config + ledger.
r.get('/points', asyncHandler(async (req, res) => {
  const ledger = await PointsLedger.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({
    balance: req.user.points || 0,
    nairaValue: (req.user.points || 0) * REDEEM_RATE,
    earnRates: { watch: '50–150', ...POINTS },
    eligibility: {
      eligible: isEligibleToEarn(req.user),
      followers: req.user.followers || 0,
      reviews: req.user.reviewCount || 0,
      minFollowers: EARN_MIN_FOLLOWERS,
      minReviews: EARN_MIN_REVIEWS,
    },
    ledger,
  });
}));

// Critic: my reviews.
r.get('/reviews', asyncHandler(async (req, res) => {
  const reviews = await Review.find({ critic: req.user._id })
    .populate('title', 'title genre code')
    .sort({ createdAt: -1 })
    .lean();
  res.json(reviews);
}));

// Critic: redeem points -> cashout request (settled later via Paystack transfer).
r.post('/redeem', asyncHandler(async (req, res) => {
  const { points, method, destination, bankCode, accountNumber } = req.body || {};
  if (!isEligibleToEarn(req.user)) {
    throw badRequest(`Cashout unlocks at ${EARN_MIN_FOLLOWERS} followers and ${EARN_MIN_REVIEWS} reviews. You have ${req.user.followers || 0} followers and ${req.user.reviewCount || 0} reviews.`);
  }
  if (!points || points <= 0) throw badRequest('Enter a points amount');
  if (points > (req.user.points || 0)) throw badRequest('Not enough points');
  if (!method || !destination) throw badRequest('Choose a payout destination');

  const amount = points * REDEEM_RATE - CASHOUT_FEE;
  if (amount <= 0) throw badRequest('Amount is below the cashout fee');

  // Payouts draw from a pool of 50% of subscription revenue.
  const budget = await getPayoutBudget();
  if (amount > budget.remaining) {
    throw badRequest(`Payout pool is low — only ₦${budget.remaining.toLocaleString()} is available right now. Try a smaller amount or check back later.`);
  }

  req.user.points -= points;
  await req.user.save();
  await PointsLedger.create({ user: req.user._id, type: 'redeem', points: -points, ref: destination, balanceAfter: req.user.points });

  const cashout = await Cashout.create({
    code: cashoutCode(), user: req.user._id, points, fee: CASHOUT_FEE,
    amount, method, destination,
    bankCode: bankCode || null, accountNumber: accountNumber || null, status: 'review',
  });
  res.status(201).json({ cashout, balance: req.user.points });
}));

// Critic: referral summary.
r.get('/referrals', asyncHandler(async (req, res) => {
  const referred = await User.find({ referredBy: req.user._id })
    .select('name reviewCount createdAt').sort({ createdAt: -1 }).limit(30).lean();
  const earnedAgg = await PointsLedger.aggregate([
    { $match: { user: req.user._id, type: 'referral' } },
    { $group: { _id: null, total: { $sum: '$points' } } },
  ]);
  res.json({
    code: req.user.referralCode || req.user.code,
    link: `https://critiflix.app/r/${req.user.referralCode || req.user.code}`,
    rewardPerReferral: POINTS.referral,
    joined: referred.length,
    reviewed: referred.filter((u) => (u.reviewCount || 0) > 0).length,
    pointsEarned: earnedAgg[0]?.total || 0,
    referrals: referred.map((u) => ({ name: u.name, reviewed: (u.reviewCount || 0) > 0 })),
  });
}));

// Creator: subscribe / change plan (Paystack checkout; simulated when unconfigured).
r.post('/subscribe', asyncHandler(async (req, res) => {
  if (req.user.role !== 'creator') throw forbidden('Creators only');
  const { plan } = req.body || {};
  if (!PLANS[plan]) throw badRequest('Unknown plan');

  // Free tier: downgrade immediately, no payment.
  if (plan === 'starter') {
    req.user.plan = 'starter';
    req.user.planRenews = null;
    await req.user.save();
    await Subscription.updateMany({ creator: req.user._id, status: { $in: ['active', 'pending'] } }, { $set: { status: 'canceled', canceledAt: new Date() } });
    return res.json({ plan: PLANS.starter, status: 'active' });
  }

  const reference = newReference('sub');
  await Subscription.create({ creator: req.user._id, plan, price: PLANS[plan].price, status: 'pending', provider: 'paystack', reference });

  const tx = await initializeTransaction({
    email: req.user.email,
    amountNaira: PLANS[plan].price,
    reference,
    metadata: { userId: String(req.user._id), plan, kind: 'subscription' },
    callbackUrl: env.paystackCallbackUrl,
  });

  // In simulated mode (no Paystack key) activate right away for a smooth demo.
  if (tx.simulated) {
    const renews = await activatePlan(req.user, plan, { reference, providerRef: reference });
    return res.json({ plan: PLANS[plan], status: 'active', simulated: true, checkoutUrl: tx.authorization_url, renews });
  }

  // Live: client opens checkoutUrl; activation happens on the charge.success webhook.
  res.status(202).json({ plan: PLANS[plan], status: 'pending', checkoutUrl: tx.authorization_url, reference });
}));

// Creator: dashboard summary.
r.get('/studio', asyncHandler(async (req, res) => {
  if (req.user.role !== 'creator') throw forbidden('Creators only');
  const titles = await Title.find({ creator: req.user._id }).sort({ createdAt: -1 }).lean();
  const ids = titles.map((t) => t._id);
  const scored = titles.filter((t) => t.score != null);
  const avg = scored.length ? Math.round((scored.reduce((s, t) => s + t.score, 0) / scored.length) * 10) / 10 : 0;
  const watches = await Watch.countDocuments({ title: { $in: ids } });
  const reviews = await Review.countDocuments({ title: { $in: ids } });
  res.json({
    studio: { name: req.user.name, plan: req.user.plan, planRenews: req.user.planRenews, avatarColor: req.user.avatarColor, logoUrl: req.user.logoUrl || null, channelUrl: req.user.channelUrl, genre: req.user.genre, country: req.user.country },
    stats: { avgScore: avg, watches, reviews },
    titles: titles.map((t) => ({ ...t, id: t._id })),
  });
}));

// Creator: launch a promotion.
// Creator: set (or clear) the studio/channel logo. `logoUrl` comes from /uploads/image.
r.post('/logo', asyncHandler(async (req, res) => {
  if (req.user.role !== 'creator') throw forbidden('Creators only');
  const { logoUrl } = req.body || {};
  if (logoUrl && typeof logoUrl !== 'string') throw badRequest('logoUrl must be a string');
  req.user.logoUrl = logoUrl || null;
  await req.user.save();
  res.json({ logoUrl: req.user.logoUrl });
}));

// Any user: set (or clear) their profile picture. `avatarUrl` comes from /uploads/image.
r.post('/avatar', asyncHandler(async (req, res) => {
  const { avatarUrl } = req.body || {};
  if (avatarUrl && typeof avatarUrl !== 'string') throw badRequest('avatarUrl must be a string');
  req.user.avatarUrl = avatarUrl || null;
  await req.user.save();
  res.json({ avatarUrl: req.user.avatarUrl });
}));

export default r;
