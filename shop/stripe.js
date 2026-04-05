const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../db');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const BASE_URL = process.env.BASE_URL || 'https://dimontehypnose.de';

// ─────────────────────────────────────────
// Create Stripe Checkout Session
// ─────────────────────────────────────────
async function createCheckoutSession(product, customerEmail) {
  // Free events: no Stripe needed
  if (product.price_cents === 0) {
    throw new Error('Kostenlose Events brauchen keinen Checkout');
  }

  // Ensure Stripe Price exists
  let priceId = product.stripe_price_id;

  if (!priceId) {
    // Create product + price in Stripe on the fly
    const stripeProduct = await stripe.products.create({
      name: product.name,
      description: product.description || undefined,
      metadata: { dimonte_product_id: String(product.id) }
    });

    const stripePrice = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: product.price_cents,
      currency: 'eur',
    });

    priceId = stripePrice.id;

    // Save back to DB
    await pool.query(
      'UPDATE products SET stripe_price_id = $1, stripe_product_id = $2, updated_at = NOW() WHERE id = $3',
      [priceId, stripeProduct.id, product.id]
    );
  }

  const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  payment_method_configuration: 'pmc_1RX7RA2Ru2tLnDIM6DRM7Kth',
  allow_promotion_codes: true,
  line_items: [{ price: priceId, quantity: 1 }],
  customer_email: customerEmail || undefined,
  success_url: `${BASE_URL}/danke.html?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${BASE_URL}/termin.html`,
  metadata: {
    dimonte_product_id: String(product.id),
    product_type: product.type,
  },
  payment_intent_data: {
    metadata: {
      dimonte_product_id: String(product.id),
      product_name: product.name,
    }
  }
});

  // Create pending order
  await pool.query(
    `INSERT INTO orders (product_id, stripe_session_id, customer_email, amount_cents, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (stripe_session_id) DO NOTHING`,
    [product.id, session.id, customerEmail || '', product.price_cents]
  );

  return session;
}

// ─────────────────────────────────────────
// Handle Stripe Webhook
// ─────────────────────────────────────────
async function handleWebhook(rawBody, signature) {
  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  } catch (err) {
    throw new Error(`Webhook signature invalid: ${err.message}`);
  }

  console.log(`[STRIPE] Event: ${event.type}`);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const productId = session.metadata?.dimonte_product_id;

    await pool.query(
      `UPDATE orders
       SET status = 'paid',
           customer_name = $1,
           customer_email = $2,
           stripe_payment_intent = $3,
           updated_at = NOW()
       WHERE stripe_session_id = $4`,
      [
        session.customer_details?.name || '',
        session.customer_details?.email || session.customer_email || '',
        session.payment_intent || '',
        session.id
      ]
    );

    console.log(`[STRIPE] Order paid: session=${session.id} product=${productId}`);
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    await pool.query(
      `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE stripe_session_id = $1`,
      [session.id]
    );
  }

  return { received: true };
}

module.exports = { createCheckoutSession, handleWebhook };