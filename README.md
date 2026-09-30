# 🎵 Duet Karaoke Maker (Ultra-Lite Edition)

A high-performance, ultra-lightweight local web browser studio for creating **5-Section Anti-Overlap Duet Karaoke Videos** with synchronized word-level sweeps (`\kf`).

Specially re-engineered to run silky-smooth on laptops with **4GB of RAM and standard hard drives (HDD)**, with **zero bloated multi-gigabyte dependencies**.

---

## ⚡ Quick Start

### Windows
Double-click **`start.bat`**.
- Starts in under **1 second** using Node.js (already installed) or Python.
- Uses only **~25 MB of RAM**.
- Automatically opens in your browser at `http://localhost:3000`.

### macOS / Linux
```bash
chmod +x start.sh
./start.sh
```

---

## 🌟 Key Features

1. **Exact 5-Section Anti-Overlap Layout (1920x1080)**:
   - 4 horizontal divider lines ($y = 216, 432, 648, 864$) dividing the canvas into 5 sections of 216px.
   - 3 active lyric slots centered at $y = 324$ (Slot 0), $y = 540$ (Slot 1), and $y = 756$ (Slot 2).
   - Anti-overlap slot boundary math ensures lines in the same slot never clash.

2. **Smooth Word-by-Word Karaoke Sweeps (`\kf`)**:
   - Progressive left-to-right color wipe across each word as it is sung.
   - Custom singer colors for Part 1 (`[1]`), Part 2 (`[2]`), and Duet Unison (`[3]`).
   - Crisp white text with 4px black outline and 3px soft shadow.

3. **Real-Time Live 60fps Canvas Preview**:
   - Scrub through audio, play, and watch the exact karaoke video in real-time right inside your browser before exporting!

4. **Interactive Tap-to-Sync Mode**:
   - Don't have timestamps? Switch to the "Tap to Sync" tab, play the song, and tap Spacebar or "Mark Line" to record timestamps in real-time as you listen!

5. **🎙️ Real-Time Vocal Remover (Karaoke Filter)**:
   - Instant center-channel vocal cancellation using Web Audio API DSP.
   - Low-pass bass crossover filter ensures punchy kick drums and basslines stay intact.
   - Smooth 0%–100% intensity slider and 1-click toggle.
   - 0 MB download, 0 MB disk, 0 wait time. Works live during playback and directly in exported videos.

6. **🚀 In-Browser 1080p Video Render**:
   - Exports high-definition video directly in your browser using Canvas capture + Web Audio.
   - Requires zero external tools and works 100% reliably even without FFmpeg installed!
   - Download button appears immediately upon completion with an in-page video player.

---

## 🎤 Timestamp & Duet Syntax

Paste your lyrics into the editor using either format:

### Bracket Format (Recommended)
```text
[1] [00:01.00 - 00:05.50] Male singer line
[2] [00:06.00 - 00:10.80] Female singer response
[3] [00:11.50 - 00:18.00] Both singing together in harmony
```

### Comma Format
```text
00:00:20.000,00:00:25.000
[1] Comma format timestamps are also supported!
```

### Duet Singer Tags
- `[1]`: Singer 1 (e.g. Male / Cyan `#00FFFF`)
- `[2]`: Singer 2 (e.g. Female / Magenta `#FF00FF`)
- `[3]`: Duet Unison (e.g. Both / Yellow `#FFFF00`)

---

## ⚙️ Optional: 1-Click FFmpeg Installation (Windows)
If you want to use the server-side FFmpeg engine:
1. Double click **`install_ffmpeg.bat`** (or run `winget install Gyan.FFmpeg -e` in PowerShell).
2. The web studio will automatically detect FFmpeg on next launch!
*(Note: FFmpeg is completely optional—the In-Browser Video Render works out-of-the-box without it!)*
