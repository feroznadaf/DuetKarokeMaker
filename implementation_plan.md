# Implementation Plan: Local Duet Karaoke Maker Web App [COMPLETED]

Migrate the Google Colab karaoke generator script into a standalone, local, double-clickable web app powered by Gradio, WhisperX, and FFmpeg.

## Proposed Changes

### Core Application
#### [NEW] [app.py](file:///c:/Users/Admin/Desktop/Duet%20karoke%20maker/app.py)
- Remove all Colab notebook magics (`!apt-get`, `!pip`, `!echo`).
- Sanitize character encoding (strip non-breaking spaces `\xa0` present in notebook snippets).
- Implement robust font fallback mechanism:
  - Add `get_fallback_font()` function that checks system availability for "Noto Sans".
  - If "Noto Sans" is unavailable, gracefully fall back to "Arial" (Windows / macOS) or "DejaVu Sans" (Linux) to prevent FFmpeg / libass crashes.
- Fix Windows FFmpeg filter escaping:
  - In FFmpeg's `-vf` filtergraph, file paths containing drive letters (e.g. `C:\...`) cause parsing failures if colons and backslashes are unescaped. Path will be formatted as `ass_path.replace('\\', '/').replace(':', r'\:')`.
- Implement lazy loading for the WhisperX base model so the Gradio web UI launches instantly rather than blocking on startup.
- Change launch trigger to `demo.launch(inbrowser=True)`.
- Add explicit error catching for missing `ffmpeg` binaries with clear guidance.

---

### Dependency Management
#### [NEW] [requirements.txt](file:///c:/Users/Admin/Desktop/Duet%20karoke%20maker/requirements.txt)
- Include core dependencies:
  - `gradio`
  - `whisperx`
  - `pysubs2`

---

### Launcher Scripts
#### [NEW] [start.bat](file:///c:/Users/Admin/Desktop/Duet%20karoke%20maker/start.bat)
- Double-clickable batch file for Windows.
- Verifies Python installation.
- Automatically creates a `venv` virtual environment if it does not already exist.
- Installs `requirements.txt` into the `venv` on first initialization.
- Activates `venv`.
- Verifies whether `ffmpeg` is available on the PATH and displays a clear advisory if missing.
- Launches `python app.py` and pauses on exit if an error occurs so the console window does not disappear immediately.

#### [NEW] [start.sh](file:///c:/Users/Admin/Desktop/Duet%20karoke%20maker/start.sh)
- Unix shell script for macOS and Linux users.
- Verifies `python3`.
- Creates and initializes `venv` if missing.
- Activates `venv` and runs `python app.py`.

---

### System Setup Guide & Documentation
#### [NEW] [README.md](file:///c:/Users/Admin/Desktop/Duet%20karoke%20maker/README.md)
- Complete setup and troubleshooting guide:
  - **FFmpeg Installation**: System-level installation steps for Windows (winget or gyan.dev), macOS (Homebrew), and Linux (`apt`).
  - **PyTorch Hardware Configuration**: Separate installation commands for NVIDIA GPU (CUDA 12.1/11.8), Apple Silicon (MPS), and CPU-only setups.
  - **Running the App**: Double-clicking `start.bat` (Windows) or executing `./start.sh` (Mac/Linux).
  - **Duet Syntax & Formatting**: Documentation on timestamp syntax (`[00:00 - 00:10]` vs `00:00:24.000,00:00:26.560`) and color tags `[1]`, `[2]`, `[3]` for duet parts (e.g. Male / Female / Both).

## Verification Plan

### Automated / Code Validation
- Validate Python syntax of `app.py` with static parsing / AST checks to ensure zero non-breaking space or syntax issues.
- Verify `start.bat` and `start.sh` syntax and execution flow logic.
- Verify `requirements.txt` format.

### Manual Verification
- Review generated files against all user requirements:
  1. Clean `app.py` with `inbrowser=True` and Noto Sans -> Arial fallback.
  2. `requirements.txt` with `gradio`, `whisperx`, `pysubs2`.
  3. `start.bat` with venv creation, activation, and launch.
  4. `start.sh` equivalent for Mac/Linux.
  5. `README.md` with detailed system-level FFmpeg and PyTorch installation instructions.
