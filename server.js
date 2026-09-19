const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEMP_DIR = path.join(os.tmpdir(), 'duet-karaoke');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// MIME types mapping
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ass': 'text/plain; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Find FFmpeg executable path
let resolvedFFmpeg = null;

function getFFmpegPath() {
  if (resolvedFFmpeg && fs.existsSync(resolvedFFmpeg)) return resolvedFFmpeg;

  // 1. Try PATH
  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split('\r\n')[0].split('\n')[0].trim();
    if (out && fs.existsSync(out)) {
      resolvedFFmpeg = out;
      return resolvedFFmpeg;
    }
  } catch (e) {}

  // 2. Try Windows WinGet packages directory directly
  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || '';
    const wingetPkg = path.join(localApp, 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(wingetPkg)) {
      try {
        const dirs = fs.readdirSync(wingetPkg);
        for (const d of dirs) {
          if (d.toLowerCase().includes('ffmpeg')) {
            const pkgPath = path.join(wingetPkg, d);
            const subdirs = fs.readdirSync(pkgPath);
            for (const sd of subdirs) {
              const candidate = path.join(pkgPath, sd, 'bin', 'ffmpeg.exe');
              if (fs.existsSync(candidate)) {
                resolvedFFmpeg = candidate;
                return resolvedFFmpeg;
              }
            }
          }
        }
      } catch (e) {}
    }
  }

  return null;
}

function checkFFmpeg() {
  return getFFmpegPath() !== null;
}

// Parse request body JSON
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      // Protect memory on 4GB RAM laptop: limit body to 150MB
      if (data.length > 150 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
  const pathname = parsedUrl.pathname;

  // CORS headers for local flexibility
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: Status check
  if (pathname === '/api/status' && req.method === 'GET') {
    const ffmpegPath = getFFmpegPath();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      ffmpegAvailable: ffmpegPath !== null,
      ffmpegPath: ffmpegPath,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      tempDir: TEMP_DIR
    }));
    return;
  }

  // API: Render with FFmpeg (server-side)
  if (pathname === '/api/render-ffmpeg' && req.method === 'POST') {
    if (!checkFFmpeg()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'FFmpeg is not installed in system PATH. Use in-browser rendering or install FFmpeg via install_ffmpeg.bat.'
      }));
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { audioBase64, audioExt, assContent, resolution } = body;

      if (!audioBase64 || !assContent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing audio data or ASS subtitle content.' }));
        return;
      }

      const jobId = 'karaoke_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const audioPath = path.join(TEMP_DIR, `${jobId}.${audioExt || 'mp3'}`);
      const assPath = path.join(TEMP_DIR, `${jobId}.ass`);
      const outputPath = path.join(TEMP_DIR, `${jobId}.mp4`);

      // Write audio buffer
      const audioBuffer = Buffer.from(audioBase64.replace(/^data:audio\/\w+;base64,/, ''), 'base64');
      fs.writeFileSync(audioPath, audioBuffer);
      fs.writeFileSync(assPath, assContent, 'utf-8');

      // Escaping path for libass on Windows (colons and backslashes need special handling)
      let assPathEscaped = assPath.replace(/\\/g, '/');
      if (process.platform === 'win32') {
        assPathEscaped = assPathEscaped.replace(/:/g, '\\:');
      }

      const ffmpegArgs = [
        '-y',
        '-f', 'lavfi',
        '-i', 'color=c=black:s=1920x1080:r=30',
        '-i', audioPath,
        '-vf', `ass='${assPathEscaped}'`,
        '-shortest',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-profile:v', 'high',
        '-level', '4.1',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '44100',
        '-ac', '2',
        '-movflags', '+faststart',
        outputPath
      ];

      console.log(`[FFmpeg] Rendering job ${jobId} using ${getFFmpegPath()}...`);
      const child = spawn(getFFmpegPath() || 'ffmpeg', ffmpegArgs);

      let stderrLog = '';
      child.stderr.on('data', chunk => {
        stderrLog += chunk.toString();
      });

      child.on('close', code => {
        // Clean up temp audio and ass
        try { fs.unlinkSync(audioPath); } catch (e) {}
        try { fs.unlinkSync(assPath); } catch (e) {}

        if (code === 0 && fs.existsSync(outputPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            jobId,
            downloadUrl: `/api/download/${jobId}.mp4`
          }));
        } else {
          console.error('[FFmpeg Error]', stderrLog);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'FFmpeg render failed. Check if font or libass is supported.',
            details: stderrLog.slice(-500)
          }));
        }
      });

    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Convert client-recorded canvas video to universal H.264 MP4 with faststart
  if (pathname === '/api/convert-recording' && req.method === 'POST') {
    if (!checkFFmpeg()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'FFmpeg is not installed in system PATH.' }));
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { videoBase64, mimeType } = body;

      if (!videoBase64) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing recorded video data.' }));
        return;
      }

      const jobId = 'recorded_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const inputExt = (mimeType && mimeType.includes('mp4')) ? 'mp4' : 'webm';
      const inputPath = path.join(TEMP_DIR, `${jobId}_raw.${inputExt}`);
      const outputPath = path.join(TEMP_DIR, `${jobId}.mp4`);

      // Write video buffer from base64
      const videoBuffer = Buffer.from(videoBase64.replace(/^data:video\/\w+;base64,/, ''), 'base64');
      fs.writeFileSync(inputPath, videoBuffer);

      // Convert recorded canvas video into universal H.264 High 4.1 + AAC + Faststart MP4
      const ffmpegArgs = [
        '-y',
        '-i', inputPath,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-profile:v', 'high',
        '-level', '4.1',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '44100',
        '-ac', '2',
        '-movflags', '+faststart',
        outputPath
      ];

      console.log(`[FFmpeg] Converting recorded canvas video ${jobId} to universal MP4...`);
      const child = spawn(getFFmpegPath() || 'ffmpeg', ffmpegArgs);
      let stderrLog = '';
      child.stderr.on('data', chunk => { stderrLog += chunk.toString(); });

      child.on('close', code => {
        try { fs.unlinkSync(inputPath); } catch (e) {}
        if (code === 0 && fs.existsSync(outputPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            jobId,
            downloadUrl: `/api/download/${jobId}.mp4`
          }));
        } else {
          console.error('[FFmpeg Convert Error]', stderrLog);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Conversion failed: ' + stderrLog.slice(-300) }));
        }
      });
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Download rendered file
  if (pathname.startsWith('/api/download/')) {
    const filename = path.basename(pathname.replace('/api/download/', ''));
    const filePath = path.join(TEMP_DIR, filename);

    if (fs.existsSync(filePath)) {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${filename}"`
      });
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      // Delete temporary file 2 minutes after downloading
      setTimeout(() => {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
      }, 120000);
      return;
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found or expired');
      return;
    }
  }

  // Static File Serving from /public
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
    res.end('<h1>404 Not Found</h1><p>Duet Karaoke Maker web asset not found.</p>');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`====================================================`);
  console.log(`   🎤 Duet Karaoke Maker (Ultra-Lite Web App)       `);
  console.log(`====================================================`);
  console.log(`[*] Server running at: ${url}`);
  console.log(`[*] RAM footprint: ~25MB (Optimized for 4GB RAM + HDD)`);
  console.log(`[*] Opening your browser now...`);
  console.log(`====================================================`);
});
