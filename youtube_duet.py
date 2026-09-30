#!/usr/bin/env python3
"""
YouTube Duet Karaoke Generator Backend
Extracts audio from YouTube and uses Gemini 3.8 Flash (or LRCLIB/Captions fallback)
to detect language, classify Male vs Female voices, and generate duet timestamps.
"""

import sys
import os
import re
import json
import argparse
import tempfile
import time
import urllib.request
import urllib.parse

def parse_args():
    parser = argparse.ArgumentParser(description="YouTube Duet Karaoke Extractor")
    parser.add_argument("--url", required=True, help="YouTube video URL")
    parser.add_argument("--api-key", default="", help="Gemini API Key")
    return parser.parse_args()

def get_temp_dir():
    temp_dir = os.path.join(tempfile.gettempdir(), "duet-karaoke")
    os.makedirs(temp_dir, exist_ok=True)
    return temp_dir

def download_youtube_audio(url, temp_dir):
    """Downloads audio from YouTube cleanly using yt_dlp without triggering subtitle rate-limits."""
    import yt_dlp

    timestamp = int(time.time())
    output_template = os.path.join(temp_dir, f"duet_yt_{timestamp}")

    # Pure audio extraction: do NOT request automatic subtitles here
    # to avoid YouTube's aggressive HTTP Error 429: Too Many Requests on timedtext.
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

    final_mp3 = f"{output_template}.mp3"
    if not os.path.exists(final_mp3):
        for f in os.listdir(temp_dir):
            if f.startswith(f"duet_yt_{timestamp}") and f.endswith(".mp3"):
                final_mp3 = os.path.join(temp_dir, f)
                break

    if not os.path.exists(final_mp3):
        raise FileNotFoundError(f"Failed to extract audio MP3 from YouTube URL: {url}")

    return final_mp3, title, duration

def transcribe_with_gemini(audio_path, api_key):
    """Uses Gemini 3.8 Flash to detect language, transcribe lyrics, and classify Male vs Female voice."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    # 1. Upload audio file to Gemini Files API
    uploaded_file = client.files.upload(file=audio_path)

    # Poll until file is processed
    for _ in range(35):
        file_info = client.files.get(name=uploaded_file.name)
        if file_info.state.name == "ACTIVE":
            break
        elif file_info.state.name == "FAILED":
            raise RuntimeError("Gemini audio file processing failed.")
        time.sleep(1)

    prompt = """You are an expert music and duet karaoke transcriber.
Analyze this audio track and produce a synchronized duet karaoke lyric script with vocal role tags.

INSTRUCTIONS:
1. DETECT THE LANGUAGE: Identify the primary singing language of the track (e.g., Hindi, English, Spanish, Korean, Tamil, Japanese, etc.).
2. TRANSCRIBE VERBATIM LYRICS: Transcribe every line that is sung with precise start and end timestamps in format [MM:SS.SS - MM:SS.SS].
3. VOCAL TIMBRE CLASSIFICATION (DUET TAGGING):
   - Listen to the singer's vocal timbre and pitch range:
     - Mark [1] for Male singer (Baritone / Tenor / Singer 1)
     - Mark [2] for Female singer (Soprano / Alto / Singer 2)
     - Mark [3] for Duet / Unison (when both male and female singers sing together in harmony or unison)
     - If the song is a solo or multiple singers of same gender, distinguish the primary lead as [1] and secondary as [2].
4. OUTPUT FORMAT:
   First line:
   LANGUAGE: <detected language>

   Followed by lines strictly in this format:
   [SingerTag] [StartTime - EndTime] Lyric line text

   Example:
   LANGUAGE: English
   [1] [00:12.40 - 00:17.50] I hear you whispering across the night
   [2] [00:18.00 - 00:23.20] And I am waiting under city lights
   [3] [00:24.00 - 00:31.50] Together we can make this dream come true

Do not include extra commentary, markdown headers, or disclaimers outside of the requested format."""

    response = client.models.generate_content(
        model="gemini-3.8-flash",
        contents=[uploaded_file, prompt]
    )

    try:
        client.files.delete(name=uploaded_file.name)
    except Exception:
        pass

    raw_text = response.text or ""
    language = "Detected Song"
    lyrics_lines = []

    for line in raw_text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.upper().startswith("LANGUAGE:"):
            language = line.split(":", 1)[1].strip()
            continue
        if re.search(r'\[\d{1,2}:\d{2}', line) or re.search(r'\[[123]\]', line):
            if not re.match(r'^\[[123]\]', line):
                line = f"[1] {line}"
            lyrics_lines.append(line)

    return language, "\n".join(lyrics_lines)

def clean_song_title(title):
    """Cleans YouTube title to extract artist and song name for lyrics search."""
    t = re.sub(r'[\(\[\{].*?[\)\]\}]', '', title)
    t = re.sub(r'\b(official|music|video|audio|lyric|lyrics|hd|4k|remastered|ft|feat|prod)\b', '', t, flags=re.I)
    t = t.replace('_', ' ').replace('-', ' ')
    return ' '.join(t.split())

def lrc_to_duet_format(lrc_text, duration):
    """Converts LRC format [MM:SS.xx] lyrics into Duet Karaoke format [Singer] [Start - End] text."""
    lines = []
    lrc_regex = re.compile(r'\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\](.*)')

    parsed_cues = []
    for raw in lrc_text.splitlines():
        m = lrc_regex.match(raw.strip())
        if m:
            time_str, lyric = m.groups()
            lyric = lyric.strip()
            if lyric:
                # Convert time_str to seconds
                parts = time_str.split(':')
                secs = float(parts[0]) * 60 + float(parts[1])
                parsed_cues.append((secs, lyric))

    if not parsed_cues:
        return ""

    singer_turn = 1
    for i, (curr_start, text) in enumerate(parsed_cues):
        if i + 1 < len(parsed_cues):
            next_start = parsed_cues[i + 1][0]
            curr_end = min(curr_start + 6.0, max(curr_start + 1.8, next_start - 0.25))
        else:
            curr_end = curr_start + 4.0

        # Detect singer hints in text if present (e.g. "Male:", "(Female)")
        tag = singer_turn
        lower = text.lower()
        if 'female' in lower or 'girl' in lower:
            tag = 2
        elif 'male' in lower or 'boy' in lower:
            tag = 1
        elif 'both' in lower or 'all' in lower or 'together' in lower:
            tag = 3

        def sec_to_str(s):
            m = int(s // 60)
            sec = s % 60
            return f"{m:02d}:{sec:05.2f}"

        clean_text = re.sub(r'^\s*(?:male|female|both|singer \d)\s*:\s*', '', text, flags=re.I)
        lines.append(f"[{tag}] [{sec_to_str(curr_start)} - {sec_to_str(curr_end)}] {clean_text}")

        # Alternate singer turns between 1 and 2
        singer_turn = 2 if singer_turn == 1 else 1

    return "\n".join(lines)

def fetch_lrclib_synced_lyrics(title, duration):
    """Queries LRCLIB (open, free synced lyrics database with 0 keys and no 429 errors)."""
    clean_title = clean_song_title(title)
    if not clean_title:
        return None

    try:
        query = urllib.parse.urlencode({'q': clean_title})
        req = urllib.request.Request(
            f"https://lrclib.net/api/search?{query}",
            headers={'User-Agent': 'DuetKaraokeMaker/1.0'}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode('utf-8'))
            if data and isinstance(data, list):
                # Find best entry with syncedLyrics
                for entry in data:
                    synced = entry.get('syncedLyrics')
                    if synced:
                        duet_lyrics = lrc_to_duet_format(synced, duration)
                        if duet_lyrics:
                            lang = entry.get('trackName', 'Synced Track')
                            return lang, duet_lyrics
    except Exception as e:
        pass
    return None

def fallback_captions_to_lyrics(url, title, duration):
    """Tries LRCLIB first, then safe YouTube subtitle extraction without crashing."""
    # 1. Try free public LRCLIB synced lyrics
    lrc_res = fetch_lrclib_synced_lyrics(title, duration)
    if lrc_res:
        return "Synced Lyrics (LRCLIB)", lrc_res[1]

    # 2. Try safe, non-crashing YouTube subtitle extraction
    try:
        import yt_dlp
        sub_opts = {
            'skip_download': True,
            'writeautomaticsub': True,
            'subtitleslangs': ['en'],
            'quiet': True,
            'ignoreerrors': True,
        }
        with yt_dlp.YoutubeDL(sub_opts) as ydl:
            sub_info = ydl.extract_info(url, download=False)
            subs = sub_info.get('automatic_captions', {}).get('en', [])
            if subs:
                for sub in subs:
                    if sub.get('ext') == 'json3':
                        req = urllib.request.Request(sub['url'], headers={'User-Agent': 'Mozilla/5.0'})
                        with urllib.request.urlopen(req, timeout=4) as r:
                            vtt_data = json.loads(r.read())
                            events = vtt_data.get('events', [])
                            cues = []
                            for ev in events:
                                segs = ev.get('segs', [])
                                t_str = ''.join(s.get('utf8', '') for s in segs).strip()
                                if t_str and t_str != '\n':
                                    t_start = ev.get('tStartMs', 0) / 1000.0
                                    t_dur = ev.get('dDurationMs', 3000) / 1000.0
                                    cues.append(f"[1] [{int(t_start//60):02d}:{t_start%60:05.2f} - {int((t_start+t_dur)//60):02d}:{(t_start+t_dur)%60:05.2f}] {t_str}")
                            if cues:
                                return "YouTube Captions", "\n".join(cues[:50])
    except Exception:
        pass

    # 3. Friendly helpful template
    default_lyrics = f"""[1] [00:05.00 - 00:10.50] {title}
[2] [00:11.00 - 00:16.80] (Add lyrics here or tap Spacebar in Tap-to-Sync tab!)
[3] [00:17.50 - 00:24.00] 💡 Tip: Click 🔑 AI Key and enter a Gemini Key for instant Male/Female AI separation!"""

    return "Manual / Duet Template", default_lyrics

def main():
    args = parse_args()
    temp_dir = get_temp_dir()
    api_key = args.api_key or os.environ.get("GEMINI_API_KEY", "")

    try:
        # Download audio (guaranteed clean, no subtitle 429 errors)
        mp3_path, title, duration = download_youtube_audio(args.url, temp_dir)
        filename = os.path.basename(mp3_path)

        if api_key:
            try:
                language, lyrics = transcribe_with_gemini(mp3_path, api_key)
            except Exception as gemini_err:
                print(f"[Gemini API Warning: {gemini_err}, falling back to synced lyrics]", file=sys.stderr)
                language, lyrics = fallback_captions_to_lyrics(args.url, title, duration)
        else:
            language, lyrics = fallback_captions_to_lyrics(args.url, title, duration)

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
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main()
