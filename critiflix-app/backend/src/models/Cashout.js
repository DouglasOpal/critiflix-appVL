import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const cashoutSchema = new Schema(
  {
    code: { type: String, unique: true, index: true },        // CO-XXXXXX
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // critic
    points: { type: Number, required: true },                 // points redeemed
    fee: { type: Number, default: 25 },                       // ₦ flat fee
    amount: { type: Number, required: true },                 // ₦ paid out (points*rate - fee)
    method: { type: String, enum: ['bank', 'mobile_money'], required: true },
    destination: { type: String, required: true },            // masked account / wallet
    bankCode: { type: String, default: null },                // Paystack bank/MMO code
    accountNumber: { type: String, default: null },           // payout account (store masked in prod)
    recipientCode: { type: String, default: null },           // Paystack transfer recipient
    transferCode: { type: String, default: null },            // Paystack transfer
    status: { type: String, enum: ['review', 'processing', 'cleared', 'paid', 'rejected', 'failed'], default: 'review', index: true },
    provider: { type: String, enum: ['paystack', 'manual'], default: 'paystack' },
    providerRef: { type: String, default: null },
    failureReason: { type: String, default: null },
  },
  { timestamps: true }
);
export const Cashout = model('Cashout', cashoutSchema);
