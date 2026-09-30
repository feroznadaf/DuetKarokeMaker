import os
import sys
import json
import base64
import time
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

UNIVERSAL_MP4_ARGS = [
    "-c:v", "libx264", "-preset", "veryfast",
    "-profile:v", "high", "-level", "4.1",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-ar", "44100", "-ac", "2",
    "-movflags", "+faststart"
]

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

def clean_files(*paths):
    for p in paths:
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass

def decode_base64_payload(data_uri_or_raw):
    raw_b64 = data_uri_or_raw.split(",")[-1]
    return base64.b64decode(raw_b64)

def escape_ass_path(path):
    escaped = path.replace("\\", "/")
    if sys.platform == "win32":
        escaped = escaped.replace(":", r"\:")
    return escaped


class KaraokeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        if "directory" not in kwargs:
            kwargs["directory"] = PUBLIC_DIR
        super().__init__(*args, **kwargs)

    def send_json(self, status_code, payload):
        """Unified JSON response helper (DRY)."""
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status_code, message, details=None):
        payload = {"status": "error", "error": message, "message": message}
        if details:
            payload["details"] = details
        self.send_json(status_code, payload)

    def parse_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        body = self.rfile.read(length)
        return json.loads(body.decode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/status":
            return self.send_json(200, {
                "status": "ok",
                "ffmpegAvailable": check_ffmpeg(),
                "pythonVersion": sys.version,
                "platform": sys.platform
            })

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
                return self.send_error(404, "File not found or expired")

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        # --- Render with server FFmpeg ---
        if parsed.path == "/api/render-ffmpeg":
            if not check_ffmpeg():
                return self.send_error_json(400, "FFmpeg not found in system PATH")

            try:
                payload = self.parse_json_body()
                audio_b64 = payload.get("audioBase64", "")
                audio_ext = payload.get("audioExt", "mp3")
                ass_content = payload.get("assContent", "")
                server_audio_file = payload.get("serverAudioFile", "")

                if (not audio_b64 and not server_audio_file) or not ass_content:
                    return self.send_error_json(400, "Missing audio data or ASS subtitle content.")

                job_id = f"karaoke_{int(time.time() * 1000)}"
                audio_path = ""
                ass_path = os.path.join(TEMP_DIR, f"{job_id}.ass")
                output_path = os.path.join(TEMP_DIR, f"{job_id}.mp4")
                files_to_clean = [ass_path]

                if server_audio_file:
                    fname = os.path.basename(server_audio_file)
                    existing_path = os.path.join(TEMP_DIR, fname)
                    if os.path.exists(existing_path):
                        audio_path = existing_path

                if not audio_path and audio_b64:
                    audio_path = os.path.join(TEMP_DIR, f"{job_id}.{audio_ext}")
                    with open(audio_path, "wb") as f:
                        f.write(decode_base64_payload(audio_b64))
                    files_to_clean.append(audio_path)

                if not audio_path or not os.path.exists(audio_path):
                    return self.send_error_json(400, "Audio file not found or could not be loaded.")

                with open(ass_path, "w", encoding="utf-8") as f:
                    f.write(ass_content)

                ass_escaped = escape_ass_path(ass_path)
                cmd = [
                    get_ffmpeg_path() or "ffmpeg", "-y",
                    "-f", "lavfi", "-i", "color=c=black:s=1920x1080:r=30",
                    "-i", audio_path,
                    "-vf", f"ass='{ass_escaped}'",
                    "-shortest",
                    *UNIVERSAL_MP4_ARGS,
                    output_path
                ]

                proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                clean_files(*files_to_clean)

                if proc.returncode == 0 and os.path.exists(output_path):
                    return self.send_json(200, {
                        "success": True,
                        "jobId": job_id,
                        "downloadUrl": f"/api/download/{job_id}.mp4"
                    })
                else:
                    return self.send_error_json(
                        500,
                        "FFmpeg render failed",
                        proc.stderr.decode("utf-8", errors="replace")[-400:]
                    )
            except Exception as err:
                return self.send_error_json(500, str(err))

        # --- Convert recorded canvas video to universal H.264 MP4 ---
        if parsed.path == "/api/convert-recording":
            if not check_ffmpeg():
                return self.send_error_json(400, "FFmpeg not found in system PATH")

            try:
                payload = self.parse_json_body()
                video_b64 = payload.get("videoBase64", "")
                mime_type = payload.get("mimeType", "video/webm")
                input_ext = "mp4" if "mp4" in mime_type else "webm"

                job_id = f"recorded_{int(time.time() * 1000)}"
                input_path = os.path.join(TEMP_DIR, f"{job_id}_raw.{input_ext}")
                output_path = os.path.join(TEMP_DIR, f"{job_id}.mp4")

                with open(input_path, "wb") as f:
                    f.write(decode_base64_payload(video_b64))

                cmd = [
                    get_ffmpeg_path() or "ffmpeg", "-y",
                    "-i", input_path,
                    *UNIVERSAL_MP4_ARGS,
                    output_path
                ]

                proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                clean_files(input_path)

                if proc.returncode == 0 and os.path.exists(output_path):
                    return self.send_json(200, {
                        "success": True,
                        "jobId": job_id,
                        "downloadUrl": f"/api/download/{job_id}.mp4"
                    })
                else:
                    return self.send_error_json(
                        500,
                        "FFmpeg conversion failed",
                        proc.stderr.decode("utf-8", errors="replace")[-400:]
                    )
            except Exception as err:
                return self.send_error_json(500, str(err))

        # --- API: Unified Auto-Pilot Duet (Local Audio File or YouTube URL) ---
        if parsed.path in ("/api/auto-duet", "/api/youtube-duet"):
            try:
                payload = self.parse_json_body()
                url = (payload.get("url") or "").strip()
                api_key = (payload.get("apiKey") or "").strip()
                audio_b64 = payload.get("audioBase64") or ""
                audio_ext = re.sub(r'[^a-zA-Z0-9]', '', payload.get("audioExt") or "mp3")
                title = (payload.get("title") or "Duet Song").strip()

                script_path = os.path.join(BASE_DIR, "youtube_duet.py")
                cmd = [sys.executable, script_path]

                if url:
                    cmd.extend(["--url", url])
                elif audio_b64:
                    job_id = f"duet_upload_{int(time.time() * 1000)}"
                    audio_path = os.path.join(TEMP_DIR, f"{job_id}.{audio_ext}")
                    with open(audio_path, "wb") as f:
                        f.write(decode_base64_payload(audio_b64))
                    cmd.extend(["--audio-file", audio_path, "--title", title])
                else:
                    return self.send_error_json(400, "Either a YouTube URL or an audio file is required.")

                if api_key:
                    cmd.extend(["--api-key", api_key])

                proc = subprocess.run(cmd, capture_output=True, text=True)
                stdout = proc.stdout.strip()
                json_idx = stdout.rfind('{"status":')
                if json_idx != -1:
                    stdout = stdout[json_idx:]

                parsed_data = json.loads(stdout)
                return self.send_json(200, parsed_data)
            except Exception as err:
                return self.send_error_json(500, str(err))

        self.send_error(404, "Unknown endpoint")


# Top-level exports for WSGI / Vercel Serverless
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
