// Tiny synthesized sounds, so there are no audio files to license.
import { soundOn } from './storage';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!soundOn()) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  // iOS starts the context suspended until a user gesture.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, duration: number, volume: number, type: OscillatorType = 'sine') {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** Call from a pointer handler so iOS unlocks audio. */
export function unlockAudio(): void {
  audio();
}

export function playSnap(): void {
  tone(520, 0, 0.12, 0.18, 'triangle');
  tone(780, 0.03, 0.1, 0.08, 'sine');
}

export function playPickup(): void {
  tone(330, 0, 0.06, 0.05, 'sine');
}

export function playFinish(): void {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.14, 0.6, 0.15, 'triangle'));
}

export function playMiss(): void {
  tone(220, 0, 0.18, 0.1, 'sine');
}
