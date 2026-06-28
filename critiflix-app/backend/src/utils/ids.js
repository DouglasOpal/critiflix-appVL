import { customAlphabet } from 'nanoid';
const digits = customAlphabet('0123456789', 4);
const code = customAlphabet('0123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 6);

// Human-friendly codes shown in the UI (e.g. CR-2041, CT-0188, AD-0001).
export const userCode = (role) => `${{ critic: 'CR', creator: 'CT', admin: 'AD' }[role] || 'US'}-${digits()}`;
export const titleCode = () => `TT-${code()}`;
export const promoCode = () => `PR-${code()}`;
export const cashoutCode = () => `CO-${code()}`;
export const referralCode = (name = '') =>
  (name.replace(/[^a-zA-Z]/g, '').slice(0, 6).toUpperCase() || 'CRITIC') + digits().slice(0, 2);
