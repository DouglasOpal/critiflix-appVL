import crypto from 'crypto';
import { Otp } from '../models/Otp.js';

// OTP delivery. With no SMS/email provider configured, codes are "simulated":
// logged server-side and returned to the client as devCode so the flow is testable.
// Set OTP_PROVIDER (+ provider creds) to wire a real sender (e.g. Termii, Twilio, SendGrid).
export const otpEnabled = !!process.env.OTP_PROVIDER;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export async function sendOtp(channel, destination) {
  const dest = destination.toLowerCase();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await Otp.deleteMany({ channel, destination: dest, consumed: false });
  await Otp.create({ channel, destination: dest, codeHash: sha(code), expiresAt: new Date(Date.now() + 10 * 60000) });

  if (!otpEnabled) {
    console.log(`[otp] ${channel} -> ${destination}: ${code}`);
    return { simulated: true, devCode: code };
  }
  // TODO: integrate real provider here (channel === 'phone' ? SMS : email)
  return { simulated: false };
}

export async function verifyOtp(channel, destination, code) {
  const dest = destination.toLowerCase();
  const rec = await Otp.findOne({ channel, destination: dest, consumed: false }).sort({ createdAt: -1 });
  if (!rec) return { ok: false, reason: 'Request a code first' };
  if (rec.expiresAt < new Date()) return { ok: false, reason: 'That code has expired' };
  if (rec.attempts >= 5) return { ok: false, reason: 'Too many attempts — request a new code' };
  rec.attempts += 1;
  if (rec.codeHash !== sha(code)) { await rec.save(); return { ok: false, reason: 'Incorrect code' }; }
  rec.consumed = true;
  await rec.save();
  return { ok: true };
}
