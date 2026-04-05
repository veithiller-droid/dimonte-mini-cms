const https = require('https');

const CAL_API_KEY = process.env.CAL_API_KEY || '';
const CAL_BASE = 'api.cal.com';

function calRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: CAL_BASE,
      path: `/v2${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${CAL_API_KEY}`,
        'Content-Type': 'application/json',
        'cal-api-version': '2024-08-13',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Get event types for a user (to find slug → eventTypeId mapping)
async function getEventTypes() {
  const res = await calRequest('GET', '/event-types');
  return res.data?.data || [];
}

// Get booking link for an event type slug
function getBookingLink(slug) {
  const calUsername = process.env.CAL_USERNAME || 'dimontehypnose';
  return `https://cal.com/${calUsername}/${slug}`;
}

// Get all upcoming bookings for admin panel
async function getBookings(limit = 50) {
  const res = await calRequest('GET', `/bookings?limit=${limit}&sortStart=desc`);
  return res.data?.data || [];
}

// Get single booking
async function getBooking(uid) {
  const res = await calRequest('GET', `/bookings/${uid}`);
  return res.data?.data || null;
}

module.exports = { getEventTypes, getBookingLink, getBookings, getBooking };