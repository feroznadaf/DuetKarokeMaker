import crypto from 'crypto';
import https from 'https';

const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://odvgmniswfpahwkqwtcw.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kdmdtbmlzd2ZwYWh3a3F3dGN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MzE4MTksImV4cCI6MjEwNzEwNzgxOX0.dl3gytRtsokArFxN_VH2nMABfAF35757ghOnm-dYESs';
const PAYMENT_SECRET_TOKEN = process.env.PAYMENT_SECRET_TOKEN || 'd74f260388d745a584065672ab684346e499a09945199651586a1df2775fec6f';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const NODE_ENV = process.env.NODE_ENV || 'production';

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
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
  }

  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    if (CASHFREE_SECRET_KEY && signature && timestamp) {
      try {
        const expected = crypto.createHmac('sha256', CASHFREE_SECRET_KEY).update(timestamp + rawBody).digest('base64');
        const isValid = crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
        if (!isValid && NODE_ENV === 'production') {
          return res.status(401).json({ status: 'error', message: 'Invalid webhook signature' });
        }
      } catch (sigErr) {
        if (NODE_ENV === 'production') {
          return res.status(401).json({ status: 'error', message: 'Signature verification failed' });
        }
      }
    }

    const payload = typeof req.body === 'object' ? req.body : JSON.parse(rawBody || '{}');
    const eventType = payload.type || payload.event;

    if (eventType === 'PAYMENT_SUCCESS_WEBHOOK' || eventType === 'PAYMENT_SUCCESS') {
      const orderData = payload.data?.order || {};
      const paymentData = payload.data?.payment || {};
      const customerData = payload.data?.customer_details || {};

      const orderId = orderData.order_id;
      const cfPaymentId = paymentData.cf_payment_id;
      const amount = parseFloat(paymentData.payment_amount || orderData.order_amount || 0);
      const tags = orderData.order_tags || {};
      const tokens = parseInt(tags.tokens, 10);
      const email = (tags.email || customerData.customer_email || '').toLowerCase().trim();
      const paymentMethod = paymentData.payment_group || 'cashfree';

      if (orderId && email && tokens > 0) {
        const authKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
        const rpcBody = {
          p_secret_token: PAYMENT_SECRET_TOKEN,
          p_order_id: String(orderId),
          p_payment_id: String(cfPaymentId || ''),
          p_email: email,
          p_tokens: tokens,
          p_amount: amount,
          p_payment_method: paymentMethod,
          p_raw_payload: payload
        };

        await makeHttpsRequest(
          `${SUPABASE_URL}/rest/v1/rpc/credit_tokens_from_payment`,
          {
            method: 'POST',
            headers: {
              'apikey': authKey,
              'Authorization': `Bearer ${authKey}`,
              'Content-Type': 'application/json'
            }
          },
          rpcBody
        );
      }
    }

    return res.status(200).json({ status: 'ok', received: true });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}
