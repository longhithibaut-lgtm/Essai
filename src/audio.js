// Ambiance sonore générée en direct (aucun fichier audio) :
// nappe douce d'accords, vent qui suit la vitesse, pas, carillons.

const CHORDS = [
  [261.63, 329.63, 392.0, 493.88], // Cmaj7
  [220.0, 261.63, 329.63, 392.0], // Am7
  [174.61, 220.0, 261.63, 329.63], // Fmaj7
  [196.0, 246.94, 293.66, 392.0], // G
];
const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    this.chordIndex = 0;
    this.nextChordAt = 0;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    // Réverbération synthétique
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.2, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.8;
    this.dry.connect(this.master);

    // Nappe
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.11;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 1100;
    this.padBus.connect(padFilter);
    padFilter.connect(this.reverb);
    padFilter.connect(this.dry);

    // Vent
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(4);
    noise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.02;
    noise.connect(this.windFilter).connect(this.windGain).connect(this.master);
    noise.start();

    this.nextChordAt = ctx.currentTime + 0.1;
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02; // bruit brun, doux
      d[i] = last * 3.5;
    }
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _playChord(t) {
    const ctx = this.ctx;
    const chord = CHORDS[this.chordIndex % CHORDS.length];
    this.chordIndex++;
    const dur = 9;
    chord.forEach((f, i) => {
      for (const detune of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = f / (i === 0 ? 2 : 1);
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.18 / chord.length, t + 3);
        g.gain.linearRampToValueAtTime(0.14 / chord.length, t + dur - 3);
        g.gain.linearRampToValueAtTime(0, t + dur + 1.5);
        o.connect(g).connect(this.padBus);
        o.start(t);
        o.stop(t + dur + 2);
      }
    });
  }

  update(speed, mode) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (t >= this.nextChordAt - 0.05) {
      this._playChord(this.nextChordAt);
      this.nextChordAt += 7.5;
    }
    const k = Math.min(1, speed / 14);
    const airy = mode === 'air' || mode === 'wallrun' ? 1 : 0.6;
    this.windGain.gain.setTargetAtTime(0.015 + k * k * 0.12 * airy, t, 0.25);
    this.windFilter.frequency.setTargetAtTime(380 + k * 900, t, 0.3);
  }

  _thump(freq, gain, dur, type = 'sine') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.5), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.dry);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _tick(freq, gain, dur) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    if (!this._clickBuf) {
      this._clickBuf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
      const d = this._clickBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
    }
    src.buffer = this._clickBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.dry);
    src.start(t);
  }

  step(wall = false) {
    this._tick(wall ? 900 : 700 + Math.random() * 300, wall ? 0.12 : 0.09, 0.08);
  }

  jump() {
    this._tick(1200, 0.06, 0.12);
  }

  land(impact) {
    const k = Math.min(1, impact / 14);
    this._thump(110, 0.08 + k * 0.25, 0.18 + k * 0.1);
    this._tick(500, 0.05 + k * 0.15, 0.15);
  }

  slide() {
    this._tick(350, 0.1, 0.4);
  }

  chime(index = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const f = PENTA[index % PENTA.length];
    for (const [mult, amp] of [[1, 0.12], [2.01, 0.04], [3.02, 0.02]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4 / mult);
      o.connect(g);
      g.connect(this.reverb);
      g.connect(this.dry);
      o.start(t);
      o.stop(t + 2.6);
    }
  }

  bell() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [f, amp, d] of [[196, 0.2, 7], [392.5, 0.1, 5], [588, 0.06, 4], [785, 0.04, 3], [1046, 0.03, 2]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g);
      g.connect(this.reverb);
      g.connect(this.dry);
      o.start(t);
      o.stop(t + d + 0.1);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.1);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }
}
