import os
import sys
import json
import base64
import tempfile
import subprocess
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

PORT = int(os.environ.get("PORT", 3000))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
TEMP_DIR = os.path.join(tempfile.gettempdir(), "duet-karaoke")
os.makedirs(TEMP_DIR, exist_ok=True)

_ffmpeg_cached = None

def get_ffmpeg_path():
    global _ffmpeg_cached
    if _ffmpeg_cached and os.path.exists(_ffmpeg_cached):
        return _ffmpeg_cached

    try:
        cmd = "where ffmpeg" if sys.platform == "win32" else "which ffmpeg"
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if res.returncode == 0 and res.stdout.strip():
            _ffmpeg_cached = res.stdout.strip().splitlines()[0].strip()
            return _ffmpeg_cached
    except Exception:
        pass

    if sys.platform == "win32":
        local_app = os.environ.get("LOCALAPPDATA", "")
        winget_pkg = os.path.join(local_app, "Microsoft", "WinGet", "Packages")
        if os.path.isdir(winget_pkg):
            for d in os.listdir(winget_pkg):
                if "ffmpeg" in d.lower():
                    pkg_path = os.path.join(winget_pkg, d)
                    try:
                        for sd in os.listdir(pkg_path):
                            candidate = os.path.join(pkg_path, sd, "bin", "ffmpeg.exe")
                            if os.path.isfile(candidate):
                                _ffmpeg_cached = candidate
                                return _ffmpeg_cached
                    except Exception:
                        pass
    return None

def check_ffmpeg():
    return get_ffmpeg_path() is not None

class KaraokeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        if "directory" not in kwargs:
            kwargs["directory"] = PUBLIC_DIR
        super().__init__(*args, **kwargs)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            data = {
                "status": "ok",
                "ffmpegAvailable": check_ffmpeg(),
                "pythonVersion": sys.version,
                "platform": sys.platform
            }
            self.wfile.write(json.dumps(data).encode("utf-8"))
            return

        if parsed.path.startswith("/api/download/"):
            filename = os.path.basename(parsed.path.replace("/api/download/", ""))
            file_path = os.path.join(TEMP_DIR, filename)
            if os.path.exists(file_path):
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.end_headers()
                with open(file_path, "rb") as f:
                    self.wfile.write(f.read())
                return
            else:
                self.send_error(404, "File not found or expired")
                return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/render-ffmpeg":
            if not check_ffmpeg():
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "FFmpeg not found in system PATH"}).encode("utf-8"))
                return

            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                payload = json.loads(body.decode("utf-8"))

                audio_b64 = payload.get("audioBase64", "")
                audio_ext = payload.get("audioExt", "mp3")
                ass_content = payload.get("assContent", "")

                job_id = f"karaoke_{int(tempfile._time.time() * 1000)}"
                audio_path = os.path.join(TEMP_DIR, f"{job_id}.{audio_ext}")
                ass_path = os.path.join(TEMP_DIR, f"{job_id}.ass")
                output_path = os.path.join(TEMP_DIR, f"{job_id}.mp4")

                raw_b64 = audio_b64.split(",")[-1]
                with open(audio_path, "wb") as f:
                    f.write(base64.b64decode(raw_b64))

                with open(ass_path, "w", encoding="utf-8") as f:
                    f.write(ass_content)

                ass_path_escaped = ass_path.replace("\\", "/")
                if sys.platform == "win32":
                    ass_path_escaped = ass_path_escaped.replace(":", r"\:")

                cmd = [
                    get_ffmpeg_path() or "ffmpeg", "-y",
                    "-f", "lavfi", "-i", "color=c=black:s=1920x1080:r=30",
                    "-i", audio_path,
                    "-vf", f"ass='{ass_path_escaped}'",
                    "-shortest",
                    "-c:v", "libx264", "-preset", "veryfast",
                    "-profile:v", "high", "-level", "4.1",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "192k",
                    "-ar", "44100", "-ac", "2",
                    "-movflags", "+faststart",
                    output_path
                ]

                proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                
                try: os.remove(audio_path)
                except Exception: pass
                try: os.remove(ass_path)
                except Exception: pass

                if proc.returncode == 0 and os.path.exists(output_path):
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "success": True,
                        "downloadUrl": f"/api/download/{job_id}.mp4"
                    }).encode("utf-8"))
                else:
                    self.send_response(500)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "error": "FFmpeg render failed",
                        "details": proc.stderr.decode("utf-8", errors="replace")[-400:]
                    }).encode("utf-8"))
            except Exception as err:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(err)}).encode("utf-8"))
            return

        if parsed.path == "/api/convert-recording":
            if not check_ffmpeg():
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "FFmpeg not found in system PATH"}).encode("utf-8"))
                return

            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                payload = json.loads(body.decode("utf-8"))

                video_b64 = payload.get("videoBase64", "")
                mime_type = payload.get("mimeType", "video/webm")
                input_ext = "mp4" if "mp4" in mime_type else "webm"

                job_id = f"recorded_{int(tempfile._time.time() * 1000)}"
                input_path = os.path.join(TEMP_DIR, f"{job_id}_raw.{input_ext}")
                output_path = os.path.join(TEMP_DIR, f"{job_id}.mp4")

                raw_b64 = video_b64.split(",")[-1]
                with open(input_path, "wb") as f:
                    f.write(base64.b64decode(raw_b64))

                cmd = [
                    get_ffmpeg_path() or "ffmpeg", "-y",
                    "-i", input_path,
                    "-c:v", "libx264", "-preset", "veryfast",
                    "-profile:v", "high", "-level", "4.1",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "192k",
                    "-ar", "44100", "-ac", "2",
                    "-movflags", "+faststart",
                    output_path
                ]

                proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                try: os.remove(input_path)
                except Exception: pass

                if proc.returncode == 0 and os.path.exists(output_path):
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "success": True,
                        "downloadUrl": f"/api/download/{job_id}.mp4"
                    }).encode("utf-8"))
                else:
                    self.send_response(500)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "error": "FFmpeg conversion failed",
                        "details": proc.stderr.decode("utf-8", errors="replace")[-400:]
                    }).encode("utf-8"))
            except Exception as err:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(err)}).encode("utf-8"))
            return

        self.send_error(404, "Unknown endpoint")

# =======================================================
# Top-level exports for Vercel / WSGI / Serverless runtime
# =======================================================
handler = KaraokeHandler
app = KaraokeHandler
application = KaraokeHandler

if __name__ == "__main__":
    server_address = ("127.0.0.1", PORT)
    httpd = HTTPServer(server_address, KaraokeHandler)
    print(f"====================================================")
    print(f"   🎤 Duet Karaoke Maker (Python Lite Server)       ")
    print(f"====================================================")
    print(f"[*] Server running at: http://localhost:{PORT}")
    print(f"[*] RAM footprint: ~20MB (Standard library only)")
    httpd.serve_forever()
