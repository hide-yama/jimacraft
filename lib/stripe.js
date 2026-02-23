/**
 * lib/stripe.js
 * Stripeクライアント初期化
 */

const Stripe = require('stripe');

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
    console.warn('Stripe環境変数が未設定です（STRIPE_SECRET_KEY）');
}

const stripe = stripeSecretKey ? Stripe(stripeSecretKey) : null;

module.exports = { stripe };
