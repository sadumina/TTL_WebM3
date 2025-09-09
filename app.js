// ===============================
// VoiceOver App — TTS → MP3 (with Diagnostics)
// ===============================

const ta = document.getElementById('text');

const langFilter = document.getElementById('langFilter');
const voiceSelect = document.getElementById('voiceSelect');

const rate   = document.getElementById('rate');   const rateVal   = document.getElementById('rateVal');
const pitch  = document.getElementById('pitch');  const pitchVal  = document.getElementById('pitchVal');
const volume = document.getElementById('volume'); const volumeVal = document.getElementById('volumeVal');

const btnSpeak = document.getElementById('btnSpeak');
const btnPause = document.getElementById('btnPause');
const btnResume = document.getElementById('btnResume');
const btnStop   = document.getElementById('btnStop');
const speakStatus = document.getElementById('speakStatus');

const autoRecord      = document.getElementById('autoRecord');
const btnStartRec     = document.getElementById('btnStartRec');
const btnStopRec      = document.getElementById('btnStopRec');
const btnDownloadWebM = document.getElementById('btnDownloadWebM');
const btnConvertMp3   = document.getElementById('btnConvertMp3');
const recStatus       = document.getElementById('recStatus');
const downloads       = document.getElementById('downloads');

// --- tiny diagnostics UI (adds a block under #downloads) ---
const diag = document.createElement('pre');
diag.style.whiteSpace = 'pre-wrap';
diag.style.fontSize = '12px';
diag.style.opacity = '0.8';
diag.style.marginTop = '8px';
downloads.after(diag);
function setDiag(lines) { diag.textContent = lines.join('\n'); }

// -------------------- Voice Handling --------------------
let allVoices = [];
function populateVoices(filter = '') {
  const voices = speechSynthesis.getVoices();
  allVoices = voices;
  const langQuery = (filter || '').trim().toLowerCase();
  voiceSelect.innerHTML = '';

  const filtered = voices.filter(v => !langQuery || v.lang.toLowerCase().includes(langQuery));
  if (filtered.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'No voices match this filter';
    opt.disabled = true;
    voiceSelect.appendChild(opt);
    return;
  }

  filtered
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
    .forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.lang} — ${v.name}${v.default ? ' (default)' : ''}`;
      voiceSelect.appendChild(opt);
    });
}
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = () => populateVoices(langFilter.value);
}
window.addEventListener('load', () => populateVoices(''));

// Bind sliders
function bindSlider(slider, label) {
  const update = () => { label.textContent = Number(slider.value).toFixed(1); };
  slider.addEventListener('input', update);
  update();
}
bindSlider(rate, rateVal);
bindSlider(pitch, pitchVal);
bindSlider(volume, volumeVal);

// -------------------- TTS --------------------
let currentUtterance = null;
function getSelectedVoice() {
  const name = voiceSelect.value;
  return allVoices.find(v => v.name === name) || allVoices[0];
}
function speak() {
  const text = (ta.value || '').trim();
  if (!text) {
    speakStatus.textContent = 'Please enter some text.';
    return;
  }
  speechSynthesis.cancel();
  currentUtterance = new SpeechSynthesisUtterance(text);
  const v = getSelectedVoice();
  if (v) currentUtterance.voice = v;

  currentUtterance.rate = Number(rate.value);
  currentUtterance.pitch = Number(pitch.value);
  currentUtterance.volume = Number(volume.value);

  currentUtterance.onstart = async () => {
    speakStatus.textContent = `Speaking with ${v ? v.lang + ' — ' + v.name : 'selected voice'}...`;
    if (autoRecord.checked && !recording) {
      try {
        await startRecording();
      } catch (err) {
        console.error(err);
        recStatus.textContent = 'Could not start auto-recording. You may need to click "Start Recording" first.';
      }
    }
  };
  currentUtterance.onend = async () => {
    speakStatus.textContent = 'Done speaking.';
    if (autoRecord.checked && recording) {
      await stopRecording();
    }
  };
  currentUtterance.onerror = (e) => {
    console.error('Speech error:', e.error);
    speakStatus.textContent = 'Speech error: ' + e.error;
  };
  speechSynthesis.speak(currentUtterance);
}
function pauseSpeech() {
  if (speechSynthesis.speaking && !speechSynthesis.paused) {
    speechSynthesis.pause();
    speakStatus.textContent = 'Paused.';
  }
}
function resumeSpeech() {
  if (speechSynthesis.paused) {
    speechSynthesis.resume();
    speakStatus.textContent = 'Resumed.';
  }
}
function stopSpeech() {
  if (speechSynthesis.speaking || speechSynthesis.paused) {
    speechSynthesis.cancel();
    speakStatus.textContent = 'Stopped.';
  }
}

// -------------------- Recording (Tab Audio Only) --------------------
let captureStream = null;
let audioStream   = null;
let recorder      = null;
let recording     = false;
let recordedChunks= [];
let lastAudioBlob = null;

async function ensureCapture() {
  if (captureStream && captureStream.getTracks().some(t => t.readyState === 'live')) return;

  captureStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,   // needed to show "This Tab" option in some Chrome builds
    audio: true
  });

  const audioTracks = captureStream.getAudioTracks();
  if (!audioTracks || audioTracks.length === 0) {
    throw new Error('No audio track. In the picker, choose "This Tab" and tick "Share tab audio".');
  }
  audioStream = new MediaStream(audioTracks);
}

async function startRecording() {
  await ensureCapture();
  recordedChunks = [];
  lastAudioBlob = null;

  let options = { mimeType: 'audio/webm;codecs=opus' };
  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    options = { mimeType: 'audio/webm' };
  }

  recorder = new MediaRecorder(audioStream, options);
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
  recorder.onstop = () => {
    if (recordedChunks.length > 0) {
      lastAudioBlob = new Blob(recordedChunks, { type: options.mimeType });
      const kb = Math.round(lastAudioBlob.size/1024);
      btnDownloadWebM.disabled = false;
      btnConvertMp3.disabled = kb === 0;
      recStatus.textContent = kb === 0
        ? 'Saved 0 KB — no tab audio captured. Re-record with This Tab + Share tab audio.'
        : `Saved ${kb} KB — ready to download/convert.`;
    } else {
      recStatus.textContent = 'No audio captured.';
      btnConvertMp3.disabled = true;
    }
    updateDiag();
  };

  recorder.start(200);
  recording = true;
  btnStartRec.disabled = true;
  btnStopRec.disabled = false;
  btnDownloadWebM.disabled = true;
  btnConvertMp3.disabled = true;
  recStatus.textContent = 'Recording… (Tab audio only)';
  updateDiag();
}

async function stopRecording() {
  if (!recording || !recorder) return;
  recorder.stop();
  recording = false;
  btnStartRec.disabled = false;
  btnStopRec.disabled = true;

  if (captureStream) captureStream.getTracks().forEach(t => t.stop());
  captureStream = null;
  audioStream = null;
  updateDiag();
}

function downloadWebM() {
  if (!lastAudioBlob) return;
  const url = URL.createObjectURL(lastAudioBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `voiceover_${Date.now()}.webm`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// -------------------- FFmpeg MP3 Conversion (robust) --------------------
let ffmpeg = null;
let ffmpegStatus = 'not-initialized';

// If you downloaded ffmpeg.min.js locally, set these to './ffmpeg.min.js'.
// Otherwise, the UMD will load from CDN automatically.
const FFMPEG_UMD_URL      = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js';
const FFMPEG_UMD_URL_ALT  = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js';

// Use **local** core files (place them next to index.html)
const FFMPEG_CORE_URL     = './ffmpeg-core.js';
const FFMPEG_CORE_URL_ALT = './ffmpeg-core.js';

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (window.FFmpeg) return resolve();
    const existing = Array.from(document.getElementsByTagName('script')).find(s => s.src === src);
    if (existing) {
      if (existing.dataset._ffmpegLoaded === '1' || window.FFmpeg) return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.referrerPolicy = 'no-referrer';
    s.onload = () => { s.dataset._ffmpegLoaded = '1'; resolve(); };
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

async function ensureFFmpegScriptLoaded() {
  if (window.FFmpeg) return;
  try { await loadScriptOnce(FFMPEG_UMD_URL); }
  catch (_) { await loadScriptOnce(FFMPEG_UMD_URL_ALT); }
  let tries = 0;
  while (!window.FFmpeg) {
    if (tries++ > 100) throw new Error('FFmpeg UMD failed to attach.');
    await new Promise(r => setTimeout(r, 50));
  }
}

async function ensureFFmpeg() {
  if (ffmpeg) return ffmpeg;
  ffmpegStatus = 'loading';
  updateDiag();

  try {
    await ensureFFmpegScriptLoaded();
    ffmpegStatus = 'script-ready';
    updateDiag();
  } catch (e) {
    ffmpegStatus = 'script-failed';
    updateDiag();
    recStatus.textContent = 'Could not load FFmpeg library (network/CSP blocked).';
    throw e;
  }

  const { createFFmpeg, fetchFile } = window.FFmpeg;

  let lastErr;
  for (const core of [FFMPEG_CORE_URL, FFMPEG_CORE_URL_ALT]) {
    try {
      const inst = createFFmpeg({ log: false, corePath: core });
      await inst.load();
      inst._fetchFile = fetchFile;
      ffmpeg = inst;
      ffmpegStatus = 'ready';
      updateDiag();
      return ffmpeg;
    } catch (err) {
      lastErr = err;
      ffmpegStatus = 'core-failed-trying-next';
      updateDiag();
    }
  }
  ffmpegStatus = 'failed';
  updateDiag();
  throw lastErr || new Error('FFmpeg failed to load.');
}

async function convertToMp3() {
  if (!lastAudioBlob) {
    recStatus.textContent = 'Nothing to convert. Record something first.';
    return;
  }
  if (lastAudioBlob.size === 0) {
    recStatus.textContent = 'Recording was 0 KB (no tab audio). Re-record with This Tab + Share tab audio.';
    return;
  }

  recStatus.textContent = 'Converting to MP3… (runs in your browser)';
  btnConvertMp3.disabled = true;
  updateDiag();

  try {
    const ff = await ensureFFmpeg();
    const data = await ff._fetchFile(lastAudioBlob);

    const inName = 'in.webm';
    const outName = 'out.mp3';
    try { if (ff.FS('readdir', '/').includes(inName)) ff.FS('unlink', inName); } catch {}
    try { if (ff.FS('readdir', '/').includes(outName)) ff.FS('unlink', outName); } catch {}

    ff.FS('writeFile', inName, data);
    await ff.run('-i', inName, '-vn', '-ar', '48000', '-ac', '2', '-b:a', '192k', outName);

    const outData = ff.FS('readFile', outName);
    const mp3Blob = new Blob([outData.buffer], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(mp3Blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `voiceover_${Date.now()}.mp3`;
    document.body.appendChild(a);
    a.click();

    const link = document.createElement('a');
    link.href = url;
    link.download = a.download;
    link.textContent = 'Download MP3';
    link.className = 'download';
    downloads.innerHTML = '';
    downloads.appendChild(link);

    recStatus.textContent = `MP3 ready (${Math.round(mp3Blob.size/1024)} KB).`;
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  } catch (err) {
    console.error(err);
    recStatus.textContent = 'MP3 conversion failed. You can still download the WebM audio.';
  } finally {
    btnConvertMp3.disabled = false;
    updateDiag();
  }
}

// -------------------- Events --------------------
langFilter.addEventListener('input', () => populateVoices(langFilter.value));
btnSpeak.addEventListener('click', speak);
btnPause.addEventListener('click', pauseSpeech);
btnResume.addEventListener('click', resumeSpeech);
btnStop.addEventListener('click', stopSpeech);

btnStartRec.addEventListener('click', async () => {
  try { await startRecording(); } catch (e) {
    console.error(e);
    recStatus.textContent = e.message || 'Failed to start recording.';
  } finally { updateDiag(); }
});
btnStopRec.addEventListener('click', () => { stopRecording(); updateDiag(); });
btnDownloadWebM.addEventListener('click', downloadWebM);
btnConvertMp3.addEventListener('click', convertToMp3);

// // --- Diagnostics updater ---
// function updateDiag() {
//   const kb = lastAudioBlob ? Math.round(lastAudioBlob.size/1024) : 0;
//   const flags = [
//     `servedOverHTTP: ${location.protocol !== 'file:'}`,
//     `captureLive: ${!!(captureStream && captureStream.getTracks().some(t => t.readyState === 'live'))}`,
//     `recording: ${recording}`,
//     `chunks: ${recordedChunks.length}`,
//     `lastBlobKB: ${kb}`,
//     `ffmpegStatus: ${ffmpegStatus}`,
//     `mp3BtnDisabled: ${btnConvertMp3.disabled}`,
//   ];
//   setDiag(flags);
// }
// updateDiag();
