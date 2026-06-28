import { Router } from 'express';
import { User } from '../models/User.js';
import { Title } from '../models/Title.js';
import { PointsLedger } from '../models/PointsLedger.js';
import { Promotion } from '../models/Promotion.js';
import { Cashout } from '../models/Cashout.js';
import { Integration } from '../models/Integration.js';
import { Subscription } from '../models/Subscription.js';
import { Announcement } from '../models/Announcement.js';
import { notifyUsers } from '../services/notify.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/ApiError.js';
import { protect, requireRole } from '../middleware/auth.js';
import { PLANS } from '../points.js';
import { getSubscriptionRevenue, getPayoutBudget } from '../services/billing.js';
import { createTransferRecipient, initiateTransfer, newReference } from '../services/paystack.js';

const r = Router();
r.use(protect(), requireRole('admin'));

r.get('/overview', asyncHandler(async (req, res) => {
  const [critics, creators, subscribed, pointsAgg, pending] = await Promise.all([
    User.countDocuments({ role: 'critic' }),
    User.countDocuments({ role: 'creator' }),
    User.find({ role: 'creator', plan: { $ne: 'starter' } }).select('plan').lean(),
    PointsLedger.aggregate([{ $match: { points: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: '$points' } } }]),
    Cashout.find({ status: 'review' }).lean(),
  ]);
  const mrr = subscribed.reduce((s, c) => s + (PLANS[c.plan]?.price || 0), 0);
  const recent = await PointsLedger.find().sort({ createdAt: -1 }).limit(6).populate('user', 'name').lean();
  res.json({
    kpis: {
      totalUsers: critics + creators,
      subscribedCreators: subscribed.length,
      mrr,
      pointsIssued30d: pointsAgg[0]?.total || 0,
      pendingCashouts: pending.reduce((s, c) => s + c.amount, 0),
      pendingCount: pending.length,
    },
    userMix: { critics, creators },
    activity: recent.map((l) => ({ event: l.type, actor: l.user?.name, detail: l.ref, points: l.points, at: l.createdAt })),
  });
}));

r.get('/users', asyncHandler(async (req, res) => {
  const users = await User.find({ role: { $ne: 'admin' } }).sort({ createdAt: -1 }).lean();
  res.json(users.map((u) => ({
    id: u._id, code: u.code, name: u.name, email: u.email, phone: u.phone, role: u.role, status: u.status,
    plan: u.plan, points: u.points, followers: u.followers, reviewCount: u.reviewCount,
    eligible: (u.followers || 0) >= 200 && (u.reviewCount || 0) >= 1000,
    whatsapp: u.whatsapp,
    emailVerified: u.emailVerified, phoneVerified: u.phoneVerified,
    channelUrl: u.channelUrl, avatarColor: u.avatarColor, createdAt: u.createdAt,
  })));
}));

r.post('/users/:id/:action', asyncHandler(async (req, res) => {
  const map = { verify: 'verified', ban: 'banned', activate: 'active' };
  const status = map[req.params.action];
  if (!status) throw badRequest('Unknown action');
  const u = await User.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!u) throw notFound('User not found');
  res.json({ id: u._id, status: u.status });
}));

r.get('/subscriptions', asyncHandler(async (req, res) => {
  const creators = await User.find({ role: 'creator' }).select('plan').lean();
  const byPlan = Object.values(PLANS).map((p) => ({ ...p, count: creators.filter((c) => c.plan === p.id).length }));
  const mrr = creators.reduce((s, c) => s + (PLANS[c.plan]?.price || 0), 0);
  res.json({ mrr, subscribed: creators.filter((c) => c.plan !== 'starter').length, byPlan });
}));

r.get('/promotions', asyncHandler(async (req, res) => {
  const promos = await Promotion.find().populate('title', 'title').populate('creator', 'name').sort({ createdAt: -1 }).lean();
  res.json(promos.map((p) => ({ ...p, title: p.title?.title, creator: p.creator?.name })));
}));

r.post('/promotions/:id/:action', asyncHandler(async (req, res) => {
  const status = req.params.action === 'approve' ? 'live' : 'rejected';
  const p = await Promotion.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!p) throw notFound('Promotion not found');
  res.json(p);
}));

r.get('/integrations', asyncHandler(async (req, res) => {
  res.json(await Integration.find().lean());
}));

r.post('/integrations/:key/toggle', asyncHandler(async (req, res) => {
  const i = await Integration.findOne({ key: req.params.key });
  if (!i) throw notFound('Integration not found');
  i.connected = !i.connected;
  await i.save();
  res.json(i);
}));

r.get('/cashouts', asyncHandler(async (req, res) => {
  const list = await Cashout.find().populate('user', 'name code').sort({ createdAt: -1 }).lean();
  res.json(list.map((c) => ({ ...c, critic: c.user?.name })));
}));

r.post('/cashouts/:id/:action', asyncHandler(async (req, res) => {
  const { action } = req.params;
  const c = await Cashout.findById(req.params.id);
  if (!c) throw notFound('Cashout not found');

  if (action === 'approve') {
    c.status = 'cleared';
    await c.save();
    return res.json(c);
  }

  if (action === 'reject') {
    if (!['paid', 'processing'].includes(c.status)) {
      // refund points that were debited at redeem time
      const user = await User.findById(c.user);
      if (user) { user.points += c.points; await user.save(); }
    }
    c.status = 'rejected';
    await c.save();
    return res.json(c);
  }

  if (action === 'pay') {
    // Create a transfer recipient (once), then initiate the payout.
    if (!c.recipientCode && c.accountNumber && c.bankCode) {
      const recip = await createTransferRecipient({ name: c.destination, accountNumber: c.accountNumber, bankCode: c.bankCode });
      c.recipientCode = recip.recipient_code;
    }
    const reference = newReference('trf');
    const transfer = await initiateTransfer({
      amountNaira: c.amount,
      recipientCode: c.recipientCode || 'RCP_simulated',
      reason: `CritiFlix cashout ${c.code}`,
      reference,
    });
    c.transferCode = transfer.transfer_code;
    c.providerRef = reference;
    // Simulated transfers settle instantly; live transfers finish on webhook.
    c.status = transfer.simulated ? 'paid' : 'processing';
    await c.save();
    return res.json(c);
  }

  throw badRequest('Unknown action');
}));

// ---- Titles: moderation + curation (feature for priority placement) ----
r.get('/titles', asyncHandler(async (req, res) => {
  const titles = await Title.find().populate('creator', 'name code plan').sort({ createdAt: -1 }).lean();
  res.json(titles.map((t) => ({
    id: t._id, code: t.code, title: t.title, genre: t.genre, status: t.status,
    score: t.score, reviewCount: t.reviewCount, watchCount: t.watchCount,
    featured: t.featured, priorityBoost: t.priorityBoost,
    creator: t.creator?.name, plan: t.creator?.plan,
    posterSmall: t.posterSmall, createdAt: t.createdAt,
  })));
}));

// Full title properties for the admin approval review.
r.get('/titles/:id', asyncHandler(async (req, res) => {
  const t = await Title.findById(req.params.id).populate('creator', 'name code email plan channelUrl').lean();
  if (!t) throw notFound('Title not found');
  res.json({ ...t, id: t._id });
}));

r.post('/titles/:id/:action', asyncHandler(async (req, res) => {
  const t = await Title.findById(req.params.id);
  if (!t) throw notFound('Title not found');
  switch (req.params.action) {
    case 'approve':
      if (t.status === 'pending' || t.status === 'delisted') {
        t.status = 'reviewing';
        await t.save();
        // notify critics that a new title is live
        await notifyUsers({ role: 'critic', type: 'new_title', title: `New film: ${t.title}`, body: `${t.genre} — now available to watch & review.`, data: { titleId: String(t._id) } });
      }
      break;
    case 'delist': t.status = 'delisted'; break;        // violation / illegal content
    case 'relist': t.status = 'reviewing'; break;
    case 'feature': t.featured = true; break;
    case 'unfeature': t.featured = false; break;
    case 'boost': t.priorityBoost = (t.priorityBoost || 0) + 1; break;
    case 'unboost': t.priorityBoost = Math.max(0, (t.priorityBoost || 0) - 1); break;
    case 'end': t.status = 'ended'; break;
    case 'review': t.status = 'reviewing'; break;
    default: throw badRequest('Unknown action');
  }
  await t.save();
  res.json({ id: t._id, featured: t.featured, priorityBoost: t.priorityBoost, status: t.status });
}));

// ---- Analytics: time series + breakdowns for the dashboard charts ----
r.get('/analytics', asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 30 * 864e5);

  const [pointsByType, plansAgg, topTitles, signupsAgg] = await Promise.all([
    PointsLedger.aggregate([
      { $match: { points: { $gt: 0 } } },
      { $group: { _id: '$type', total: { $sum: '$points' } } },
    ]),
    User.aggregate([
      { $match: { role: 'creator' } },
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ]),
    Title.find().sort({ score: -1, reviewCount: -1 }).limit(5)
      .select('title score reviewCount watchCount').lean(),
    User.aggregate([
      { $match: { createdAt: { $gte: since }, role: { $ne: 'admin' } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  res.json({
    pointsByType: pointsByType.reduce((m, x) => ({ ...m, [x._id]: x.total }), {}),
    plansBreakdown: plansAgg.reduce((m, x) => ({ ...m, [x._id]: x.count }), {}),
    topTitles,
    signups: signupsAgg.map((s) => ({ date: s._id, count: s.count })),
  });
}));

// ---- Revenue analytics + payout pool ----
r.get('/revenue', asyncHandler(async (req, res) => {
  const [revenue, budget, subs] = await Promise.all([
    getSubscriptionRevenue(),
    getPayoutBudget(),
    Subscription.find({ status: 'active' }).select('plan price createdAt').lean(),
  ]);
  const byPlan = {};
  for (const s of subs) {
    const k = s.plan;
    byPlan[k] = byPlan[k] || { count: 0, revenue: 0 };
    byPlan[k].count += 1;
    byPlan[k].revenue += s.price || PLANS[k]?.price || 0;
  }
  // last-6-months subscription revenue series
  const series = {};
  for (const s of subs) {
    const d = new Date(s.createdAt); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    series[key] = (series[key] || 0) + (s.price || PLANS[s.plan]?.price || 0);
  }
  const paying = subs.filter((s) => s.plan !== 'starter').length;
  res.json({
    mrr: revenue,
    arpu: paying ? Math.round(revenue / paying) : 0,
    payoutPool: budget.pool, payoutAllocated: budget.allocated, payoutRemaining: budget.remaining,
    byPlan: Object.entries(byPlan).map(([plan, v]) => ({ plan, name: PLANS[plan]?.name || plan, ...v })),
    revenueSeries: Object.entries(series).sort().map(([month, amount]) => ({ month, amount })),
  });
}));

// ---- Promotional messages to users/creators ----
r.get('/announcements', asyncHandler(async (req, res) => {
  const items = await Announcement.find().populate('createdBy', 'name').sort({ createdAt: -1 }).limit(50).lean();
  res.json(items.map((a) => ({ ...a, id: a._id, createdBy: a.createdBy?.name || 'Admin' })));
}));

r.post('/announcements', asyncHandler(async (req, res) => {
  const { audience = 'all', title, body, channel = 'in_app' } = req.body || {};
  if (!title || !body) throw badRequest('Title and message are required');
  if (!['all', 'critics', 'creators'].includes(audience)) throw badRequest('Invalid audience');
  const a = await Announcement.create({ audience, title, body, channel, createdBy: req.user._id });
  // also push an in-app notification to the audience
  const role = audience === 'critics' ? 'critic' : audience === 'creators' ? 'creator' : null;
  const sent = await notifyUsers({ role, type: 'promo', title, body, data: { announcementId: String(a._id) } });
  res.status(201).json({ ...a.toObject(), id: a._id, notified: sent });
}));

// Launch a promotion to users' WhatsApp numbers. Real delivery needs the WhatsApp
// Business API; without it this is simulated — it records the broadcast, posts an
// in-app alert, and returns the recipient numbers + a click-to-chat template.
r.post('/promotions/whatsapp', asyncHandler(async (req, res) => {
  const { audience = 'all', title, message } = req.body || {};
  if (!title || !message) throw badRequest('A title and message are required');
  const role = audience === 'critics' ? 'critic' : audience === 'creators' ? 'creator' : null;
  const q = role ? { role } : { role: { $ne: 'admin' } };
  const recipients = await User.find({ ...q, whatsapp: { $ne: null } }).select('name whatsapp _id').lean();

  await Announcement.create({ audience, title, body: message, channel: 'whatsapp', createdBy: req.user._id });
  await notifyUsers({ userIds: recipients.map((u) => u._id), type: 'promo', title, body: message });

  const text = encodeURIComponent(`${title}\n\n${message}`);
  res.status(201).json({
    audience, recipientCount: recipients.length,
    recipients: recipients.map((u) => ({ name: u.name, whatsapp: u.whatsapp, link: `https://wa.me/${String(u.whatsapp).replace(/[^0-9]/g, '')}?text=${text}` })),
    note: 'Simulated send — configure the WhatsApp Business API to deliver automatically. Each link opens a pre-filled chat.',
  });
}));

// ---- Change a creator's plan (comp / correction) ----
r.post('/users/:id/plan', asyncHandler(async (req, res) => {
  const { plan } = req.body || {};
  if (!PLANS[plan]) throw badRequest('Unknown plan');
  const u = await User.findById(req.params.id);
  if (!u || u.role !== 'creator') throw notFound('Creator not found');
  u.plan = plan;
  await u.save();
  res.json({ id: u._id, plan: u.plan });
}));

export default r;
