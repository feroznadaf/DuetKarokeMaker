export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
  }

  try {
    const { url, title } = req.body || {};
    let songTitle = title || 'Duet Song';

    if (url) {
      try {
        const oeRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
        if (oeRes.ok) {
          const oeData = await oeRes.json();
          songTitle = oeData.title || songTitle;
        }
      } catch (_) {}
    }

    return res.status(200).json({
      status: 'ok',
      title: songTitle,
      environment: 'vercel-serverless'
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}
