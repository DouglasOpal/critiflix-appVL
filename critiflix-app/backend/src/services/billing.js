import { User } from '../models/User.js';
import { Subscription } from '../models/Subscription.js';
import { Cashout } from '../models/Cashout.js';
import { PLANS, PAYOUT_POOL_RATIO } from '../points.js';

// Activate a creator's plan (used by the simulated path and by the webhook).
export async function activatePlan(user, plan, { reference = null, providerRef = null } = {}) {
  const renewsAt = new Date(Date.now() + 30 * 864e5);
  user.plan = plan;
  user.planRenews = renewsAt;
  await user.save();

  await Subscription.updateMany(
    { creator: user._id, status: { $in: ['active', 'pending'] } },
    { $set: { status: 'canceled', canceledAt: new Date() } }
  );
  await Subscription.create({
    creator: user._id, plan, price: PLANS[plan].price, status: 'active',
    provider: providerRef ? 'paystack' : 'manual', providerRef, reference, renewsAt,
  });
  return renewsAt;
}

// Webhook: a checkout succeeded -> activate the matching pending subscription.
export async function activateSubscriptionByReference(reference, providerRef) {
  const sub = await Subscription.findOne({ reference });
  if (!sub || sub.status === 'active') return null;
  const user = await User.findById(sub.creator);
  if (!user) return null;
  await activatePlan(user, sub.plan, { reference, providerRef });
  return sub;
}

// Webhook: a transfer settled / failed -> update the cashout.
export async function settleCashout({ reference, transferCode }, outcome) {
  const q = transferCode ? { transferCode } : { providerRef: reference };
  const cashout = await Cashout.findOne(q);
  if (!cashout) return null;
  if (outcome === 'success') {
    cashout.status = 'paid';
  } else {
    cashout.status = 'failed';
    cashout.failureReason = 'Transfer failed at provider';
    // refund the points so the critic isn't out of pocket
    const user = await User.findById(cashout.user);
    if (user) { user.points += cashout.points; await user.save(); }
  }
  await cashout.save();
  return cashout;
}

// ---- Payout economics -------------------------------------------------------
// Only PAYOUT_POOL_RATIO (50%) of subscription revenue funds critic payouts.

export async function getSubscriptionRevenue() {
  const active = await Subscription.find({ status: 'active' }).select('plan price').lean();
  return active.reduce((sum, s) => sum + (s.price || PLANS[s.plan]?.price || 0), 0);
}

export async function getPayoutPool() {
  const revenue = await getSubscriptionRevenue();
  return Math.round(revenue * PAYOUT_POOL_RATIO);
}

// ₦ already committed to payouts (paid + in-flight, excluding rejected/failed).
export async function getAllocatedPayout() {
  const rows = await Cashout.find({ status: { $in: ['review', 'cleared', 'processing', 'paid'] } }).select('amount').lean();
  return rows.reduce((sum, c) => sum + (c.amount || 0), 0);
}

export async function getPayoutBudget() {
  const [pool, allocated] = await Promise.all([getPayoutPool(), getAllocatedPayout()]);
  return { pool, allocated, remaining: Math.max(0, pool - allocated) };
}
