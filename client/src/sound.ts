// Small procedural sound effects via WebAudio — no audio assets to bundle or
// license. Everything is a handful of oscillator/gain nodes shaped into a
// short envelope. Muted state persists in localStorage.

const MUTE_KEY = "op_muted";

let ctx: AudioContext | null = null;
let muted = localStorage.getItem(MUTE_KEY) === "1";

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Must be called from within a user-gesture handler (click/tap) the first
// time, or the browser will refuse to start the AudioContext.
export function unlockAudio() {
  getCtx();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;
  localStorage.setItem(MUTE_KEY, next ? "1" : "0");
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

interface Tone {
  freq: number;
  start: number; // seconds from now
  duration: number; // seconds
  type?: OscillatorType;
  gain?: number;
}

function playTones(tones: Tone[]) {
  if (muted) return;
  const audio = getCtx();
  if (!audio) return;
  const now = audio.currentTime;
  for (const t of tones) {
    const osc = audio.createOscillator();
    const gainNode = audio.createGain();
    osc.type = t.type ?? "sine";
    osc.frequency.value = t.freq;
    const peak = t.gain ?? 0.12;
    const startAt = now + t.start;
    const endAt = startAt + t.duration;
    gainNode.gain.setValueAtTime(0, startAt);
    gainNode.gain.linearRampToValueAtTime(
      peak,
      startAt + Math.min(0.02, t.duration / 4),
    );
    gainNode.gain.exponentialRampToValueAtTime(0.001, endAt);
    osc.connect(gainNode).connect(audio.destination);
    osc.start(startAt);
    osc.stop(endAt + 0.02);
  }
}

export const sound = {
  travel() {
    playTones([
      { freq: 420, start: 0, duration: 0.09, type: "triangle", gain: 0.06 },
    ]);
  },
  action() {
    playTones([
      { freq: 520, start: 0, duration: 0.06, type: "triangle", gain: 0.05 },
    ]);
  },
  infection() {
    playTones([
      { freq: 300, start: 0, duration: 0.12, type: "sine", gain: 0.07 },
    ]);
  },
  outbreak() {
    playTones([
      { freq: 220, start: 0, duration: 0.18, type: "sawtooth", gain: 0.12 },
      { freq: 165, start: 0.12, duration: 0.22, type: "sawtooth", gain: 0.12 },
    ]);
  },
  epidemic() {
    playTones([
      { freq: 180, start: 0, duration: 0.25, type: "square", gain: 0.09 },
      { freq: 140, start: 0.1, duration: 0.3, type: "square", gain: 0.09 },
    ]);
  },
  cure() {
    playTones([
      { freq: 523.25, start: 0, duration: 0.14, type: "sine", gain: 0.08 },
      { freq: 659.25, start: 0.1, duration: 0.14, type: "sine", gain: 0.08 },
      { freq: 783.99, start: 0.2, duration: 0.22, type: "sine", gain: 0.09 },
    ]);
  },
  win() {
    playTones([
      { freq: 523.25, start: 0, duration: 0.16, type: "triangle", gain: 0.1 },
      {
        freq: 659.25,
        start: 0.14,
        duration: 0.16,
        type: "triangle",
        gain: 0.1,
      },
      {
        freq: 783.99,
        start: 0.28,
        duration: 0.16,
        type: "triangle",
        gain: 0.1,
      },
      {
        freq: 1046.5,
        start: 0.42,
        duration: 0.32,
        type: "triangle",
        gain: 0.12,
      },
    ]);
  },
  lose() {
    playTones([
      { freq: 220, start: 0, duration: 0.3, type: "sawtooth", gain: 0.1 },
      { freq: 196, start: 0.22, duration: 0.3, type: "sawtooth", gain: 0.1 },
      { freq: 174.6, start: 0.44, duration: 0.5, type: "sawtooth", gain: 0.1 },
    ]);
  },
};