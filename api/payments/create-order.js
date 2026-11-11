import https from 'https';
import crypto from 'crypto';

const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || '';
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || '';
const CASHFREE_ENV = (process.env.CASHFREE_ENV || 'PRODUCTION').toUpperCase();
const CASHFREE_API_VERSION = process.env.CASHFREE_API_VERSION || '2023-08-01';
const CASHFREE_BASE_URL = CASHFREE_ENV === 'SANDBOX'
  ? 'https://sandbox.cashfree.com/pg'
  : 'https://api.cashfree.com/pg';

const TOKEN_PACKAGES = {
  8: 49,
  20: 99,
  48: 199,
  120: 399
};

function calculateTokenPrice(tokens) {
  const count = parseInt(tokens, 10);
  if (isNaN(count) || count <= 0) return 0;
  if (TOKEN_PACKAGES[count]) return TOKEN_PACKAGES[count];
  if (count <= 8) return Math.max(10, Math.round(count * 6.125));
  if (count <= 20) return Math.round(49 + ((count - 8) * 4.167));
  if (count <= 48) return Math.round(99 + ((count - 20) * 3.571));
  if (count <= 120) return Math.round(199 + ((count - 48) * 2.778));
  return Math.round(count * 3.325);
}

function makeHttpsRequest(urlStr, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed });
        } catch (_) {
          resolve({ status: res.statusCode, data: null });
        }
      });
    });

    req.on('error', reject);
    if (postData) {
      if (typeof postData === 'object' && !(postData instanceof Buffer)) {
        req.write(JSON.stringify(postData));
      } else {
        req.write(postData);
      }
    }
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
  }

  try {
    const { email, tokens, phone } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const tokenCount = parseInt(tokens, 10);
    const cleanPhone = (phone && String(phone).replace(/\D/g, '').length >= 10)
      ? String(phone).replace(/\D/g, '').slice(-10)
      : '9999999999';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      return res.status(400).json({ status: 'error', message: 'A valid email is required.' });
    }

    if (isNaN(tokenCount) || tokenCount <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid token package.' });
    }

    const expectedAmount = calculateTokenPrice(tokenCount);
    if (expectedAmount <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid amount.' });
    }

    const orderId = `cf_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const rawOrigin = req.headers.origin || '';
    const safeOrigin = (rawOrigin && rawOrigin.startsWith('https://'))
      ? rawOrigin
      : (process.env.APP_BASE_URL || 'https://karokemaker.online');
    const customerId = `cust_${crypto.createHash('md5').update(cleanEmail).digest('hex').substring(0, 16)}`;

    const body = {
      order_id: orderId,
      order_amount: expectedAmount,
      order_currency: 'INR',
      customer_details: {
        customer_id: customerId,
        customer_email: cleanEmail,
        customer_phone: cleanPhone
      },
      order_meta: {
        return_url: `${safeOrigin}/pricing?order_id={order_id}&status=check`,
        notify_url: `${safeOrigin}/api/payments/cashfree-webhook`
      },
      order_tags: {
        tokens: String(tokenCount),
        email: cleanEmail
      },
      order_note: `Recharge ${tokenCount} Tokens for ${cleanEmail}`
    };

    const headers = {
      'x-client-id': CASHFREE_APP_ID,
      'x-client-secret': CASHFREE_SECRET_KEY,
      'x-api-version': CASHFREE_API_VERSION,
      'Content-Type': 'application/json'
    };

    const cfRes = await makeHttpsRequest(`${CASHFREE_BASE_URL}/orders`, { method: 'POST', headers }, body);
    if (cfRes.status >= 200 && cfRes.status < 300 && cfRes.data?.payment_session_id) {
      return res.status(200).json({
        success: true,
        orderId: cfRes.data.order_id,
        paymentSessionId: cfRes.data.payment_session_id,
        amount: expectedAmount,
        tokens: tokenCount,
        environment: CASHFREE_ENV
      });
    }

    return res.status(cfRes.status || 500).json({
      status: 'error',
      message: cfRes.data?.message || 'Failed to create payment session with Cashfree.'
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}
