import https from 'https';

const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || '';
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || '';
const CASHFREE_ENV = (process.env.CASHFREE_ENV || 'PRODUCTION').toUpperCase();
const CASHFREE_API_VERSION = process.env.CASHFREE_API_VERSION || '2023-08-01';
const CASHFREE_BASE_URL = CASHFREE_ENV === 'SANDBOX'
  ? 'https://sandbox.cashfree.com/pg'
  : 'https://api.cashfree.com/pg';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://odvgmniswfpahwkqwtcw.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kdmdtbmlzd2ZwYWh3a3F3dGN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MzE4MTksImV4cCI6MjEwNzEwNzgxOX0.dl3gytRtsokArFxN_VH2nMABfAF35757ghOnm-dYESs';
const PAYMENT_SECRET_TOKEN = process.env.PAYMENT_SECRET_TOKEN || 'd74f260388d745a584065672ab684346e499a09945199651586a1df2775fec6f';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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
    const { orderId } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ status: 'error', message: 'Order ID is required.' });
    }

    const headers = {
      'x-client-id': CASHFREE_APP_ID,
      'x-client-secret': CASHFREE_SECRET_KEY,
      'x-api-version': CASHFREE_API_VERSION
    };

    const cfRes = await makeHttpsRequest(`${CASHFREE_BASE_URL}/orders/${encodeURIComponent(orderId)}`, { method: 'GET', headers });
    const cfOrder = cfRes.data || {};
    const status = cfOrder.order_status;
    const orderAmount = parseFloat(cfOrder.order_amount || 0);
    const tags = cfOrder.order_tags || {};
    const tokens = parseInt(tags.tokens || 0, 10) || 0;
    const email = (tags.email || cfOrder.customer_details?.customer_email || '').toLowerCase().trim();

    if (status === 'PAID') {
      const authKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
      const rpcBody = {
        p_secret_token: PAYMENT_SECRET_TOKEN,
        p_order_id: String(orderId),
        p_payment_id: String(cfOrder.cf_order_id || ''),
        p_email: email,
        p_tokens: tokens,
        p_amount: orderAmount,
        p_payment_method: 'cashfree_checkout',
        p_raw_payload: cfOrder
      };

      const supaRes = await makeHttpsRequest(
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

      const creditResult = supaRes.data || {};
      return res.status(200).json({
        success: true,
        status: 'PAID',
        credits: creditResult.credits,
        tokensAdded: tokens,
        alreadyCredited: creditResult.already_credited === true,
        message: `Payment confirmed! ${tokens} tokens added to ${email}.`
      });
    }

    return res.status(200).json({
      success: false,
      status: status || 'UNKNOWN',
      message: `Order status is ${status}. Payment not completed.`
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}
