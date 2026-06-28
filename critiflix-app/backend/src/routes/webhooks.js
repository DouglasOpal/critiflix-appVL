import { Router, raw } from 'express';
import { verifyWebhookSignature } from '../services/paystack.js';
import { activateSubscriptionByReference, settleCashout } from '../services/billing.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const r = Router();

// Paystack posts JSON signed with HMAC-SHA512 over the raw body. We must read the
// raw bytes (not parsed JSON) to verify the signature, so this router uses raw().
r.post('/paystack', raw({ type: '*/*' }), asyncHandler(async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  if (!verifyWebhookSignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { return res.status(400).json({ error: 'Bad payload' }); }

  const { event: type, data = {} } = event;
  switch (type) {
    case 'charge.success':
      await activateSubscriptionByReference(data.reference, data.reference);
      break;
    case 'transfer.success':
      await settleCashout({ reference: data.reference, transferCode: data.transfer_code }, 'success');
      break;
    case 'transfer.failed':
    case 'transfer.reversed':
      await settleCashout({ reference: data.reference, transferCode: data.transfer_code }, 'failed');
      break;
    default:
      break; // ignore other events
  }
  res.json({ received: true });
}));

export default r;
