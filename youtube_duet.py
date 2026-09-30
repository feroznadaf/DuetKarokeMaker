#!/usr/bin/env python3
"""
YouTube & Local Audio Duet Karaoke Generator Backend
Extracts audio from YouTube or local audio file and uses intelligent
music intelligence (Gemini Flash AI, LRCLIB Synced/Plain Lyrics, Video Description
Metadata, and FFmpeg Vocal Activity Detection) to detect language, classify
Male [1] vs Female [2] vs Duet [3] voices, and generate synchronized timestamps
in one unified, zero-friction workflow.
"""

import sys
import os
import re
import json
import argparse
import tempfile
import time
import subprocess
import urllib.request
import urllib.parse

# Pre-compiled module-level Regular Expressions (DRY & High Performance)
RE_BRACKET_TAGS = re.compile(r'[\(\[\{].*?[\)\]\}]')
RE_TITLE_NOISE = re.compile(r'\b(official|music|video|audio|lyric|lyrics|hd|4k|remastered|ft|feat|prod|song|songs|full|track)\b', re.IGNORECASE)
RE_LRC = re.compile(r'\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\](.*)')
RE_SINGER_PREFIX = re.compile(r'^\s*(?:male|female|both|singer \d|s1|s2|chorus)\s*:\s*', re.IGNORECASE)
RE_TAG_PREFIX = re.compile(r'^\[[123]\]')
RE_TIMESTAMP_HINT = re.compile(r'\[\d{1,2}:\d{2}')

COMMON_LANGUAGES = [
    "Kannada", "Hindi", "Telugu", "Tamil", "Malayalam", "Bengali", "Marathi",
    "Punjabi", "Gujarati", "Bhojpuri", "Odia", "Urdu", "Assamese",
    "English", "Spanish", "Korean", "Japanese", "French", "German",
    "Italian", "Portuguese", "Russian", "Arabic", "Chinese", "Indonesian"
]

def parse_args():
    parser = argparse.ArgumentParser(description="Duet Karaoke Audio & Lyrics Extractor")
    parser.add_argument("--url", default="", help="YouTube video URL")
    parser.add_argument("--audio-file", default="", help="Local audio file path")
    parser.add_argument("--title", default="", help="Song title (optional)")
    parser.add_argument("--api-key", default="", help="Gemini API Key")
    return parser.parse_args()

def get_temp_dir():
    temp_dir = os.path.join(tempfile.gettempdir(), "duet-karaoke")
    os.makedirs(temp_dir, exist_ok=True)
    return temp_dir

def format_timestamp(seconds: float) -> str:
    """Formats float seconds into MM:SS.ss (DRY module-level utility)."""
    m = int(seconds // 60)
    sec = seconds % 60
    return f"{m:02d}:{sec:05.2f}"

def get_ffprobe_path():
    """Locates ffprobe binary from PATH or Windows WinGet package."""
    try:
        cmd = "where ffprobe" if sys.platform == "win32" else "which ffprobe"
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip().splitlines()[0].strip()
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
                            candidate = os.path.join(pkg_path, sd, "bin", "ffprobe.exe")
                            if os.path.isfile(candidate):
                                return candidate
                    except Exception:
                        pass
    return "ffprobe"

def get_ffmpeg_path():
    """Locates ffmpeg binary from PATH or Windows WinGet package."""
    try:
        cmd = "where ffmpeg" if sys.platform == "win32" else "which ffmpeg"
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip().splitlines()[0].strip()
    except Exception:
        pass

    ffprobe = get_ffprobe_path()
    if ffprobe != "ffprobe":
        candidate = os.path.join(os.path.dirname(ffprobe), "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
        if os.path.isfile(candidate):
            return candidate
    return "ffmpeg"

def get_audio_duration(file_path: str) -> float:
    """Determines audio duration using ffprobe with safe fallback."""
    ffprobe_bin = get_ffprobe_path()
    try:
        cmd = [
            ffprobe_bin, "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            file_path
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0 and res.stdout.strip():
            return float(res.stdout.strip())
    except Exception:
        pass
    return 180.0

def get_search_candidates(title: str, description: str = "") -> list:
    """Generates intelligent prioritized search queries from video title and description."""
    candidates = []

    # 1. Primary part before separators: |, -, :, /
    first_part = re.split(r'[\|\:\/\-]', title)[0]
    first_part_clean = RE_BRACKET_TAGS.sub('', first_part)
    first_part_clean = RE_TITLE_NOISE.sub('', first_part_clean)
    clean_primary = ' '.join(first_part_clean.split()).strip()
    if clean_primary:
        candidates.append(clean_primary)

    # 2. Primary part + movie or second term if available
    parts = [p.strip() for p in re.split(r'[\|\:\/\-]', title) if p.strip()]
    if len(parts) >= 2 and clean_primary:
        part2 = RE_BRACKET_TAGS.sub('', parts[1])
        part2 = RE_TITLE_NOISE.sub('', part2).strip()
        if part2 and len(part2) < 25:
            candidates.append(f"{clean_primary} {part2}")

    # 3. Clean full title without brackets & noise
    whole_clean = RE_BRACKET_TAGS.sub('', title)
    whole_clean = RE_TITLE_NOISE.sub('', whole_clean)
    clean_whole = ' '.join(re.sub(r'[\|\:\/\-_]', ' ', whole_clean).split()).strip()
    if clean_whole and clean_whole not in candidates:
        words = clean_whole.split()
        if len(words) > 4:
            candidates.append(' '.join(words[:4]))
        candidates.append(clean_whole)

    # 4. Check for singer mentions in description
    if description and clean_primary:
        m_singer = re.search(r'(?:singer|singers|singer\'s)\s*[:\-]\s*([a-zA-Z\s,]+)', description, re.IGNORECASE)
        if m_singer:
            first_singer = m_singer.group(1).split(',')[0].strip()
            if first_singer and len(first_singer) < 30:
                candidates.append(f"{clean_primary} {first_singer}")

    # Preserve order and deduplicate
    return list(dict.fromkeys(c for c in candidates if c))

def detect_language(title: str, description: str = "", lyrics: str = "") -> str:
    """Detects song language from title tags, description, and lyrics script."""
    combined = f"{title} {description}".lower()

    for lang in COMMON_LANGUAGES:
        if re.search(r'\b' + re.escape(lang.lower()) + r'\b', combined):
            return lang

    if lyrics:
        if re.search(r'[\u0C80-\u0CFF]', lyrics): return "Kannada"
        if re.search(r'[\u0900-\u097F]', lyrics): return "Hindi"
        if re.search(r'[\u0C00-\u0C7F]', lyrics): return "Telugu"
        if re.search(r'[\u0B80-\u0BFF]', lyrics): return "Tamil"
        if re.search(r'[\u0D00-\u0D7F]', lyrics): return "Malayalam"
        if re.search(r'[\u0A80-\u0AFF]', lyrics): return "Gujarati"
        if re.search(r'[\u0A00-\u0A7F]', lyrics): return "Punjabi"
        if re.search(r'[\u0980-\u09FF]', lyrics): return "Bengali"
        if re.search(r'[\uAC00-\uD7AF]', lyrics): return "Korean"
        if re.search(r'[\u3040-\u30FF]', lyrics): return "Japanese"

    return "Duet Track"

def get_vocal_bounds_from_audio(audio_path: str, duration: float):
    """Detects vocal start and end timestamps using center-channel bandpass energy."""
    ffmpeg_bin = get_ffmpeg_path()
    cmd = [
        ffmpeg_bin, "-i", audio_path,
        "-af", "pan=mono|c0=0.5*c0+0.5*c1,bandpass=f=1200:width_type=h:w=2000,silencedetect=noise=-22dB:d=0.4",
        "-f", "null", "-"
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
        silences = []
        cur_start = None
        for line in res.stderr.splitlines():
            if 'silence_start:' in line:
                m = re.search(r'silence_start:\s*([\d\.]+)', line)
                if m: cur_start = float(m.group(1))
            elif 'silence_end:' in line:
                m = re.search(r'silence_end:\s*([\d\.]+)', line)
                if m and cur_start is not None:
                    silences.append((cur_start, float(m.group(1))))
                    cur_start = None

        first_vocal = 10.0
        last_vocal = max(duration - 6.0, 15.0)

        if silences and silences[0][0] < 1.0:
            first_vocal = silences[0][1]

        if silences and silences[-1][1] >= duration - 3.0:
            last_vocal = silences[-1][0]

        return max(2.5, min(first_vocal, duration * 0.25)), min(duration - 0.8, max(last_vocal, duration * 0.75))
    except Exception:
        return 8.0, max(12.0, duration - 6.0)

def align_plain_lyrics_to_audio(lyrics_text: str, duration: float, vocal_start: float = 10.0, vocal_end: float = None) -> str:
    """Intelligently aligns plain lyric lines to audio duration with vocal-role classification."""
    if vocal_end is None or vocal_end > duration:
        vocal_end = max(duration - 5.0, vocal_start + 10.0)

    raw_lines = [l.strip() for l in lyrics_text.splitlines() if l.strip()]
    if not raw_lines:
        return ""

    clean_lines = []
    weights = []
    singer_override = []

    for line in raw_lines:
        # Detect section markers
        low = line.lower()
        if (line.startswith('[') and line.endswith(']')) or (line.startswith('(') and line.endswith(')')):
            if any(k in low for k in ('verse', 'chorus', 'intro', 'outro', 'bridge', 'music')):
                continue

        # Detect explicit singer tags in text
        forced_singer = None
        if 'female' in low or 'girl' in low or 'singer 2' in low:
            forced_singer = 2
        elif 'male' in low or 'boy' in low or 'singer 1' in low:
            forced_singer = 1
        elif any(k in low for k in ('both', 'together', 'duet', 'chorus', 'all')):
            forced_singer = 3

        clean_text = RE_SINGER_PREFIX.sub('', line).strip()
        if not clean_text:
            continue

        clean_lines.append(clean_text)
        w = max(2.5, len(clean_text.split()) * 0.65 + len(clean_text) * 0.07)
        weights.append(w)
        singer_override.append(forced_singer)

    if not clean_lines:
        return ""

    total_weight = sum(weights)
    gap_duration = 0.35
    total_gaps = max(0, len(clean_lines) - 1) * gap_duration
    available_span = max(10.0, (vocal_end - vocal_start) - total_gaps)

    output = []
    cur_time = vocal_start
    seen_lines = {}

    for i, (line, w, forced_tag) in enumerate(zip(clean_lines, weights, singer_override)):
        line_dur = max(2.2, (w / total_weight) * available_span)
        start = cur_time
        end = min(duration - 0.4, start + line_dur)
        cur_time = end + gap_duration

        low = line.lower()
        seen_count = seen_lines.get(low, 0)
        seen_lines[low] = seen_count + 1

        if forced_tag:
            tag = forced_tag
        elif seen_count >= 2:
            tag = 3  # Recurring refrain sung together
        elif i % 4 in (0, 1):
            tag = 1  # Male turn (stanzas of 2 lines)
        else:
            tag = 2  # Female turn (stanzas of 2 lines)

        output.append(f"[{tag}] [{format_timestamp(start)} - {format_timestamp(end)}] {line}")

    return "\n".join(output)

def lrc_to_duet_format(lrc_text: str, duration: float) -> str:
    """Converts LRC format [MM:SS.xx] lyrics into Duet Karaoke format [Singer] [Start - End] text."""
    parsed_cues = []
    for raw in lrc_text.splitlines():
        m = RE_LRC.match(raw.strip())
        if m:
            time_str, lyric = m.groups()
            lyric = lyric.strip()
            if lyric:
                parts = time_str.split(':')
                secs = float(parts[0]) * 60 + float(parts[1])
                parsed_cues.append((secs, lyric))

    if not parsed_cues:
        return ""

    lines = []
    singer_turn = 1
    seen_lines = {}

    for i, (curr_start, text) in enumerate(parsed_cues):
        if i + 1 < len(parsed_cues):
            next_start = parsed_cues[i + 1][0]
            curr_end = min(curr_start + 6.5, max(curr_start + 1.8, next_start - 0.25))
        else:
            curr_end = min(duration - 0.5, curr_start + 4.5)

        low = text.lower()
        seen_count = seen_lines.get(low, 0)
        seen_lines[low] = seen_count + 1

        if 'female' in low or 'girl' in low:
            tag = 2
        elif 'male' in low or 'boy' in low:
            tag = 1
        elif any(k in low for k in ('both', 'all', 'together', 'chorus')) or seen_count >= 2:
            tag = 3
        else:
            tag = 1 if (i // 2) % 2 == 0 else 2

        clean_text = RE_SINGER_PREFIX.sub('', text)
        lines.append(f"[{tag}] [{format_timestamp(curr_start)} - {format_timestamp(curr_end)}] {clean_text}")

    return "\n".join(lines)

def fetch_lrclib_lyrics(title: str, description: str, duration: float, audio_path: str):
    """Searches LRCLIB using multi-candidate queries; supports both synced and plain lyrics."""
    candidates = get_search_candidates(title, description)

    for query_str in candidates:
        try:
            query = urllib.parse.urlencode({'q': query_str})
            req = urllib.request.Request(
                f"https://lrclib.net/api/search?{query}",
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DuetKaraokeMaker/2.0'}
            )
            with urllib.request.urlopen(req, timeout=6) as response:
                data = json.loads(response.read().decode('utf-8'))
                if isinstance(data, list) and data:
                    # 1. Prefer synced lyrics if available
                    for entry in data:
                        synced = entry.get('syncedLyrics')
                        if synced:
                            duet = lrc_to_duet_format(synced, duration)
                            if duet:
                                return entry.get('trackName', query_str), duet, True

                    # 2. Fall back to plainLyrics if synced isn't present
                    for entry in data:
                        plain = entry.get('plainLyrics')
                        if plain:
                            v_start, v_end = get_vocal_bounds_from_audio(audio_path, duration)
                            duet = align_plain_lyrics_to_audio(plain, duration, v_start, v_end)
                            if duet:
                                return entry.get('trackName', query_str), duet, False
        except Exception:
            continue

    return None, None, False

def extract_lyrics_from_description(description: str, duration: float, audio_path: str):
    """Extracts lyrics if the video description contains a lyrics section."""
    if not description:
        return None

    # Common markers where lyrics begin in YouTube descriptions
    m = re.search(r'(?:lyrics|lyric)\s*[:\-]\s*(.*?)(?:music|audio|singer|produced|directed|enjoy|subscribe|follow|$)', description, re.DOTALL | re.IGNORECASE)
    if m:
        block = m.group(1).strip()
        lines = [l.strip() for l in block.splitlines() if len(l.strip()) > 3 and not l.strip().startswith('http')]
        if len(lines) >= 6:
            v_start, v_end = get_vocal_bounds_from_audio(audio_path, duration)
            return align_plain_lyrics_to_audio("\n".join(lines), duration, v_start, v_end)
    return None

def generate_melodic_karaoke_cues(title: str, duration: float, audio_path: str):
    """Generates continuous rhythmic karaoke cue intervals across the song's vocal structure."""
    v_start, v_end = get_vocal_bounds_from_audio(audio_path, duration)
    cues = []
    cur = v_start
    idx = 0
    clean_name = re.split(r'[\|\:\/\-]', title)[0].strip()

    while cur + 4.0 <= v_end:
        step_dur = 4.8 if idx % 3 != 2 else 6.2
        end = min(v_end, cur + step_dur)
        tag = 1 if (idx % 4 in (0, 1)) else 2
        if idx % 6 == 5:
            tag = 3

        if idx == 0:
            txt = f"♪ {clean_name} (Male Lead Opening)"
        elif tag == 1:
            txt = f"♪ [Male Verse] {clean_name} - Melody Section {idx+1}"
        elif tag == 2:
            txt = f"♪ [Female Vocal Response] Melody Section {idx+1}"
        else:
            txt = f"♪ [Duet Chorus Together] Harmonies Section {idx+1}"

        cues.append(f"[{tag}] [{format_timestamp(cur)} - {format_timestamp(end)}] {txt}")
        cur = end + 0.45
        idx += 1

    return "\n".join(cues)

def download_youtube_audio(url, temp_dir):
    """Downloads audio cleanly using yt_dlp without triggering subtitle rate-limits."""
    import yt_dlp

    timestamp = int(time.time())
    output_template = os.path.join(temp_dir, f"duet_yt_{timestamp}")

    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': output_template,
        'extractor_args': {
            'youtube': {
                'player_client': ['ios', 'android', 'web']
            }
        },
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'quiet': True,
        'noprogress': True,
        'no_warnings': True,
        'noplaylist': True,
        'ignoreerrors': False,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title = info.get('title', 'YouTube Song')
        duration = info.get('duration', 0)
        description = info.get('description', '')

    final_mp3 = f"{output_template}.mp3"
    if not os.path.exists(final_mp3):
        for f in os.listdir(temp_dir):
            if f.startswith(f"duet_yt_{timestamp}") and f.endswith(".mp3"):
                final_mp3 = os.path.join(temp_dir, f)
                break

    if not os.path.exists(final_mp3):
        raise FileNotFoundError(f"Failed to extract audio MP3 from YouTube URL: {url}")

    return final_mp3, title, duration, description

def transcribe_with_gemini(audio_path, api_key):
    """Uses Gemini to detect singing language, transcribe lyrics, and classify Male vs Female voice."""
    from google import genai

    client = genai.Client(api_key=api_key)
    uploaded_file = client.files.upload(file=audio_path)

    for _ in range(40):
        file_info = client.files.get(name=uploaded_file.name)
        if file_info.state.name == "ACTIVE":
            break
        elif file_info.state.name == "FAILED":
            raise RuntimeError("Gemini audio file processing failed.")
        time.sleep(1)

    prompt = """You are an expert music and duet karaoke transcriber.
Analyze this audio track and produce a synchronized duet karaoke lyric script with vocal role tags.

INSTRUCTIONS:
1. DETECT THE LANGUAGE: Identify the primary singing language of the track (e.g., Kannada, Hindi, English, Spanish, Korean, Tamil, Telugu, Punjabi, Japanese, etc.).
2. TRANSCRIBE VERBATIM LYRICS: Transcribe every line that is sung with precise start and end timestamps in format [MM:SS.SS - MM:SS.SS].
3. VOCAL TIMBRE CLASSIFICATION (DUET TAGGING):
   - Listen carefully to each line's vocal timbre, pitch range, and vocal characteristics:
     - Mark [1] for Male singer (Baritone / Tenor / Singer 1)
     - Mark [2] for Female singer (Soprano / Alto / Singer 2)
     - Mark [3] for Duet / Unison (when both singers sing together in harmony or chorus)
     - If the song is a solo or multiple singers of the same gender, assign the lead to [1] and secondary/chorus to [2].
4. OUTPUT FORMAT:
   First line:
   LANGUAGE: <detected language>

   Followed by lines strictly in this format:
   [SingerTag] [StartTime - EndTime] Lyric line text

   Example:
   LANGUAGE: Hindi
   [1] [00:12.40 - 00:17.50] Tum hi ho ab tum hi ho
   [2] [00:18.00 - 00:23.20] Zindagi ab tum hi ho
   [3] [00:24.00 - 00:31.50] Chain bhi mera dard bhi

Do not include extra commentary, markdown headers, or disclaimers outside of the requested format."""

    response = None
    candidate_models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]
    last_err = None

    for model_name in candidate_models:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[uploaded_file, prompt]
            )
            if response and response.text:
                break
        except Exception as e:
            last_err = e
            continue

    try:
        client.files.delete(name=uploaded_file.name)
    except Exception:
        pass

    if not response or not response.text:
        raise RuntimeError(f"Gemini transcription failed across candidate models: {last_err}")

    raw_text = response.text or ""
    language = "Detected Duet Song"
    lyrics_lines = []

    for line in raw_text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.upper().startswith("LANGUAGE:"):
            language = line.split(":", 1)[1].strip()
            continue
        if RE_TIMESTAMP_HINT.search(line) or re.search(r'\[[123]\]', line):
            if not RE_TAG_PREFIX.match(line):
                line = f"[1] {line}"
            lyrics_lines.append(line)

    return language, "\n".join(lyrics_lines)

def main():
    args = parse_args()
    temp_dir = get_temp_dir()
    api_key = args.api_key or os.environ.get("GEMINI_API_KEY", "")

    try:
        description = ""
        if args.audio_file and os.path.exists(args.audio_file):
            audio_path = args.audio_file
            title = args.title or os.path.splitext(os.path.basename(audio_path))[0]
            duration = get_audio_duration(audio_path)
            filename = os.path.basename(audio_path)
        elif args.url:
            audio_path, title, duration, description = download_youtube_audio(args.url, temp_dir)
            filename = os.path.basename(audio_path)
        else:
            raise ValueError("Either --url or --audio-file must be provided.")

        lyrics = ""
        language = detect_language(title, description)

        # 1. If Gemini API Key provided, attempt AI diarization
        if api_key:
            try:
                ai_lang, ai_lyrics = transcribe_with_gemini(audio_path, api_key)
                if ai_lyrics:
                    language = ai_lang
                    lyrics = ai_lyrics
            except Exception as gemini_err:
                print(f"[Gemini API Warning: {gemini_err}, using automated lyrics pipeline]", file=sys.stderr)

        # 2. Automated lyrics & timestamp intelligence (LRCLIB Synced + Plain + Audio Bounds)
        if not lyrics:
            track_name, lrc_lyrics, is_synced = fetch_lrclib_lyrics(title, description, duration, audio_path)
            if lrc_lyrics:
                lyrics = lrc_lyrics
                if language == "Duet Track":
                    language = detect_language(track_name or title, description, lyrics)

        # 3. Check YouTube description for lyrics
        if not lyrics and description:
            desc_lyrics = extract_lyrics_from_description(description, duration, audio_path)
            if desc_lyrics:
                lyrics = desc_lyrics

        # 4. Fallback: generate musical karaoke melody bars across audio duration
        if not lyrics:
            lyrics = generate_melodic_karaoke_cues(title, duration, audio_path)

        result = {
            "status": "ok",
            "title": title,
            "filename": filename,
            "audioUrl": f"/api/download/{filename}",
            "language": language,
            "duration": duration,
            "lyrics": lyrics
        }
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
