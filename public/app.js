/**
 * Duet Karaoke Maker - Ultra-Lite Browser Studio
 * 100% Client-Side + Lite Server Integration
 */

// ==========================================
// 1. STATE & CONSTANTS
// ==========================================
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const CANVAS_DIVIDERS = [216, 432, 648, 864];
const SLOT_Y_POSITIONS = [324, 540, 756]; // Middle of sections 2, 3, 4

const state = {
  audioFile: null,
  audioBuffer: null,
  audioDuration: 0,
  audioElement: new Audio(),
  audioContext: null,
  audioSourceNode: null,
  mediaStreamDestination: null,
  isPlaying: false,
  currentTime: 0,
  playbackRate: 1.0,

  fontSize: 85,
  color1: '#00FFFF',
  color2: '#FF00FF',
  color3: '#FFFF00',

  lyricsRaw: '',
  segments: [],
  activeSlotSegments: [null, null, null],

  tapSyncIndex: 0,
  tapSyncLines: [],

  ffmpegAvailable: false,
  isRendering: false,
  mediaRecorder: null,
  recordedChunks: []
};

// ==========================================
// 2. DOM ELEMENTS
// ==========================================
const dom = {
  engineStatus: document.getElementById('engine-status'),
  systemChip: document.getElementById('system-chip'),
  btnLoadSample: document.getElementById('btn-load-sample'),

  // Audio elements
  audioDropzone: document.getElementById('audio-dropzone'),
  audioFileInput: document.getElementById('audio-file-input'),
  dropzonePrompt: document.getElementById('dropzone-prompt'),
  audioLoadedCard: document.getElementById('audio-loaded-card'),
  audioFilename: document.getElementById('audio-filename'),
  audioDuration: document.getElementById('audio-duration'),
  btnRemoveAudio: document.getElementById('btn-remove-audio'),

  // Player controls
  btnPlayPause: document.getElementById('btn-play-pause'),
  playIcon: document.getElementById('play-icon'),
  pauseIcon: document.getElementById('pause-icon'),
  timeDisplay: document.getElementById('time-display'),
  timeScrubber: document.getElementById('time-scrubber'),
  playbackSpeed: document.getElementById('playback-speed'),

  // Color inputs
  color1: document.getElementById('color-1'),
  color1Hex: document.getElementById('color-1-hex'),
  color2: document.getElementById('color-2'),
  color2Hex: document.getElementById('color-2-hex'),
  color3: document.getElementById('color-3'),
  color3Hex: document.getElementById('color-3-hex'),
  fontSizeSlider: document.getElementById('font-size-slider'),
  fontSizeVal: document.getElementById('font-size-val'),

  // Lyrics editor
  tabEditor: document.getElementById('tab-editor'),
  tabTapSync: document.getElementById('tab-tap-sync'),
  paneEditor: document.getElementById('pane-editor'),
  paneTapSync: document.getElementById('pane-tap-sync'),
  lyricsTextarea: document.getElementById('lyrics-textarea'),
  parsedCountBadge: document.getElementById('parsed-count-badge'),
  btnFormatCheck: document.getElementById('btn-format-check'),
  btnTapSyncAction: document.getElementById('btn-tap-sync-action'),
  btnTapSyncReset: document.getElementById('btn-tap-sync-reset'),
  tapSyncLinesList: document.getElementById('tap-sync-lines-list'),

  // Canvas
  canvas: document.getElementById('karaoke-canvas'),
  canvasGuide: document.getElementById('canvas-guide'),
  chkShowGuides: document.getElementById('chk-show-guides'),
  slotIndicator: document.getElementById('slot-indicator'),
  btnFullscreen: document.getElementById('btn-fullscreen'),
  stageWrapper: document.getElementById('stage-wrapper'),

  // Export
  btnRenderLive: document.getElementById('btn-render-live'),
  btnRenderUniversal: document.getElementById('btn-render-universal'),
  btnRenderBrowser: document.getElementById('btn-render-browser'),
  btnRenderFfmpeg: document.getElementById('btn-render-ffmpeg'),
  btnExportAss: document.getElementById('btn-export-ass'),
  cardFfmpegExport: document.getElementById('card-ffmpeg-export'),
  ffmpegDesc: document.getElementById('ffmpeg-desc'),
  renderProgressCard: document.getElementById('render-progress-card'),
  renderStatusText: document.getElementById('render-status-text'),
  renderPercentageText: document.getElementById('render-percentage-text'),
  progressBarFill: document.getElementById('progress-bar-fill'),
  renderEta: document.getElementById('render-eta'),
  btnCancelRender: document.getElementById('btn-cancel-render'),
  downloadBanner: document.getElementById('download-banner'),
  btnDownloadVideo: document.getElementById('btn-download-video'),
  downloadFilenameSub: document.getElementById('download-filename-sub'),
  renderedVideoWrapper: document.getElementById('rendered-video-wrapper'),
  renderedVideoPlayer: document.getElementById('rendered-video-player'),

  // Modal
  syntaxModal: document.getElementById('syntax-modal'),
  btnCloseSyntax: document.getElementById('btn-close-syntax'),
  btnSyntaxOk: document.getElementById('btn-syntax-ok')
};

const ctx = dom.canvas.getContext('2d');

// ==========================================
// 3. TIME PARSING & MATH HELPERS
// ==========================================
function timeStrToSeconds(str) {
  if (!str) return 0;
  const parts = str.trim().split(':');
  if (parts.length === 1) return parseFloat(parts[0]) || 0;
  if (parts.length === 2) return (parseFloat(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
  if (parts.length === 3) return (parseFloat(parts[0]) || 0) * 3600 + (parseFloat(parts[1]) || 0) * 60 + (parseFloat(parts[2]) || 0);
  return 0;
}

function formatDisplayTime(seconds) {
  if (!seconds || seconds < 0 || isNaN(seconds)) return '00:00.00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
}

function formatAssTime(seconds) {
  if (!seconds || seconds < 0 || isNaN(seconds)) return '0:00:00.00';
  const hours = Math.floor(seconds / 3600);
  const remainder = seconds % 3600;
  const minutes = Math.floor(remainder / 60);
  const secs = remainder % 60;
  const cs = Math.round((secs - Math.floor(secs)) * 100);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(Math.floor(secs)).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function hexToAssColor(hex) {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 6) {
    const r = clean.substring(0, 2);
    const g = clean.substring(2, 4);
    const b = clean.substring(4, 6);
    return `&H00${b}${g}${r}`;
  }
  return '&H0000FFFF';
}

function assignProportionalWordTimings(text, startTime, endTime) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const totalChars = words.reduce((acc, w) => acc + w.length, 0);
  let cur = startTime;
  const result = [];
  const totalDuration = endTime - startTime;

  for (const w of words) {
    const dur = (w.length / Math.max(totalChars, 1)) * totalDuration;
    result.push({
      word: w,
      start: cur,
      end: cur + dur
    });
    cur += dur;
  }
  return result;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ==========================================
// 4. LYRIC PARSER & ANTI-OVERLAP SCHEDULER
// ==========================================
function parseManualTimestamps(text) {
  const patternBracket = /^\[\s*([\d:.]+)\s*-\s*([\d:.]+)\s*\](.*)$/;
  const patternComma = /^([\d:.]+)\s*,\s*([\d:.]+)(.*)$/;

  const lines = text.split('\n');
  const rawSegments = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    let startStr = null;
    let endStr = null;
    let inlineLyric = null;

    // Check bracket pattern or comma pattern
    let mb = line.match(patternBracket);
    let mc = line.match(patternComma);

    if (mb) {
      startStr = mb[1];
      endStr = mb[2];
      inlineLyric = mb[3];
    } else if (mc) {
      startStr = mc[1];
      endStr = mc[2];
      inlineLyric = mc[3];
    }

    // Also support [1] [00:00 - 00:10] prefix pattern
    if (!startStr) {
      const tagPrefixMatch = line.match(/^(\[[123]\])\s*\[\s*([\d:.]+)\s*-\s*([\d:.]+)\s*\](.*)$/);
      if (tagPrefixMatch) {
        startStr = tagPrefixMatch[2];
        endStr = tagPrefixMatch[3];
        inlineLyric = tagPrefixMatch[1] + ' ' + tagPrefixMatch[4];
      }
    }

    if (startStr && endStr) {
      const startSec = timeStrToSeconds(startStr);
      const endSec = timeStrToSeconds(endStr);
      let lyric = (inlineLyric || '').trim();

      // Look at next line if lyric wasn't on the same line
      if (!lyric && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (!nextLine.match(patternBracket) && !nextLine.match(patternComma)) {
          lyric = nextLine;
          i++;
        }
      }

      if (lyric) {
        let colorMode = 1;
        const colorMatch = lyric.match(/\[([123])\]/);
        if (colorMatch) {
          colorMode = parseInt(colorMatch[1], 10);
          lyric = lyric.replace(/\[[123]\]/, '').trim();
        }

        rawSegments.push({
          start: startSec,
          end: endSec,
          text: lyric,
          colorMode: colorMode,
          words: assignProportionalWordTimings(lyric, startSec, endSec)
        });
      }
    }
    i++;
  }

  if (rawSegments.length === 0) {
    return [];
  }

  // --- ANTI-OVERLAP 5-SECTION SLOT OVERLAP PREVENTION LOGIC ---
  // Step 1: Assign initial appear / disappear times
  for (const seg of rawSegments) {
    seg.appear = Math.max(0.0, seg.start - 2.0);
    seg.disappear = Math.max(seg.end, seg.start + 2.0) + 1.5;
  }

  // Step 2: Strictly enforce boundaries so lines in the SAME slot never overlap
  for (let idx = 3; idx < rawSegments.length; idx++) {
    const prevIdx = idx - 3;
    if (rawSegments[prevIdx].disappear > rawSegments[idx].appear) {
      const safeMid = (rawSegments[prevIdx].end + rawSegments[idx].start) / 2.0;
      rawSegments[prevIdx].disappear = safeMid;
      rawSegments[idx].appear = safeMid;
    }
  }

  // Step 3: Compute slot assignments (0, 1, 2)
  for (let idx = 0; idx < rawSegments.length; idx++) {
    rawSegments[idx].slot = idx % 3;
    rawSegments[idx].yPos = SLOT_Y_POSITIONS[idx % 3];
  }

  return rawSegments;
}

// ==========================================
// 5. ASS SUBTITLE GENERATOR
// ==========================================
function generateAssSubtitle() {
  const fontName = 'Noto Sans, Arial, sans-serif';
  const fontSize = parseInt(state.fontSize, 10);
  const assC1 = hexToAssColor(state.color1);
  const assC2 = hexToAssColor(state.color2);
  const assC3 = hexToAssColor(state.color3);

  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke1,${fontName},${fontSize},${assC1},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,3,5,0,0,0,1
Style: Karaoke2,${fontName},${fontSize},${assC2},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,3,5,0,0,0,1
Style: Karaoke3,${fontName},${fontSize},${assC3},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,3,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (let i = 0; i < state.segments.length; i++) {
    const seg = state.segments[i];
    const singingStart = seg.start;
    const startStr = formatAssTime(seg.appear);
    const endStr = formatAssTime(seg.disappear);

    const slot = i % 3;
    const yPos = 324 + (slot * 216);
    const posTag = `{\\pos(960,${yPos})}`;

    const initialGapCs = Math.round((singingStart - seg.appear) * 100);
    let textToDisplay = initialGapCs > 0 ? `{\\k${initialGapCs}}` : '';

    let curTime = singingStart;
    for (const wInfo of seg.words) {
      const wStart = wInfo.start;
      const wEnd = wInfo.end || (curTime + 0.1);
      const wText = (wInfo.word || '').trim();
      if (!wText) continue;

      const gapDurationCs = Math.round((wStart - curTime) * 100);
      if (gapDurationCs > 0) {
        textToDisplay += `{\\k${gapDurationCs}}`;
      }

      const wordDurationCs = Math.round((wEnd - wStart) * 100);
      textToDisplay += `{\\kf${wordDurationCs}}${wText} `;
      curTime = wEnd;
    }

    const styleName = `Karaoke${seg.colorMode || 1}`;
    ass += `Dialogue: 0,${startStr},${endStr},${styleName},,0,0,0,,${posTag}${textToDisplay}\n`;
  }

  return ass;
}

// ==========================================
// 6. REAL-TIME CANVAS KARAOKE RENDERER
// ==========================================
function renderCanvasFrame(t) {
  // Clear canvas to clean black background (no divider lines)
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Find currently active segments for slots
  const activeSegments = state.segments.filter(seg => t >= seg.appear && t <= seg.disappear);

  // Group active segments by slot (0, 1, 2)
  const slotActive = [null, null, null];
  for (const seg of activeSegments) {
    slotActive[seg.slot] = seg;
  }

  // Render text for each active slot
  for (let slot = 0; slot < 3; slot++) {
    const seg = slotActive[slot];
    if (!seg) continue;

    const yPos = seg.yPos; // 324, 540, 756
    const singerColor = seg.colorMode === 1 ? state.color1 :
                        seg.colorMode === 2 ? state.color2 : state.color3;

    renderKaraokeLine(seg, t, yPos, singerColor);
  }

  // Update slot indicator in UI
  const activeSlotsStr = slotActive.map((s, idx) => s ? `Slot ${idx}: Active` : `Slot ${idx}: Idle`).join(' | ');
  dom.slotIndicator.textContent = activeSlotsStr;
}

/**
 * Renders a single line with precise progressive word-by-word karaoke sweep
 */
function renderKaraokeLine(seg, t, yPos, singerColor) {
  const words = seg.words || [];
  if (words.length === 0) return;

  const fontSize = parseInt(state.fontSize, 10);
  ctx.font = `bold ${fontSize}px "Outfit", "Noto Sans", Arial, sans-serif`;
  ctx.textBaseline = 'middle';

  // Measure total line width to center at x = 960
  const spaceWidth = ctx.measureText(' ').width;
  const wordMetrics = words.map(w => ({
    text: w.word,
    width: ctx.measureText(w.word).width,
    start: w.start,
    end: w.end
  }));

  const totalLineWidth = wordMetrics.reduce((acc, m) => acc + m.width, 0) + (wordMetrics.length - 1) * spaceWidth;
  let currentX = (CANVAS_WIDTH - totalLineWidth) / 2;

  // Render each word
  for (let idx = 0; idx < wordMetrics.length; idx++) {
    const wm = wordMetrics[idx];
    const wordWidth = wm.width;

    // Draw shadow first
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;

    // Word outline (stroke)
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(4, fontSize * 0.08);
    ctx.lineJoin = 'round';
    ctx.strokeText(wm.text, currentX, yPos);
    ctx.restore();

    // Determine sweep fill:
    // Case 1: Word not sung yet (t < w_start) -> Pure White
    // Case 2: Word already completely sung (t >= w_end) -> Pure Singer Color
    // Case 3: Word actively being sung (w_start <= t < w_end) -> Progressive Gradient Sweep
    if (t < wm.start) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(wm.text, currentX, yPos);
    } else if (t >= wm.end) {
      ctx.fillStyle = singerColor;
      ctx.fillText(wm.text, currentX, yPos);
    } else {
      // Calculate active sweep ratio [0.0 to 1.0]
      const ratio = Math.max(0, Math.min(1, (t - wm.start) / Math.max(0.001, wm.end - wm.start)));
      const splitX = currentX + wordWidth * ratio;

      // Create crisp clip gradient to transition from singer color to white across the word
      const gradient = ctx.createLinearGradient(currentX, 0, currentX + wordWidth, 0);
      gradient.addColorStop(0, singerColor);
      gradient.addColorStop(ratio, singerColor);
      gradient.addColorStop(Math.min(1, ratio + 0.001), '#FFFFFF');
      gradient.addColorStop(1, '#FFFFFF');

      ctx.fillStyle = gradient;
      ctx.fillText(wm.text, currentX, yPos);
    }

    currentX += wordWidth + spaceWidth;
  }
}

// ==========================================
// 7. ANIMATION & PLAYBACK LOOP
// ==========================================
function animationLoop() {
  if (state.isPlaying && state.audioElement) {
    state.currentTime = state.audioElement.currentTime;
    dom.timeScrubber.value = state.currentTime;
    updateTimeDisplay();
  }

  // Render canvas frame at current time
  renderCanvasFrame(state.currentTime);

  requestAnimationFrame(animationLoop);
}

function updateTimeDisplay() {
  const cur = state.currentTime;
  const total = state.audioDuration || 0;
  dom.timeDisplay.textContent = `${formatDisplayTime(cur)} / ${formatDisplayTime(total)}`;
}

// ==========================================
// 8. AUDIO HANDLING
// ==========================================
function loadAudioFile(file) {
  state.audioFile = file;
  const objectUrl = URL.createObjectURL(file);
  state.audioElement.src = objectUrl;

  dom.audioFilename.textContent = file.name;
  dom.dropzonePrompt.style.display = 'none';
  dom.audioLoadedCard.style.display = 'flex';

  state.audioElement.onloadedmetadata = () => {
    state.audioDuration = state.audioElement.duration;
    dom.audioDuration.textContent = formatDisplayTime(state.audioDuration);
    dom.timeScrubber.max = state.audioDuration;
    updateTimeDisplay();
    renderCanvasFrame(0);
  };
}

function togglePlay() {
  if (!state.audioElement.src) {
    alert('Please upload an audio track or click "Load Sample Song" first.');
    return;
  }

  if (state.isPlaying) {
    state.audioElement.pause();
    state.isPlaying = false;
    dom.playIcon.style.display = 'block';
    dom.pauseIcon.style.display = 'none';
  } else {
    // Resume AudioContext if suspended
    if (state.audioContext && state.audioContext.state === 'suspended') {
      state.audioContext.resume();
    }
    state.audioElement.play();
    state.isPlaying = true;
    dom.playIcon.style.display = 'none';
    dom.pauseIcon.style.display = 'block';
  }
}

// ==========================================
// 9. TAP TO SYNC LOGIC
// ==========================================
function setupTapSync() {
  const text = dom.lyricsTextarea.value.trim();
  const rawLines = text.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('[Script') && !l.startsWith('Style:'));

  state.tapSyncLines = [];
  for (const line of rawLines) {
    let clean = line.replace(/^\[\s*[\d:.]+\s*-\s*[\d:.]+\s*\]/, '').trim();
    clean = clean.replace(/^[\d:.]+\s*,\s*[\d:.]+/, '').trim();
    if (clean) {
      state.tapSyncLines.push({
        text: clean,
        start: null,
        end: null
      });
    }
  }

  state.tapSyncIndex = 0;
  renderTapSyncList();
}

function renderTapSyncList() {
  if (state.tapSyncLines.length === 0) {
    dom.tapSyncLinesList.innerHTML = '<p class="placeholder-text">Enter raw lyrics in the Text Editor first, then switch here to tap-sync them.</p>';
    return;
  }

  dom.tapSyncLinesList.innerHTML = '';
  state.tapSyncLines.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = `tap-line-item ${idx === state.tapSyncIndex ? 'active' : ''} ${item.start !== null ? 'synced' : ''}`;
    const timeStr = item.start !== null ? `[${formatDisplayTime(item.start)} - ${formatDisplayTime(item.end || item.start + 3)}]` : '[Not set]';
    div.innerHTML = `<span>${item.text}</span><span style="font-family: var(--font-mono); color: #00ffff;">${timeStr}</span>`;
    dom.tapSyncLinesList.appendChild(div);
  });
}

function markTapSyncLine() {
  if (state.tapSyncIndex >= state.tapSyncLines.length) {
    alert('All lines have been synchronized! Exporting to Text Editor.');
    applyTapSyncToEditor();
    return;
  }

  const curT = state.currentTime;
  const item = state.tapSyncLines[state.tapSyncIndex];

  if (item.start === null) {
    item.start = curT;
    dom.btnTapSyncAction.innerHTML = '<span>⏱️ Mark End of Line</span>';
    renderTapSyncList();
  } else {
    item.end = curT;
    state.tapSyncIndex++;
    dom.btnTapSyncAction.innerHTML = '<span>⏱️ Mark Start of Line</span>';
    renderTapSyncList();

    if (state.tapSyncIndex >= state.tapSyncLines.length) {
      applyTapSyncToEditor();
    }
  }
}

function applyTapSyncToEditor() {
  let output = '';
  state.tapSyncLines.forEach((item, idx) => {
    const s = formatDisplayTime(item.start || idx * 4);
    const e = formatDisplayTime(item.end || (item.start || idx * 4) + 3.5);
    const tag = item.text.includes('[2]') ? '' : item.text.includes('[3]') ? '' : '[1] ';
    output += `${tag}[${s} - ${e}] ${item.text}\n`;
  });
  dom.lyricsTextarea.value = output.trim();
  parseAndUpdateLyrics();
  dom.tabEditor.click();
}

// ==========================================
// 10. LIVE PLAYBACK & VIDEO RENDERER
// (Plays the entire video live on canvas from 00:00 to end,
// and provides the download button upon completion)
// ==========================================
async function renderVideoLive() {
  if (!state.audioElement.src) {
    alert('Please upload an audio file first or click "Load Sample Song".');
    return;
  }
  if (state.segments.length === 0) {
    alert('Please add lyrics with timestamps before rendering.');
    return;
  }

  state.isRendering = true;
  if (dom.btnRenderLive) dom.btnRenderLive.disabled = true;
  if (dom.btnRenderUniversal) dom.btnRenderUniversal.disabled = true;
  if (dom.downloadBanner) dom.downloadBanner.style.display = 'none';

  // 1. Show progress card & initialize
  dom.renderProgressCard.style.display = 'flex';
  dom.renderStatusText.textContent = '🎬 Rendering video live while playing...';
  dom.renderPercentageText.textContent = '0%';
  dom.progressBarFill.style.width = '0%';
  dom.renderEta.textContent = 'Playing canvas sweeps live. Download button will appear on completion.';

  // 2. Scroll canvas stage smoothly into view so user can watch the whole video playing
  dom.stageWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // 3. Setup WebAudio capture
  if (!state.audioContext) {
    try {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      state.audioSourceNode = state.audioContext.createMediaElementSource(state.audioElement);
      state.mediaStreamDestination = state.audioContext.createMediaStreamDestination();
      state.audioSourceNode.connect(state.audioContext.destination);
      state.audioSourceNode.connect(state.mediaStreamDestination);
    } catch (e) {
      console.warn('AudioContext setup:', e);
    }
  }
  if (state.audioContext && state.audioContext.state === 'suspended') {
    try {
      await state.audioContext.resume();
    } catch (e) {}
  }

  // 4. Setup in-browser canvas recording to capture the EXACT live preview with lyrics
  let recorderStream = null;
  try {
    const canvasStream = dom.canvas.captureStream(30);
    const audioTracks = state.mediaStreamDestination ? state.mediaStreamDestination.stream.getAudioTracks() : [];
    recorderStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
  } catch (e) {
    console.warn('Stream capture:', e);
  }

  let mimeType = 'video/webm;codecs=vp9,opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp8,opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
  if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';

  state.recordedChunks = [];
  if (recorderStream && window.MediaRecorder) {
    try {
      state.mediaRecorder = new MediaRecorder(recorderStream, {
        mimeType,
        videoBitsPerSecond: 8000000
      });
      state.mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) state.recordedChunks.push(e.data);
      };
      state.mediaRecorder.start(250);
    } catch (e) {
      console.warn('MediaRecorder start:', e);
    }
  }

  // 5. Start playback from the beginning (00:00) so user watches the full video
  state.audioElement.currentTime = 0;
  state.audioElement.playbackRate = 1.0;
  try {
    await state.audioElement.play();
  } catch (e) {
    console.warn('Audio play:', e);
  }
  state.isPlaying = true;
  dom.playIcon.style.display = 'none';
  dom.pauseIcon.style.display = 'block';

  const duration = state.audioDuration || state.audioElement.duration || 30;
  let isFinalized = false;

  const finalizeRender = async () => {
    if (isFinalized) return;
    isFinalized = true;
    clearInterval(progressInterval);

    state.audioElement.pause();
    state.isPlaying = false;
    dom.playIcon.style.display = 'block';
    dom.pauseIcon.style.display = 'none';

    // Wait for recorder to stop and flush all canvas frames
    if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
      await new Promise(resolve => {
        state.mediaRecorder.onstop = () => resolve();
        try {
          state.mediaRecorder.stop();
        } catch (e) {
          resolve();
        }
      });
    }

    dom.renderPercentageText.textContent = '100%';
    dom.progressBarFill.style.width = '100%';
    dom.renderStatusText.textContent = '⚡ Finalizing canvas video output...';
    dom.renderEta.textContent = 'Processing exact canvas lyrics and sweeps...';

    // Build recorded video blob directly from the live canvas frames
    const recordedBlob = new Blob(state.recordedChunks, { type: mimeType });
    let finalVideoUrl = null;
    let isUniversalMp4 = false;

    // If server FFmpeg is available, convert recorded canvas video to universal H.264 MP4 with faststart
    if (state.ffmpegAvailable && recordedBlob.size > 0) {
      try {
        dom.renderStatusText.textContent = '🎬 Generating Universal MP4 (iPhone, Android, PC & TV)...';
        const videoBase64 = await readFileAsBase64(recordedBlob);
        const resp = await fetch('/api/convert-recording', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoBase64: videoBase64,
            mimeType: mimeType
          })
        });
        const res = await resp.json();
        if (res.success && res.downloadUrl) {
          finalVideoUrl = res.downloadUrl;
          isUniversalMp4 = true;
        }
      } catch (err) {
        console.warn('Canvas conversion to MP4 error, using recorded blob:', err);
      }
    }

    // Fallback directly to recorded blob if server conversion was not used
    if (!finalVideoUrl) {
      finalVideoUrl = URL.createObjectURL(recordedBlob);
      isUniversalMp4 = mimeType.includes('mp4');
    }

    const baseName = state.audioFile ? state.audioFile.name.replace(/\.[^/.]+$/, '') : 'duet_song';
    const ext = isUniversalMp4 ? 'mp4' : 'webm';
    const filename = `${baseName}_duet_karaoke_1080p.${ext}`;

    // Reveal download banner (NO forced auto-download)
    dom.renderProgressCard.style.display = 'none';
    dom.downloadBanner.style.display = 'flex';
    if (dom.downloadFilenameSub) {
      dom.downloadFilenameSub.textContent = `Rendering complete for "${filename}"! Exactly as seen in the Live Canvas Preview. Click below to download.`;
    }

    // Provide the download button
    dom.btnDownloadVideo.href = finalVideoUrl;
    dom.btnDownloadVideo.download = filename;
    dom.btnDownloadVideo.style.display = 'inline-flex';

    // Populate preview player
    if (dom.renderedVideoPlayer && dom.renderedVideoWrapper) {
      dom.renderedVideoPlayer.src = finalVideoUrl;
      dom.renderedVideoWrapper.style.display = 'block';
      dom.renderedVideoPlayer.load();
    }

    // Smoothly scroll down so user immediately sees the download button
    dom.downloadBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (dom.btnRenderLive) dom.btnRenderLive.disabled = false;
    if (dom.btnRenderUniversal) dom.btnRenderUniversal.disabled = false;
    state.isRendering = false;
  };

  const progressInterval = setInterval(() => {
    const cur = state.audioElement.currentTime;
    const pct = Math.min(99, Math.round((cur / Math.max(duration, 1)) * 100));
    dom.renderPercentageText.textContent = `${pct}%`;
    dom.progressBarFill.style.width = `${pct}%`;
    dom.renderEta.textContent = `Playing & Rendering: ${formatDisplayTime(cur)} of ${formatDisplayTime(duration)} (Download button will appear on finish)`;

    if (state.audioElement.ended || cur >= duration - 0.15) {
      finalizeRender();
    }
  }, 200);

  // Early finish button
  if (dom.btnCancelRender) {
    dom.btnCancelRender.onclick = () => finalizeRender();
  }
}

// Backward compatibility alias
const renderVideoInBrowser = renderVideoLive;

// ==========================================
// 11. DIRECT SERVER-SIDE FFMPEG RENDER (FAST)
// ==========================================
async function renderVideoWithFfmpeg() {
  if (!state.ffmpegAvailable) {
    alert('FFmpeg was not detected on the server. Please install FFmpeg (via install_ffmpeg.bat) or use "Render & Watch Live Video".');
    return;
  }
  if (!state.audioFile) {
    alert('Please upload an audio file first.');
    return;
  }
  if (state.segments.length === 0) {
    alert('Please add lyrics with timestamps before rendering.');
    return;
  }

  dom.renderProgressCard.style.display = 'flex';
  dom.renderStatusText.textContent = '🎬 Generating Universal MP4 (iPhone, iPad, Android, Tab, Laptop & TV compatible)...';
  dom.renderPercentageText.textContent = 'Encoding H.264 High 4.1 + Faststart...';
  dom.progressBarFill.style.width = '65%';
  dom.renderEta.textContent = 'Rendering directly via server FFmpeg... Download button will be provided on completion.';

  try {
    const base64Audio = await readFileAsBase64(state.audioFile);
    const assText = generateAssSubtitle();
    const ext = state.audioFile.name.split('.').pop() || 'mp3';

    const resp = await fetch('/api/render-ffmpeg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: base64Audio,
        audioExt: ext,
        assContent: assText
      })
    });

    const res = await resp.json();
    dom.renderProgressCard.style.display = 'none';

    if (res.success && res.downloadUrl) {
      const baseName = state.audioFile ? state.audioFile.name.replace(/\.[^/.]+$/, '') : 'duet_song';
      const filename = `${baseName}_universal_1080p.mp4`;

      // Setup download banner & provide download button (NO forced auto-download popup)
      dom.downloadBanner.style.display = 'flex';
      if (dom.downloadFilenameSub) {
        dom.downloadFilenameSub.textContent = `Ready: ${filename} (100% playable on Mobile, Laptop, Tab, TV & WhatsApp). Click below to download.`;
      }
      dom.btnDownloadVideo.href = res.downloadUrl;
      dom.btnDownloadVideo.download = filename;
      dom.btnDownloadVideo.style.display = 'inline-flex';

      // Populate preview video player
      if (dom.renderedVideoPlayer && dom.renderedVideoWrapper) {
        dom.renderedVideoPlayer.src = res.downloadUrl;
        dom.renderedVideoWrapper.style.display = 'block';
        dom.renderedVideoPlayer.load();
      }

      dom.downloadBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      alert('FFmpeg render error: ' + (res.error || 'Unknown error'));
    }
  } catch (err) {
    dom.renderProgressCard.style.display = 'none';
    alert('Server communication error: ' + err.message);
  }
}

// ==========================================
// 12. SAMPLE SONG GENERATOR
// ==========================================
function loadSampleDuet() {
  // 1. Generate pleasant musical audio tone track in memory using WebAudio
  const sampleDuration = 22; // 22 seconds
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const sampleRate = audioCtx.sampleRate;
  const numFrames = sampleRate * sampleDuration;
  const audioBuf = audioCtx.createBuffer(2, numFrames, sampleRate);

  const leftChannel = audioBuf.getChannelData(0);
  const rightChannel = audioBuf.getChannelData(1);

  // Synthesize chord progression with arpeggios
  const chords = [
    [261.63, 329.63, 392.00], // C major
    [220.00, 261.63, 329.63], // A minor
    [174.61, 220.00, 261.63], // F major
    [196.00, 246.94, 293.66]  // G major
  ];

  for (let i = 0; i < numFrames; i++) {
    const t = i / sampleRate;
    const chordIndex = Math.floor(t / 4) % chords.length;
    const chord = chords[chordIndex];
    let sample = 0;
    for (const freq of chord) {
      sample += Math.sin(2 * Math.PI * freq * t) * 0.12;
    }
    // Subtle beat pulse
    const beat = Math.exp(-((t * 2) % 1) * 8) * 0.2;
    sample += beat * Math.sin(2 * Math.PI * 110 * t);

    leftChannel[i] = sample;
    rightChannel[i] = sample;
  }

  // Convert buffer to WAV Blob
  const wavBlob = audioBufferToWav(audioBuf);
  const sampleFile = new File([wavBlob], 'duet_sample_track.wav', { type: 'audio/wav' });
  loadAudioFile(sampleFile);

  // 2. Set sample lyrics
  dom.lyricsTextarea.value = `[1] [00:01.00 - 00:05.50] I hear the rhythm call across the starlit sky
[2] [00:06.00 - 00:10.80] And in the quiet night I hear your sweet reply
[3] [00:11.50 - 00:18.00] Together our voices rise in perfect harmony as one
[1] [00:18.50 - 00:21.50] The melody lives on forevermore`;

  parseAndUpdateLyrics();
}

// Convert Web Audio buffer to 16-bit PCM WAV Blob
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}

// ==========================================
// 13. UI EVENT LISTENERS
// ==========================================
function parseAndUpdateLyrics() {
  const text = dom.lyricsTextarea.value;
  state.lyricsRaw = text;
  state.segments = parseManualTimestamps(text);
  dom.parsedCountBadge.textContent = `${state.segments.length} lines parsed`;
  renderCanvasFrame(state.currentTime);
}

function initEventListeners() {
  // Audio upload events
  dom.audioDropzone.addEventListener('click', () => dom.audioFileInput.click());
  dom.audioFileInput.addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) {
      loadAudioFile(e.target.files[0]);
    }
  });

  dom.audioDropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dom.audioDropzone.classList.add('dragover');
  });
  dom.audioDropzone.addEventListener('dragleave', () => {
    dom.audioDropzone.classList.remove('dragover');
  });
  dom.audioDropzone.addEventListener('drop', e => {
    e.preventDefault();
    dom.audioDropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadAudioFile(e.dataTransfer.files[0]);
    }
  });

  dom.btnRemoveAudio.addEventListener('click', e => {
    e.stopPropagation();
    state.audioElement.pause();
    state.isPlaying = false;
    state.audioFile = null;
    state.audioElement.src = '';
    dom.audioLoadedCard.style.display = 'none';
    dom.dropzonePrompt.style.display = 'flex';
    dom.playIcon.style.display = 'block';
    dom.pauseIcon.style.display = 'none';
    state.currentTime = 0;
    updateTimeDisplay();
  });

  // Player controls
  dom.btnPlayPause.addEventListener('click', togglePlay);
  dom.timeScrubber.addEventListener('input', e => {
    state.currentTime = parseFloat(e.target.value);
    state.audioElement.currentTime = state.currentTime;
    updateTimeDisplay();
    renderCanvasFrame(state.currentTime);
  });

  dom.playbackSpeed.addEventListener('change', e => {
    state.playbackRate = parseFloat(e.target.value);
    state.audioElement.playbackRate = state.playbackRate;
  });

  // Color inputs
  dom.color1.addEventListener('input', e => {
    state.color1 = e.target.value;
    dom.color1Hex.value = e.target.value;
    renderCanvasFrame(state.currentTime);
  });
  dom.color1Hex.addEventListener('input', e => {
    if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
      state.color1 = e.target.value;
      dom.color1.value = e.target.value;
      renderCanvasFrame(state.currentTime);
    }
  });

  dom.color2.addEventListener('input', e => {
    state.color2 = e.target.value;
    dom.color2Hex.value = e.target.value;
    renderCanvasFrame(state.currentTime);
  });
  dom.color2Hex.addEventListener('input', e => {
    if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
      state.color2 = e.target.value;
      dom.color2.value = e.target.value;
      renderCanvasFrame(state.currentTime);
    }
  });

  dom.color3.addEventListener('input', e => {
    state.color3 = e.target.value;
    dom.color3Hex.value = e.target.value;
    renderCanvasFrame(state.currentTime);
  });
  dom.color3Hex.addEventListener('input', e => {
    if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
      state.color3 = e.target.value;
      dom.color3.value = e.target.value;
      renderCanvasFrame(state.currentTime);
    }
  });

  // Font size slider
  dom.fontSizeSlider.addEventListener('input', e => {
    state.fontSize = parseInt(e.target.value, 10);
    dom.fontSizeVal.textContent = `${state.fontSize}px`;
    renderCanvasFrame(state.currentTime);
  });

  // Lyrics text area
  dom.lyricsTextarea.addEventListener('input', parseAndUpdateLyrics);
  dom.btnFormatCheck.addEventListener('click', parseAndUpdateLyrics);

  // Quick tag insert buttons
  document.querySelectorAll('.tag-insert-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.getAttribute('data-tag');
      const start = dom.lyricsTextarea.selectionStart;
      const end = dom.lyricsTextarea.selectionEnd;
      const val = dom.lyricsTextarea.value;
      dom.lyricsTextarea.value = val.substring(0, start) + tag + ' ' + val.substring(end);
      dom.lyricsTextarea.focus();
      dom.lyricsTextarea.setSelectionRange(start + tag.length + 1, start + tag.length + 1);
      parseAndUpdateLyrics();
    });
  });

  // Mode tabs (Editor vs Tap-to-Sync)
  dom.tabEditor.addEventListener('click', () => {
    dom.tabEditor.classList.add('active');
    dom.tabTapSync.classList.remove('active');
    dom.paneEditor.classList.add('active');
    dom.paneTapSync.classList.remove('active');
  });

  dom.tabTapSync.addEventListener('click', () => {
    dom.tabTapSync.classList.add('active');
    dom.tabEditor.classList.remove('active');
    dom.paneTapSync.classList.add('active');
    dom.paneEditor.classList.remove('active');
    setupTapSync();
  });

  dom.btnTapSyncAction.addEventListener('click', markTapSyncLine);
  dom.btnTapSyncReset.addEventListener('click', setupTapSync);

  // Canvas guides toggle
  dom.chkShowGuides.addEventListener('change', e => {
    dom.canvasGuide.style.display = e.target.checked ? 'block' : 'none';
  });

  // Fullscreen preview
  dom.btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      dom.stageWrapper.requestFullscreen().catch(err => alert(err.message));
    } else {
      document.exitFullscreen();
    }
  });

  // Export buttons
  dom.btnExportAss.addEventListener('click', () => {
    const assContent = generateAssSubtitle();
    const blob = new Blob([assContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'duet_karaoke.ass';
    a.click();
  });

  if (dom.btnRenderLive) dom.btnRenderLive.addEventListener('click', renderVideoInBrowser);
  if (dom.btnRenderUniversal) dom.btnRenderUniversal.addEventListener('click', renderVideoWithFfmpeg);
  if (dom.btnRenderBrowser) dom.btnRenderBrowser.addEventListener('click', renderVideoInBrowser);
  if (dom.btnRenderFfmpeg) dom.btnRenderFfmpeg.addEventListener('click', renderVideoWithFfmpeg);

  // Load sample button
  dom.btnLoadSample.addEventListener('click', loadSampleDuet);

  // Syntax help modal
  document.querySelector('.syntax-info').addEventListener('click', () => {
    dom.syntaxModal.style.display = 'flex';
  });
  dom.btnCloseSyntax.addEventListener('click', () => {
    dom.syntaxModal.style.display = 'none';
  });
  dom.btnSyntaxOk.addEventListener('click', () => {
    dom.syntaxModal.style.display = 'none';
  });

  // Global spacebar shortcut for play/pause or tap-sync
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      if (dom.paneTapSync.classList.contains('active')) {
        markTapSyncLine();
      } else {
        togglePlay();
      }
    }
  });
}

// ==========================================
// 14. INITIALIZATION & STATUS CHECK
// ==========================================
async function checkServerStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.status === 'ok') {
      state.ffmpegAvailable = data.ffmpegAvailable;
      if (data.ffmpegAvailable) {
        dom.engineStatus.textContent = 'Universal MP4 Engine Ready (All Devices)';
        dom.ffmpegDesc.textContent = 'Hardware H.264 High 4.1 + AAC + Faststart. 100% playable on mobile, laptop, tab, TV & WhatsApp.';
      } else {
        dom.engineStatus.textContent = 'Browser Engine Ready (Lite)';
        dom.ffmpegDesc.textContent = 'FFmpeg not detected. Use in-browser 1080p render or run install_ffmpeg.bat.';
      }
    }
  } catch (err) {
    // Running statically or offline without server
    dom.engineStatus.textContent = 'Standalone Browser Engine Ready';
    dom.ffmpegDesc.textContent = 'Running standalone. Use In-Browser 1080p Video render.';
  }
}

// Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  checkServerStatus();
  loadSampleDuet(); // Pre-populate with high quality duet sample
  animationLoop();
});
