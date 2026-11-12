import crypto from 'crypto';
import https from 'https';

const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || '9de27f4c519e1116b9dd80134fa7de216b91e6a9a0a3407776ef8b84173ae935';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gezplzqucotwwjlvnrkk.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlenBsenF1Y290d3dqbHZucmtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjc4MDEsImV4cCI6MjEwNTg0MzgwMX0.xS4YnlrDCR5SQrZ8VJfWHlHNZa_3fnSmPxoTaIRfpgQ';
const PAYMENT_SECRET_TOKEN = process.env.PAYMENT_SECRET_TOKEN || 'd74f260388d745a584065672ab684346e499a09945199651586a1df2775fec6f';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function verifyAdminSession(req) {
  let token = null;

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  if (!token && req.headers['x-admin-token']) {
    token = String(req.headers['x-admin-token']).trim();
  }

  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)duet_admin_session=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  try {
    const expectedSig = crypto.createHmac('sha256', ADMIN_SESSION_SECRET)
      .update(payload)
      .digest('base64url');

    if (signature.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) return null;

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch (_) {
    return null;
  }
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

  const session = verifyAdminSession(req);
  if (!session) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized: Admin access required' });
  }

  try {
    const body = req.body || {};
    const email = String(body.email || body.target_email || '').trim().toLowerCase();
    const mode = String(body.mode || 'set').toLowerCase();
    let amount = parseInt(body.amount ?? body.credits ?? body.new_credits ?? 0, 10);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ status: 'error', message: 'A valid email is required.' });
    }

    if (isNaN(amount)) {
      return res.status(400).json({ status: 'error', message: 'Invalid token amount.' });
    }

    amount = Math.abs(amount);
    const authKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

    // 1. Try server_admin_update_credits RPC
    const rpcUrl = `${SUPABASE_URL}/rest/v1/rpc/server_admin_update_credits`;
    const rpcRes = await makeHttpsRequest(
      rpcUrl,
      {
        method: 'POST',
        headers: {
          'apikey': authKey,
          'Authorization': `Bearer ${authKey}`,
          'Content-Type': 'application/json'
        }
      },
      {
        p_secret_token: PAYMENT_SECRET_TOKEN,
        p_target_email: email,
        p_amount: amount,
        p_mode: mode
      }
    );

    if (rpcRes.status >= 200 && rpcRes.status < 300 && rpcRes.data?.success) {
      return res.status(200).json({
        success: true,
        email,
        credits: rpcRes.data.credits,
        previousCredits: rpcRes.data.previous_credits,
        mode,
        amount,
        message: `Successfully updated tokens for ${email}. New balance: ${rpcRes.data.credits} tokens.`
      });
    }

    // 2. Direct profiles table fallback
    const fetchRes = await makeHttpsRequest(
      `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=*`,
      {
        method: 'GET',
        headers: { 'apikey': authKey, 'Authorization': `Bearer ${authKey}` }
      }
    );

    const profile = Array.isArray(fetchRes.data) && fetchRes.data[0];
    const curCredits = profile ? (profile.credits || 0) : 0;
    let newCredits = amount;

    if (mode === 'add') {
      newCredits = curCredits + amount;
    } else if (mode === 'remove') {
      newCredits = Math.max(0, curCredits - amount);
    } else {
      newCredits = Math.max(0, amount);
    }

    if (profile) {
      const patchRes = await makeHttpsRequest(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${profile.id}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': authKey,
            'Authorization': `Bearer ${authKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          }
        },
        { credits: newCredits, updated_at: new Date().toISOString() }
      );

      if (patchRes.status >= 200 && patchRes.status < 300) {
        return res.status(200).json({
          success: true,
          email,
          credits: newCredits,
          previousCredits: curCredits,
          mode,
          amount,
          message: `Successfully set ${newCredits} tokens for ${email}.`
        });
      }
    }

    return res.status(400).json({
      status: 'error',
      message: rpcRes.data?.error || 'Could not update tokens for user'
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}
