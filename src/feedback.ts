// Snap and win feedback: a short synthesized click and a small vibration,
// each switchable in settings. Sounds are generated with Web Audio, so there
// are no audio files to download.

import { settings } from './prefs';

let audio: AudioContext | null = null;

/** Browsers only allow audio after a user gesture; call from one. */
export function unlockAudio() {
  if (!settings.sound) return;
  audio ??= new AudioContext();
  if (audio.state === 'suspended') void audio.resume();
}

function tone(
  freq: number,
  start: number,
  length: number,
  volume: number,
  type: OscillatorType = 'sine',
  glide = 1,
) {
  const ctx = audio!;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * glide, t + length);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

/** A soft wooden "click" made of a short noise burst and a low thunk. */
function click() {
  const ctx = audio!;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.03);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2400;
  filter.Q.value = 1.2;
  const gain = ctx.createGain();
  gain.gain.value = 0.5;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t);
  tone(420, 0, 0.06, 0.25, 'sine', 0.6);
}

function canPlay() {
  return settings.sound && audio !== null && audio.state === 'running';
}

export function vibrate(pattern: number | number[]) {
  if (settings.vibration) navigator.vibrate?.(pattern);
}

/** Plays the snap sound once audio is running, e.g. right after enabling it. */
export function previewSound() {
  unlockAudio();
  void audio?.resume().then(() => canPlay() && click());
}

export function snapFeedback() {
  vibrate(15);
  if (canPlay()) click();
}

export function winFeedback() {
  vibrate([30, 60, 30, 60, 80]);
  if (!canPlay()) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.11, 0.5, 0.18, 'triangle'));
}
