const https = require('https');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@dimontehypnose.de';
const FROM_NAME = process.env.FROM_NAME || 'Bianca DiMonte';

function resendSend(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Confirmation email after purchase: sitzung/paket → booking link
async function sendBookingConfirmation({ to, name, productName, bookingLink, amountEur }) {
  if (!RESEND_API_KEY) {
    console.warn('[RESEND] No API key — skipping email');
    return;
  }

  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f5f0;font-family:Georgia,serif;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border:1px solid rgba(42,16,5,0.1);">
    <div style="background:#2a1005;padding:32px 40px;">
      <h1 style="margin:0;color:#fff6ea;font-size:1.4rem;font-weight:400;letter-spacing:0.05em;">DiMonte Hypnose</h1>
    </div>
    <div style="padding:40px;">
      <h2 style="margin:0 0 8px;color:#2a1005;font-size:1.1rem;font-weight:400;">Vielen Dank, ${name || 'liebe Klientin'}!</h2>
      <p style="color:#5a3a25;line-height:1.7;margin:16px 0;">
        Deine Buchung für <strong>${productName}</strong> ist bestätigt (${amountEur}).
      </p>
      <p style="color:#5a3a25;line-height:1.7;margin:16px 0;">
        Bitte wähle jetzt deinen Wunschtermin:
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${bookingLink}"
           style="display:inline-block;background:#1b2d18;color:#fff6ea;padding:14px 32px;text-decoration:none;font-family:sans-serif;font-size:0.875rem;letter-spacing:0.1em;text-transform:uppercase;">
          Termin wählen →
        </a>
      </div>
      <p style="color:#8a6a55;font-size:0.8rem;line-height:1.7;margin:32px 0 0;border-top:1px solid rgba(42,16,5,0.08);padding-top:24px;">
        Bei Fragen erreichst du mich unter <a href="mailto:contact@dimontehypnose.de" style="color:#1b2d18;">contact@dimontehypnose.de</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  await resendSend({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to,
    subject: `Buchungsbestätigung: ${productName}`,
    html
  });

  console.log(`[RESEND] Booking confirmation sent to ${to}`);
}

// Confirmation email for download products
async function sendDownloadConfirmation({ to, name, productName, downloadUrl, amountEur }) {
  if (!RESEND_API_KEY) {
    console.warn('[RESEND] No API key — skipping email');
    return;
  }

  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f5f0;font-family:Georgia,serif;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border:1px solid rgba(42,16,5,0.1);">
    <div style="background:#2a1005;padding:32px 40px;">
      <h1 style="margin:0;color:#fff6ea;font-size:1.4rem;font-weight:400;letter-spacing:0.05em;">DiMonte Hypnose</h1>
    </div>
    <div style="padding:40px;">
      <h2 style="margin:0 0 8px;color:#2a1005;font-size:1.1rem;font-weight:400;">Vielen Dank, ${name || 'liebe Klientin'}!</h2>
      <p style="color:#5a3a25;line-height:1.7;margin:16px 0;">
        Dein Download <strong>${productName}</strong> ist bereit (${amountEur}).
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${downloadUrl}"
           style="display:inline-block;background:#1b2d18;color:#fff6ea;padding:14px 32px;text-decoration:none;font-family:sans-serif;font-size:0.875rem;letter-spacing:0.1em;text-transform:uppercase;">
          Download starten →
        </a>
      </div>
      <p style="color:#8a6a55;font-size:0.8rem;line-height:1.7;margin:32px 0 0;border-top:1px solid rgba(42,16,5,0.08);padding-top:24px;">
        Bei Fragen erreichst du mich unter <a href="mailto:contact@dimontehypnose.de" style="color:#1b2d18;">contact@dimontehypnose.de</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  await resendSend({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to,
    subject: `Dein Download: ${productName}`,
    html
  });

  console.log(`[RESEND] Download confirmation sent to ${to}`);
}

// Notification to Bianca when new order comes in
async function sendAdminNotification({ productName, customerName, customerEmail, amountEur }) {
  if (!RESEND_API_KEY) return;

  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || 'contact@dimontehypnose.de';

  await resendSend({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: adminEmail,
    subject: `Neue Buchung: ${productName}`,
    html: `<p>Neue Buchung eingegangen:</p>
           <ul>
             <li><strong>Produkt:</strong> ${productName}</li>
             <li><strong>Betrag:</strong> ${amountEur}</li>
             <li><strong>Kunde:</strong> ${customerName}</li>
             <li><strong>E-Mail:</strong> ${customerEmail}</li>
           </ul>`
  });
}

// Reply to contact message from admin panel
async function sendMessageReply({ to, subject, body }) {
  if (!RESEND_API_KEY) {
    console.warn('[RESEND] No API key — skipping reply');
    return;
  }

  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8f5f0;font-family:Georgia,serif;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border:1px solid rgba(42,16,5,0.1);">
    <div style="background:#2a1005;padding:32px 40px;">
      <h1 style="margin:0;color:#fff6ea;font-size:1.4rem;font-weight:400;letter-spacing:0.05em;">DiMonte Hypnose</h1>
    </div>
    <div style="padding:40px;">
      <div style="color:#2a1005;line-height:1.8;white-space:pre-wrap;">${body}</div>
      <p style="color:#8a6a55;font-size:0.8rem;margin:32px 0 0;border-top:1px solid rgba(42,16,5,0.08);padding-top:24px;">
        Bianca DiMonte · <a href="https://dimontehypnose.de" style="color:#1b2d18;">dimontehypnose.de</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  await resendSend({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to,
    subject,
    html
  });

  console.log(`[RESEND] Reply sent to ${to}`);
}

module.exports = {
  sendBookingConfirmation,
  sendDownloadConfirmation,
  sendAdminNotification,
  sendMessageReply
};