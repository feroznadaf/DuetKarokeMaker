import os
import re
import sys
import platform
import subprocess
import tempfile
try:
    import torch
    import whisperx
    import gradio as gr
    GRADIO_AVAILABLE = True
except ImportError:
    GRADIO_AVAILABLE = False
    torch = None
    whisperx = None
    gr = None

# ==========================================
# 1. HARDWARE & FONT CONFIGURATION
# ==========================================
DEVICE = "cuda" if (torch and torch.cuda.is_available()) else "cpu"
COMPUTE_TYPE = "float16" if DEVICE == "cuda" else "int8"
SAMPLE_RATE = 16000

whisper_model = None

def get_whisper_model():
    """Lazily loads the Whisper model on first auto-transcription request."""
    global whisper_model
    if whisper_model is None:
        print(f"Loading WhisperX base model on {DEVICE} (compute_type={COMPUTE_TYPE})...")
        whisper_model = whisperx.load_model("base", DEVICE, compute_type=COMPUTE_TYPE)
    return whisper_model


def get_preferred_font() -> str:
    """
    Detects if 'Noto Sans' is available on the system.
    Falls back to 'Arial' (Windows/macOS) or a standard sans-serif font (Linux)
    to prevent FFmpeg / libass crashes when Noto Sans is missing.
    """
    # 1. Try checking via matplotlib font_manager if installed
    try:
        from matplotlib import font_manager
        installed = {f.name.lower() for f in font_manager.fontManager.ttflist}
        if any("noto sans" in name for name in installed):
            return "Noto Sans"
        if "arial" in installed:
            return "Arial"
        if "segoe ui" in installed:
            return "Segoe UI"
    except Exception:
        pass

    # 2. Inspect standard operating system font directories
    system = platform.system()
    if system == "Windows":
        windir = os.environ.get("WINDIR", "C:\\Windows")
        fonts_dir = os.path.join(windir, "Fonts")
        if os.path.isdir(fonts_dir):
            try:
                font_files = [f.lower() for f in os.listdir(fonts_dir)]
                if any("notosans" in f for f in font_files):
                    return "Noto Sans"
                if any("arial" in f for f in font_files):
                    return "Arial"
                if any("segoe" in f for f in font_files):
                    return "Segoe UI"
            except Exception:
                pass
        return "Arial"

    elif system == "Darwin":  # macOS
        mac_dirs = ["/Library/Fonts", "/System/Library/Fonts", os.path.expanduser("~/Library/Fonts")]
        for d in mac_dirs:
            if os.path.isdir(d):
                try:
                    font_files = [f.lower() for f in os.listdir(d)]
                    if any("notosans" in f for f in font_files):
                        return "Noto Sans"
                    if any("arial" in f for f in font_files):
                        return "Arial"
                    if any("helvetica" in f for f in font_files):
                        return "Helvetica"
                except Exception:
                    pass
        return "Arial"

    else:  # Linux and Unix-like
        linux_dirs = [
            "/usr/share/fonts",
            "/usr/local/share/fonts",
            os.path.expanduser("~/.fonts"),
            os.path.expanduser("~/.local/share/fonts")
        ]
        for d in linux_dirs:
            if os.path.isdir(d):
                try:
                    for _, _, files in os.walk(d):
                        for f in files:
                            fl = f.lower()
                            if "notosans" in fl:
                                return "Noto Sans"
                            if "dejavusans" in fl:
                                return "DejaVu Sans"
                except Exception:
                    pass
        return "Arial"


# ==========================================
# 2. TIME PARSING & MATH HELPERS
# ==========================================
def format_ass_time(seconds: float) -> str:
    """Converts seconds into ASS subtitle format: H:MM:SS.cs"""
    if not seconds or seconds < 0:
        return "0:00:00.00"
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    centisecs = int(round((secs - int(secs)) * 100))
    return f"{int(hours)}:{int(minutes):02d}:{int(secs):02d}.{centisecs:02d}"


def time_str_to_seconds(t_str: str) -> float:
    """Converts timestamp strings (SS, MM:SS, HH:MM:SS) into float seconds."""
    parts = t_str.strip().split(':')
    if len(parts) == 1:
        return float(parts[0])
    elif len(parts) == 2:
        return float(parts[0]) * 60 + float(parts[1])
    elif len(parts) == 3:
        return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
    return 0.0


def hex_to_ass_color(hex_color: str) -> str:
    """Converts standard Hex #RRGGBB to ASS subtitle format &HBBGGRR."""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 6:
        r, g, b = hex_color[0:2], hex_color[2:4], hex_color[4:6]
        return f"&H00{b}{g}{r}"
    return "&H0000FFFF"


def assign_proportional_word_timings(text: str, start_time: float, end_time: float):
    """Calculates estimated start and end timestamps per word proportionally by character count."""
    words = text.split()
    if not words:
        return []
    total_chars = sum(len(w) for w in words)
    current_time = start_time
    word_info = []
    for w in words:
        duration = (len(w) / max(total_chars, 1)) * (end_time - start_time)
        word_info.append({"word": w, "start": current_time, "end": current_time + duration})
        current_time += duration
    return word_info


def parse_manual_timestamps(text: str):
    """
    Parses bracketed [00:00 - 00:10] and comma-separated 00:00,00:10 lyrics
    with [1], [2], or [3] duet color tags.
    """
    segments = []
    pattern_bracket = r"\[\s*([\d:.]+)\s*-\s*([\d:.]+)\s*\](.*)"
    pattern_comma = r"([\d:.]+)\s*,\s*([\d:.]+)(.*)"

    lines = text.strip().split('\n')
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue

        start_str, end_str, inline_lyric = None, None, None
        match_bracket = re.match(pattern_bracket, line)
        match_comma = re.match(pattern_comma, line)

        if match_bracket:
            start_str, end_str, inline_lyric = match_bracket.groups()
        elif match_comma:
            start_str, end_str, inline_lyric = match_comma.groups()

        if start_str and end_str:
            start_sec = time_str_to_seconds(start_str)
            end_sec = time_str_to_seconds(end_str)
            lyric = inline_lyric.strip() if inline_lyric else ""

            if not lyric and i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                if not re.match(pattern_bracket, next_line) and not re.match(pattern_comma, next_line):
                    lyric = next_line
                    i += 1

            if lyric:
                color_mode = 1
                color_match = re.search(r"\[([123])\]", lyric)
                if color_match:
                    color_mode = int(color_match.group(1))
                    lyric = re.sub(r"\[([123])\]", "", lyric).strip()

                segments.append({
                    "start": start_sec,
                    "end": end_sec,
                    "text": lyric,
                    "color_mode": color_mode,
                    "words": assign_proportional_word_timings(lyric, start_sec, end_sec)
                })
        i += 1
    return segments


# ==========================================
# 3. VIDEO GENERATION LOGIC
# ==========================================
def process_song(audio_path, manual_lyrics, font_size, color_1, color_2, color_3, progress=gr.Progress()):
    if not audio_path:
        raise gr.Error("Please upload an audio file first!")

    ass_path = None
    try:
        progress(0.1, desc="🎧 Reading audio file...")
        audio = whisperx.load_audio(audio_path)
        final_segments = []

        if manual_lyrics and ("," in manual_lyrics or "[" in manual_lyrics):
            progress(0.4, desc="📝 Applying manual timestamps & colors...")
            final_segments = parse_manual_timestamps(manual_lyrics)
            if not final_segments:
                raise gr.Error("Could not parse your timestamps. Please check the format!")
        else:
            progress(0.3, desc="🧠 Auto-Transcribing...")
            model = get_whisper_model()
            transcription = model.transcribe(audio, batch_size=8)
            detected_lang = transcription.get("language", "en")
            segments = transcription.get("segments", [])

            progress(0.5, desc=f"⏱️ Auto-Aligning words ({detected_lang})...")
            try:
                align_model, metadata = whisperx.load_align_model(language_code=detected_lang, device=DEVICE)
                aligned_result = whisperx.align(segments, align_model, metadata, audio, DEVICE, return_char_alignments=False)
                final_segments = aligned_result.get("segments", segments)
            except Exception:
                final_segments = segments

        progress(0.7, desc="🎨 Generating Duet 5-Section Display (1920x1080)...")
        
        # Select available font with Noto Sans -> Arial / system sans-serif fallback
        font_name = get_preferred_font()

        # Create temporary ASS file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".ass", mode="w", encoding="utf-8") as f:
            ass_path = f.name
            f.write("[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n")
            f.write("[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")

            ass_c1 = hex_to_ass_color(color_1)
            ass_c2 = hex_to_ass_color(color_2)
            ass_c3 = hex_to_ass_color(color_3)

            f.write(f"Style: Karaoke1,{font_name},{int(font_size)},{ass_c1},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,3,5,0,0,0,1\n")
            f.write(f"Style: Karaoke2,{font_name},{int(font_size)},{ass_c2},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,3,5,0,0,0,1\n")
            f.write(f"Style: Karaoke3,{font_name},{int(font_size)},{ass_c3},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,3,5,0,0,0,1\n\n")

            f.write("[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")

            # --- SLOT OVERLAP PREVENTION LOGIC ---
            # Step 1: Give every line a generous ideal appear/disappear time
            for seg in final_segments:
                seg['appear'] = max(0.0, seg.get('start', 0.0) - 2.0)
                seg['disappear'] = seg.get('end', seg.get('start', 0.0) + 2.0) + 1.5

            # Step 2: Strictly enforce boundaries so lines in the SAME slot never overlap
            for i in range(3, len(final_segments)):
                prev_i = i - 3  # The previous line assigned to this exact slot
                if final_segments[prev_i]['disappear'] > final_segments[i]['appear']:
                    # Calculate safe midpoint between the old line ending and new line starting
                    safe_mid = (final_segments[prev_i].get('end', 0) + final_segments[i].get('start', 0)) / 2.0
                    final_segments[prev_i]['disappear'] = safe_mid
                    final_segments[i]['appear'] = safe_mid

            # Step 3: Write the finalized subtitles
            for i, seg in enumerate(final_segments):
                singing_start = seg.get("start", 0.0)

                start_str = format_ass_time(seg['appear'])
                end_str = format_ass_time(seg['disappear'])

                # --- 5-SECTION PLACEMENT MATH ---
                slot = i % 3
                y_pos = 324 + (slot * 216)
                pos_tag = f"{{\\pos(960,{y_pos})}}"

                initial_gap_cs = int(round((singing_start - seg['appear']) * 100))
                text_to_display = f"{{\\k{initial_gap_cs}}}" if initial_gap_cs > 0 else ""

                words = seg.get("words", [])
                current_time = singing_start
                for word_info in words:
                    w_start = word_info.get("start", current_time)
                    w_end = word_info.get("end", current_time + 0.1)
                    w_text = word_info.get("word", "").strip()
                    if not w_text:
                        continue

                    gap_duration_cs = int(round((w_start - current_time) * 100))
                    if gap_duration_cs > 0:
                        text_to_display += f"{{\\k{gap_duration_cs}}}"

                    word_duration_cs = int(round((w_end - w_start) * 100))
                    text_to_display += f"{{\\kf{word_duration_cs}}}{w_text} "
                    current_time = w_end

                color_mode = seg.get("color_mode", 1)
                style_name = f"Karaoke{color_mode}"

                f.write(f"Dialogue: 0,{start_str},{end_str},{style_name},,0,0,0,,{pos_tag}{text_to_display}\n")

        # ==========================================
        # FFMPEG RENDER WITH SEPARATORS
        # ==========================================
        progress(0.85, desc="🎬 Rendering Video with Separators...")
        output_mp4 = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name

        draw_lines = (
            "drawbox=x=0:y=216:w=1920:h=1:color=#444444:t=fill,"
            "drawbox=x=0:y=432:w=1920:h=1:color=#444444:t=fill,"
            "drawbox=x=0:y=648:w=1920:h=1:color=#444444:t=fill,"
            "drawbox=x=0:y=864:w=1920:h=1:color=#444444:t=fill"
        )

        # Escape path for FFmpeg filtergraph (critical on Windows where drive letters C: break filter options)
        ass_path_escaped = ass_path.replace("\\", "/").replace(":", r"\:")

        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=black:s=1920x1080:r=30",
            "-i", audio_path,
            "-vf", f"{draw_lines},ass='{ass_path_escaped}'",
            "-shortest",
            "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            output_mp4
        ]

        try:
            subprocess.run(
                ffmpeg_cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                check=True
            )
        except FileNotFoundError:
            raise gr.Error(
                "FFmpeg was not found on your system! "
                "Please install FFmpeg and make sure it is added to your system PATH. "
                "Refer to README.md for instructions."
            )
        except subprocess.CalledProcessError as cpe:
            err_details = cpe.stderr.decode('utf-8', errors='replace') if cpe.stderr else str(cpe)
            raise gr.Error(f"FFmpeg render failed: {err_details[-400:]}")

        progress(1.0, desc="✅ Complete!")
        return output_mp4

    except gr.Error:
        raise
    except Exception as err:
        raise gr.Error(f"Generation error: {str(err)}")
    finally:
        # Clean up temporary ASS subtitle script file
        if ass_path and os.path.exists(ass_path):
            try:
                os.remove(ass_path)
            except Exception:
                pass


# ==========================================
# 4. USER INTERFACE
# ==========================================
demo = None
if GRADIO_AVAILABLE:
    with gr.Blocks(theme=gr.themes.Soft(primary_hue="blue")) as demo:
        gr.Markdown(
            """
            # 🎵 Duet Karaoke Maker (Anti-Overlap 5-Section Layout)
            Upload your song, paste your timings, and choose your colors.
            Tag your lyrics with `[1]`, `[2]`, or `[3]` to apply your chosen sweep colors!
            """
        )
        with gr.Row():
            with gr.Column(scale=1):
                audio_input = gr.Audio(label="1. Upload Song File (MP3 / WAV)", type="filepath")
                font_size_input = gr.Slider(minimum=40, maximum=180, value=85, step=1, label="2. Adjust Font Size")

                with gr.Row():
                    color_1_input = gr.ColorPicker(value="#00FFFF", label="[1] Color (e.g. Male)")
                    color_2_input = gr.ColorPicker(value="#FF00FF", label="[2] Color (e.g. Female)")
                    color_3_input = gr.ColorPicker(value="#FFFF00", label="[3] Color (e.g. Both)")

                lyrics_input = gr.Textbox(
                    label="3. Strict Timestamp Lyrics with Color Tags",
                    lines=10,
                    placeholder="[1] [00:00 - 00:10] Male singing line\n\n00:00:24.000,00:00:26.560\n[2] Female singing line\n\n[3] [00:30 - 00:35] Both singing together"
                )
                generate_btn = gr.Button("✨ Generate Lyrical Video", variant="primary", size="lg")

            with gr.Column(scale=1):
                video_output = gr.Video(label="Final Video Output")

        generate_btn.click(
            fn=process_song,
            inputs=[audio_input, lyrics_input, font_size_input, color_1_input, color_2_input, color_3_input],
            outputs=[video_output]
        )

# =======================================================
# Top-level exports for Vercel / WSGI / Serverless runtime
# =======================================================
try:
    from server import KaraokeHandler
    handler = KaraokeHandler
    app = KaraokeHandler
    application = KaraokeHandler
except Exception:
    from http.server import BaseHTTPRequestHandler
    class FallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"Duet Karaoke Maker")
    handler = FallbackHandler
    app = FallbackHandler
    application = FallbackHandler

if __name__ == "__main__":
    if GRADIO_AVAILABLE and demo is not None:
        demo.launch(inbrowser=True)
    else:
        print("Gradio / WhisperX dependencies are not installed.")
        print("To run the modern lightweight web studio (20MB RAM), run:")
        print("    node server.js   OR   python server.py")
