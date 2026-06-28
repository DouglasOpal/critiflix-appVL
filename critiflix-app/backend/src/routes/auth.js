import { Router } from 'express';
import crypto from 'crypto';
import { User } from '../models/User.js';
import { PasswordReset } from '../models/PasswordReset.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, unauthorized, notFound } from '../utils/ApiError.js';
import { userCode, referralCode } from '../utils/ids.js';
import { hashToken } from '../utils/tokens.js';
import { protect } from '../middleware/auth.js';
import { issueTokens, rotateRefresh, revokeRefresh, revokeAllForUser } from '../services/authService.js';
import { sendOtp, verifyOtp } from '../services/otp.js';
import { env } from '../config/env.js';

const r = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmail = (e) => EMAIL_RE.test(String(e || ''));
const strongEnough = (p) => typeof p === 'string' && p.length >= 8;

async function uniqueUserCode(role) {
  for (let i = 0; i < 5; i++) {
    const c = userCode(role);
    if (!(await User.exists({ code: c }))) return c;
  }
  return userCode(role);
}

// ---- POST /auth/register ----------------------------------------------------
r.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password, role = 'critic', referredByCode, code, channel = 'email', phone, whatsapp } = req.body || {};
  if (!name || !isEmail(email) || !strongEnough(password)) {
    throw badRequest('Name, a valid email and a password of at least 8 characters are required');
  }
  if (!whatsapp || String(whatsapp).replace(/[^0-9]/g, '').length < 7) {
    throw badRequest('A valid WhatsApp number is required');
  }
  if (!['critic', 'creator'].includes(role)) throw badRequest('Role must be critic or creator');
  if (!['email', 'phone'].includes(channel)) throw badRequest('Confirmation channel must be email or phone');
  if (await User.exists({ email: email.toLowerCase() })) throw badRequest('That email is already registered');

  // ---- Mandatory confirmation: a valid OTP for the chosen channel is required ----
  const destination = channel === 'phone' ? phone : email;
  if (!destination) throw badRequest('A phone number is required to confirm by SMS');
  if (!code) throw badRequest('Enter the confirmation code we sent you');
  const confirm = await verifyOtp(channel, destination, code);
  if (!confirm.ok) throw badRequest(confirm.reason || 'That confirmation code is invalid');

  const creatorFields = {};
  if (role === 'creator') {
    const { channelUrl, otherUrl, country, genre, logoUrl } = req.body || {};
    if (!channelUrl) throw badRequest('Creators must provide a channel link');
    Object.assign(creatorFields, { channelUrl, otherUrl, country, genre, logoUrl, plan: 'starter', status: 'pending' });
  }

  let referredBy = null;
  if (referredByCode) {
    const ref = await User.findOne({ referralCode: referredByCode });
    if (ref) referredBy = ref._id;
  }

  const user = await User.create({
    code: await uniqueUserCode(role),
    role,
    name,
    email: email.toLowerCase(),
    phone: channel === 'phone' ? phone : (phone || null),
    whatsapp: String(whatsapp).trim(),
    emailVerified: channel === 'email',
    phoneVerified: channel === 'phone',
    passwordHash: await User.hashPassword(password),
    avatarColor: role === 'critic' ? '#E50914' : '#13294B',
    status: role === 'creator' ? 'pending' : 'active',
    referralCode: role === 'critic' ? referralCode(name) : undefined,
    referredBy,
    ...creatorFields,
  });

  const tokens = await issueTokens(user, req);
  res.status(201).json({ user: user.toPublic(), ...tokens });
}));

// ---- POST /auth/login -------------------------------------------------------
r.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || !password) throw badRequest('Email and password are required');

  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  if (!user || !(await user.verifyPassword(password))) throw unauthorized('Invalid email or password');

  user.lastLoginAt = new Date();
  await user.save();

  const tokens = await issueTokens(user, req);
  res.json({ user: user.toPublic(), ...tokens });
}));

// ---- POST /auth/refresh -----------------------------------------------------
r.post('/refresh', asyncHandler(async (req, res) => {
  const presented = req.body?.refreshToken;
  if (!presented) throw badRequest('refreshToken is required');

  const record = await RefreshToken.findOne({ tokenHash: hashToken(presented) });
  if (!record) throw unauthorized('Refresh token is invalid or expired');
  const user = await User.findById(record.user);
  if (!user) throw unauthorized('Account no longer exists');

  const tokens = await rotateRefresh(presented, user, req);
  res.json({ user: user.toPublic(), ...tokens });
}));

// ---- POST /auth/logout ------------------------------------------------------
r.post('/logout', asyncHandler(async (req, res) => {
  await revokeRefresh(req.body?.refreshToken);
  res.json({ ok: true });
}));

// ---- GET /auth/me -----------------------------------------------------------
r.get('/me', protect(), asyncHandler(async (req, res) => {
  res.json(req.user.toPublic());
}));

// ---- POST /auth/forgot-password --------------------------------------------
r.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  const user = isEmail(email) ? await User.findOne({ email: email.toLowerCase() }) : null;
  let devToken;
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    await PasswordReset.create({
      user: user._id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    devToken = token; // emailed in production
  }
  res.json({ ok: true, ...(env.isProd ? {} : { devToken }) });
}));

// ---- POST /auth/reset-password ---------------------------------------------
r.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !strongEnough(password)) throw badRequest('A valid token and new password (8+ chars) are required');

  const record = await PasswordReset.findOne({ tokenHash: hashToken(token), usedAt: null });
  if (!record || record.expiresAt <= new Date()) throw badRequest('Reset link is invalid or has expired');

  const user = await User.findById(record.user);
  if (!user) throw notFound('Account not found');

  user.passwordHash = await User.hashPassword(password);
  await user.save();
  record.usedAt = new Date();
  await record.save();
  await revokeAllForUser(user._id);

  res.json({ ok: true });
}));

// ---- POST /auth/change-password (authenticated) -----------------------------
r.post('/change-password', protect(), asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!strongEnough(newPassword)) throw badRequest('New password must be at least 8 characters');
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await user.verifyPassword(currentPassword || ''))) throw unauthorized('Current password is incorrect');
  user.passwordHash = await User.hashPassword(newPassword);
  await user.save();
  await revokeAllForUser(user._id);
  res.json({ ok: true });
}));

// ---- POST /auth/otp/request  &  /auth/otp/verify ---------------------------
// Email/phone OTP for verifying users + creators (and passwordless sign-in).
r.post('/otp/request', asyncHandler(async (req, res) => {
  const { channel = 'email', destination } = req.body || {};
  if (!['email', 'phone'].includes(channel)) throw badRequest('Choose email or phone');
  if (!destination) throw badRequest('Enter your email or phone number');
  const result = await sendOtp(channel, destination);
  res.json({ sent: true, channel, ...(result.devCode ? { devCode: result.devCode } : {}) });
}));

r.post('/otp/verify', asyncHandler(async (req, res) => {
  const { channel = 'email', destination, code } = req.body || {};
  if (!destination || !code) throw badRequest('Enter the code we sent you');
  const v = await verifyOtp(channel, destination, code);
  if (!v.ok) throw badRequest(v.reason);

  const query = channel === 'email' ? { email: destination.toLowerCase() } : { phone: destination };
  const user = await User.findOne(query);
  if (user) {
    if (channel === 'email') user.emailVerified = true; else user.phoneVerified = true;
    user.lastLoginAt = new Date();
    await user.save();
    const tokens = await issueTokens(user, req);
    return res.json({ verified: true, user: user.toPublic(), ...tokens });
  }
  // No account yet — client uses the verified destination to finish registration.
  res.json({ verified: true, user: null, channel, destination });
}));

export default r;
