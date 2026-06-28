import { PointsLedger } from '../models/PointsLedger.js';
import { isEligibleToEarn } from '../points.js';

// Award points — but only once the critic is eligible to earn (≥200 followers
// and ≥1000 reviews). Before that, actions still happen but yield 0 points.
// Caller is responsible for await user.save() afterward (batched).
export async function award(user, type, points, ref, titleId = null) {
  if (!isEligibleToEarn(user)) return 0;
  user.points = (user.points || 0) + points;
  await PointsLedger.create({
    user: user._id, type, points, ref: ref || '', title: titleId, balanceAfter: user.points,
  });
  return points;
}
