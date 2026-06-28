import { verifyAccessToken } from '../utils/tokens.js';
import { User } from '../models/User.js';
import { unauthorized, forbidden } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Verifies the Bearer access token and loads the user.
export const protect = (required = true) =>
  asyncHandler(async (req, _res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      if (required) throw unauthorized('Missing access token');
      return next();
    }
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    const user = await User.findById(payload.sub);
    if (!user) throw unauthorized('Account no longer exists');
    if (user.status === 'banned') throw forbidden('Account suspended');
    req.user = user;
    next();
  });

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
  next();
};
