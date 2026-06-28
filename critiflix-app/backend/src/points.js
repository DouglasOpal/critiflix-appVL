// Points economy — single source of truth.
export const POINTS = {
  review: 80,      // publish a review
  rating: 20,      // leave a rating
  referral: 250,   // referred critic joins & reviews
};

export const REDEEM_RATE = 1;        // 1 point -> ₦1 (subject to payout pool, below)
export const CASHOUT_FEE = 25;       // flat ₦ fee per cashout

// ---- Earning + cashout eligibility (a critic must build an audience first) ----
export const EARN_MIN_FOLLOWERS = 200;   // followers required before points count
export const EARN_MIN_REVIEWS = 1000;    // published reviews required before points count

// ---- Watch gate: must watch this share of the film before reviewing ----
export const WATCH_REQUIRED_PCT = 0.75;

// ---- Payout pool: only half of subscription revenue funds critic payouts ----
export const PAYOUT_POOL_RATIO = 0.5;

// ---- Per-title watch points, ratioed by plan + movie length, clamped 50–150 ----
export const TITLE_POINTS = {
  min: 50,
  max: 150,
  planBase: { starter: 50, pro: 90, studio: 120 }, // higher tier => more points
  perMinute: 0.5,                                    // longer film => more points
  lengthCapMin: 60,                                  // length bonus caps at 60 min (=> +30)
};

// Creator subscription plans (creator-only). Higher tiers get more active titles,
// stronger priority placement, and higher per-title watch points.
export const PLANS = {
  starter: { id: 'starter', name: 'Starter', price: 0,     activeTitles: 1,        priority: 1, featured: false },
  pro:     { id: 'pro',     name: 'Pro',     price: 7500,  activeTitles: 10,       priority: 2, featured: true  },
  studio:  { id: 'studio',  name: 'Studio',  price: 20000, activeTitles: Infinity, priority: 3, featured: true  },
};

// Compute the watch-points a title awards, from the creator's plan and film length.
export function titleWatchPoints(plan, runtimeMinutes = 0) {
  const base = TITLE_POINTS.planBase[plan] ?? TITLE_POINTS.planBase.starter;
  const bonus = Math.min(Math.max(runtimeMinutes, 0), TITLE_POINTS.lengthCapMin) * TITLE_POINTS.perMinute;
  return Math.round(Math.max(TITLE_POINTS.min, Math.min(TITLE_POINTS.max, base + bonus)));
}

// Parse a runtime string like "1h 52m" / "112 min" / "95" into minutes.
export function runtimeToMinutes(runtime) {
  if (!runtime) return 0;
  const s = String(runtime).toLowerCase();
  const h = s.match(/(\d+)\s*h/);
  const m = s.match(/(\d+)\s*m/);
  if (h || m) return (h ? +h[1] : 0) * 60 + (m ? +m[1] : 0);
  const n = s.match(/\d+/);
  return n ? +n[0] : 0;
}

export function isEligibleToEarn(user) {
  return (user?.followers || 0) >= EARN_MIN_FOLLOWERS && (user?.reviewCount || 0) >= EARN_MIN_REVIEWS;
}
