import crypto from 'crypto';

// Paystack integration. When PAYSTACK_SECRET_KEY is absent (dev), every call is
// simulated so the subscription/cashout flows still work end-to-end. Set the key
// (and reach api.paystack.co) to go live — no other code changes required.
const SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const BASE = 'https://api.paystack.co';
export const paystackEnabled = !!SECRET;

const ref = (p) => `${p}_${crypto.randomBytes(8).toString('hex')}`;

async function call(path, { method = 'GET', body } = {}) {
  if (!paystackEnabled) throw new Error('Paystack is not configured');
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    throw new Error(data.message || `Paystack request failed (${res.status})`);
  }
  return data.data;
}

// ---- Subscriptions: one-off checkout for a plan ----------------------------
export async function initializeTransaction({ email, amountNaira, reference, metadata, callbackUrl }) {
  if (!paystackEnabled) {
    const r = reference || ref('sub');
    return { simulated: true, reference: r, authorization_url: `https://checkout.paystack.com/simulated/${r}`, access_code: 'sim' };
  }
  return call('/transaction/initialize', {
    method: 'POST',
    body: { email, amount: Math.round(amountNaira * 100), reference, metadata, callback_url: callbackUrl },
  });
}

export async function verifyTransaction(reference) {
  if (!paystackEnabled) return { simulated: true, status: 'success', reference, amount: 0 };
  return call(`/transaction/verify/${encodeURIComponent(reference)}`);
}

// ---- Cashouts: bank resolve + transfer recipient + transfer ----------------
export async function resolveAccount({ accountNumber, bankCode }) {
  if (!paystackEnabled) return { simulated: true, account_number: accountNumber, account_name: 'Demo Account' };
  return call(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
}

export async function createTransferRecipient({ name, accountNumber, bankCode, type = 'nuban' }) {
  if (!paystackEnabled) return { simulated: true, recipient_code: ref('RCP') };
  return call('/transferrecipient', { method: 'POST', body: { type, name, account_number: accountNumber, bank_code: bankCode, currency: 'NGN' } });
}

export async function initiateTransfer({ amountNaira, recipientCode, reason, reference }) {
  if (!paystackEnabled) {
    return { simulated: true, transfer_code: ref('TRF'), reference: reference || ref('trf'), status: 'success' };
  }
  return call('/transfer', {
    method: 'POST',
    body: { source: 'balance', amount: Math.round(amountNaira * 100), recipient: recipientCode, reason, reference },
  });
}

// ---- Webhook signature verification ----------------------------------------
// Paystack signs the raw request body with HMAC-SHA512 using your secret key.
export function verifyWebhookSignature(rawBody, signature) {
  if (!SECRET) return false;
  const expected = crypto.createHmac('sha512', SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
  } catch {
    return false;
  }
}

export const newReference = ref;
