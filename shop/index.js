const express = require('express');
const router = express.Router();
const pool = require('../db');
const { createCheckoutSession, handleWebhook } = require('./stripe');
const { getBookingLink } = require('./calcom');
const { sendBookingConfirmation, sendDownloadConfirmation, sendAdminNotification } = require('./delivery');

// ─────────────────────────────────────────
// PUBLIC: Get active products
// ─────────────────────────────────────────
router.get('/products', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, price_cents, type, cal_event_type_slug, sort_order
       FROM products
       WHERE active = true
       ORDER BY sort_order ASC, id ASC`
    );
    res.json({ ok: true, items: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// PUBLIC: Create Checkout Session
// ─────────────────────────────────────────
router.post('/checkout', async (req, res) => {
  try {
    const { product_id, email } = req.body;

    if (!product_id) {
      return res.status(400).json({ ok: false, error: 'product_id fehlt' });
    }

    const result = await pool.query(
      'SELECT * FROM products WHERE id = $1 AND active = true LIMIT 1',
      [product_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Produkt nicht gefunden' });
    }

    const product = result.rows[0];

    // Free event: no checkout needed
    if (product.price_cents === 0) {
      const bookingLink = product.cal_event_type_slug
        ? getBookingLink(product.cal_event_type_slug)
        : null;
      return res.json({ ok: true, free: true, booking_link: bookingLink });
    }

    const session = await createCheckoutSession(product, email);
    res.json({ ok: true, checkout_url: session.url });
  } catch (e) {
    console.error('[SHOP] Checkout error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// STRIPE WEBHOOK (raw body required)
// Mounted separately in server.js before json middleware
// ─────────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    await handleWebhook(req.body, signature);

    // After payment confirmed: send delivery email
    // We parse the event again here just for delivery
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const productId = session.metadata?.dimonte_product_id;

      if (productId) {
        const productResult = await pool.query(
          'SELECT * FROM products WHERE id = $1 LIMIT 1',
          [productId]
        );

        if (productResult.rows.length > 0) {
          const product = productResult.rows[0];
          const customerEmail = session.customer_details?.email || session.customer_email;
          const customerName = session.customer_details?.name || '';
          const amountEur = `€${(session.amount_total / 100).toFixed(2).replace('.', ',')}`;

          // Send appropriate delivery email
          if (product.type === 'sitzung' || product.type === 'paket') {
            const bookingLink = product.cal_event_type_slug
              ? getBookingLink(product.cal_event_type_slug)
              : `https://cal.com/dimontehypnose`;

            await sendBookingConfirmation({
              to: customerEmail,
              name: customerName,
              productName: product.name,
              bookingLink,
              amountEur
            });
          } else if (product.type === 'download' && product.download_url) {
            await sendDownloadConfirmation({
              to: customerEmail,
              name: customerName,
              productName: product.name,
              downloadUrl: product.download_url,
              amountEur
            });
          }

          // Notify Bianca
          await sendAdminNotification({
            productName: product.name,
            customerName,
            customerEmail,
            amountEur
          });
        }
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error('[SHOP] Webhook error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;