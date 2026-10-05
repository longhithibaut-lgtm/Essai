// Ambiance sonore générée en direct (aucun fichier audio).
//
// - Musique : une nappe chaude en Ré majeur qui respire lentement (quatre accords
//   de dix secondes), une basse ronde, et un célesta qui égrène des notes
//   pentatoniques, plus nombreuses quand on court. Un voile aigu s'ajoute à mesure
//   qu'on cueille des lueurs.
// - Ambiance : vent qui souffle par rafales, souffle de vitesse, oiseaux lointains.
// - Effets : pas doux et alternés, saut, réception, glissade, accents musicaux sur
//   les murs, carillons des lueurs (des phrases qui montent sans jamais crier),
//   cloche d'arrivée, sons d'interface, souffle et arpège au moment de partir.
// - Scènes : sur le titre et la fin, le célesta se raréfie et l'air du large
//   souffle un peu plus ; en jeu, la musique suit l'élan.
//
// Tout passe par un compresseur doux : rien ne sature, rien ne surprend.

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

const CHORD_LEN = 10; // secondes par accord
const SLOT = 60 / 76 / 2; // une croche à 76 battements par minute

// Ré maj9, Si m9, Sol maj7, La add9 : une boucle qui ne se résout jamais vraiment.
const CHORDS = [
  { bass: 38, pad: [50, 57, 61, 64, 66] },
  { bass: 35, pad: [47, 54, 57, 61, 62] },
  { bass: 43, pad: [50, 55, 59, 62, 66] },
  { bass: 45, pad: [52, 57, 59, 61, 64] },
];
for (const c of CHORDS) c.pcs = new Set(c.pad.map((m) => m % 12));

// Ré majeur pentatonique (ré mi fa# la si), du la4 au fa#6.
const SCALE = [69, 71, 74, 76, 78, 81, 83, 86, 88, 90];
// Carillons des lueurs : la même gamme, du ré5 au fa#6. Une série de lueurs
// cueillies coup sur coup monte d'un degré à chaque fois, puis la phrase repart
// d'une note de l'accord : jamais de suraigu, même avec beaucoup de lueurs.
const CHIMES = [74, 76, 78, 81, 83, 86, 88, 90];
const CHIME_PHRASE = 4.5; // secondes : au-delà, une nouvelle phrase commence

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    this.musicVolume = 0.8;
    this.sfxVolume = 0.9;
    this.paused = false;
    this.progress = 0;
    this.energy = 0;
    this.speedK = 0;
    this.mode = 'ground';
    this.outro = false;
    this.scene = 'title';
    this._foot = 1;
    this._chimeIdx = -1;
    this._lastChime = -99;
  }

  start(ctxOverride) {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC && !ctxOverride) return;
    try {
      this.ctx = ctxOverride || new AC({ latencyHint: 'interactive' });
    } catch {
      this.ctx = null;
      return;
    }
    this._build();
  }

  // ---------- Graphe ----------

  _build() {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 14;
    comp.ratio.value = 3;
    comp.attack.value = 0.012;
    comp.release.value = 0.35;
    comp.connect(ctx.destination);

    // Étouffé pendant la pause (comme sous une couverture)
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.5;
    this.muffle.connect(comp);

    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0, t);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : this.volume, t + 2.5);
    this.master.connect(this.muffle);

    // Réverbération : une grande salle claire, aiguës amorties
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(4.2);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.85;
    this.reverb.connect(revOut).connect(this.master);

    // Bus musique et effets (chacun avec son envoi vers la réverbération)
    this.music = ctx.createGain();
    this.music.gain.value = this.musicVolume * 1.4;
    this.music.connect(this.master);
    const musicSend = ctx.createGain();
    musicSend.gain.value = 0.5;
    this.music.connect(musicSend).connect(this.reverb);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVolume;
    this.sfx.connect(this.master);
    const sfxSend = ctx.createGain();
    sfxSend.gain.value = 0.14;
    this.sfx.connect(sfxSend).connect(this.reverb);

    // Bus « lointain » : presque entièrement réverbéré (oiseaux, cloche)
    this.far = ctx.createGain();
    this.far.gain.value = this.sfxVolume;
    this.far.connect(this.reverb);
    const farDry = ctx.createGain();
    farDry.gain.value = 0.22;
    this.far.connect(farDry).connect(this.master);

    // Écho en ping-pong pour le célesta et les carillons
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.34;
    const dl = ctx.createDelay(2);
    const dr = ctx.createDelay(2);
    dl.delayTime.value = SLOT * 3;
    dr.delayTime.value = SLOT * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    const merger = ctx.createChannelMerger(2);
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.55;
    this.delaySend.connect(dl);
    dl.connect(merger, 0, 0);
    dl.connect(dr);
    dr.connect(merger, 0, 1);
    dr.connect(damp).connect(fb).connect(dl);
    merger.connect(delayOut).connect(this.music);

    // Nappe : un filtre qui s'ouvre avec l'élan et respire lentement
    this.wave = this._warmWave();
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 1;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 850;
    this.padFilter.Q.value = 0.5;
    this.padBus.connect(this.padFilter).connect(this.music);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 220;
    lfo.connect(lfoDepth).connect(this.padFilter.frequency);
    lfo.start(t);

    // Voile aigu, qui grandit avec les lueurs cueillies
    this.shimmer = ctx.createGain();
    this.shimmer.gain.value = 0;
    const trem = ctx.createGain();
    trem.gain.value = 0.7;
    const tremLfo = ctx.createOscillator();
    tremLfo.frequency.value = 0.23;
    const tremDepth = ctx.createGain();
    tremDepth.gain.value = 0.3;
    tremLfo.connect(tremDepth).connect(trem.gain);
    tremLfo.start(t);
    this.shimmer.connect(trem).connect(this.music);
    trem.connect(this.delaySend);

    // Bruits partagés
    this.white = this._whiteBuffer(1.5);
    const brown = this._brownBuffer(6);

    // Vent ambiant : rafales lentes, qui passent d'une oreille à l'autre
    const wind = ctx.createBufferSource();
    wind.buffer = brown;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.55;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.03;
    this.windPan = ctx.createStereoPanner();
    // Pas de grondement sous 150 Hz : du vent, pas une pression dans les oreilles
    const windHp = ctx.createBiquadFilter();
    windHp.type = 'highpass';
    windHp.frequency.value = 150;
    windHp.Q.value = 0.7;
    wind.connect(windHp).connect(this.windFilter).connect(this.windGain).connect(this.windPan).connect(this.sfx);
    wind.start(t);

    // Souffle de vitesse
    const rush = ctx.createBufferSource();
    rush.buffer = brown;
    rush.loop = true;
    rush.playbackRate.value = 1.7;
    this.rushFilter = ctx.createBiquadFilter();
    this.rushFilter.type = 'bandpass';
    this.rushFilter.frequency.value = 700;
    this.rushFilter.Q.value = 0.7;
    this.rushGain = ctx.createGain();
    this.rushGain.gain.value = 0;
    const rushHp = ctx.createBiquadFilter();
    rushHp.type = 'highpass';
    rushHp.frequency.value = 260;
    rushHp.Q.value = 0.7;
    rush.connect(rushHp).connect(this.rushFilter).connect(this.rushGain).connect(this.sfx);
    rush.start(t, 2.3);

    this.chordIdx = 0;
    this.chord = CHORDS[0];
    this.nextChordAt = t + 0.15;
    this.nextSlot = t + 1.2;
    this.slotIdx = 0;
    this.melIdx = 4;
    this.rest = 0;
    this.nextGust = t + 1;
    this.nextBird = t + rand(3, 6);
    this.nextParam = 0;
    this._lastT = t;
  }

  _warmWave() {
    const n = 10;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = (k % 2 ? 1 : 0.55) / Math.pow(k, 1.7);
    return this.ctx.createPeriodicWave(real, imag);
  }

  _whiteBuffer(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _brownBuffer(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
      // Raccord sans clic à la boucle
      const fade = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        d[i] *= k;
        d[len - 1 - i] *= k;
      }
    }
    return buf;
  }

  _impulse(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const x = i / len;
        // Les aiguës s'éteignent plus vite que les graves
        const a = 0.55 - 0.45 * x;
        lp += a * ((Math.random() * 2 - 1) - lp);
        const pre = Math.min(1, i / (ctx.sampleRate * 0.012));
        d[i] = lp * Math.pow(1 - x, 2.6) * pre * 1.6;
      }
    }
    return buf;
  }

  // ---------- Petites briques ----------

  _env(g, t, peak, attack, tau) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + attack, tau);
  }

  _noise(t, dur, { type = 'bandpass', freq = 1000, q = 0.8, gain = 0.05, attack = 0.004, tau = 0.03, pan = 0, dest = this.sfx, sweep = 0 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t, gain, attack, tau);
    let out = g;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    out.connect(dest);
    src.connect(f).connect(g);
    src.start(t, Math.random() * Math.max(0, this.white.duration - dur - 0.1));
    src.stop(t + dur + 0.05);
  }

  _thump(t, freq, gain, dur, pan = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.5), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.009);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Célesta : sinus modulé en fréquence, attaque claire qui s'adoucit aussitôt.
  _pluck(t, m, gain, pan = 0, dest = this.music, ratio = 2, echo = true) {
    const ctx = this.ctx;
    const f = midi(m);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * ratio;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(f * 1.3, t);
    depth.gain.setTargetAtTime(0, t, 0.09);
    mod.connect(depth).connect(car.frequency);
    const g = ctx.createGain();
    this._env(g, t, gain, 0.005, 0.55);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    car.connect(g).connect(p).connect(dest);
    if (echo) p.connect(this.delaySend);
    car.start(t);
    mod.start(t);
    car.stop(t + 3.2);
    mod.stop(t + 3.2);
  }

  // Petit bruit d'oiseau : un sifflement glissé
  _syllable(t, f0, f1, dur, gain, out) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.015, dur * 0.3));
    g.gain.setValueAtTime(gain, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // ---------- Musique ----------

  _chord(t) {
    const ctx = this.ctx;
    const c = CHORDS[this.chordIdx % CHORDS.length];
    this.chordIdx++;
    this.chord = c;
    const end = t + CHORD_LEN + 9;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.0105, t + 4);
    env.gain.setValueAtTime(0.0105, t + CHORD_LEN);
    env.gain.setTargetAtTime(0, t + CHORD_LEN, 1.7);
    env.connect(this.padBus);
    c.pad.forEach((m, i) => {
      for (const detune of [-7, 6]) {
        const o = ctx.createOscillator();
        o.setPeriodicWave(this.wave);
        o.frequency.value = midi(m);
        o.detune.value = detune + (i % 2 ? 2 : -2);
        o.connect(env);
        o.start(t);
        o.stop(end);
      }
    });

    // Basse ronde
    const bEnv = ctx.createGain();
    bEnv.gain.setValueAtTime(0, t);
    bEnv.gain.linearRampToValueAtTime(0.032, t + 3);
    bEnv.gain.setValueAtTime(0.032, t + CHORD_LEN);
    bEnv.gain.setTargetAtTime(0, t + CHORD_LEN, 1.5);
    bEnv.connect(this.music);
    for (const [mult, amp] of [[1, 1], [2, 0.3]]) {
      const o = ctx.createOscillator();
      o.frequency.value = midi(c.bass) * mult;
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g).connect(bEnv);
      o.start(t);
      o.stop(end);
    }

    // Voile aigu : les deux notes hautes de l'accord, deux octaves plus haut
    const sEnv = ctx.createGain();
    sEnv.gain.setValueAtTime(0, t);
    sEnv.gain.linearRampToValueAtTime(0.012, t + 5);
    sEnv.gain.setValueAtTime(0.012, t + CHORD_LEN);
    sEnv.gain.setTargetAtTime(0, t + CHORD_LEN, 2);
    sEnv.connect(this.shimmer);
    for (const m of c.pad.slice(-2)) {
      const o = ctx.createOscillator();
      o.frequency.value = midi(m + 24);
      o.connect(sEnv);
      o.start(t);
      o.stop(end);
    }
  }

  _slot(t) {
    const s = this.slotIdx++;
    const beat = s % 8;
    if (this.rest > 0) {
      this.rest--;
      return;
    }
    let p = 0.08 + this.energy * 0.4 + this.progress * 0.06;
    // Sur le titre, le célesta se fait rare : on écoute surtout le vent et la nappe.
    if (this.scene === 'title') p *= 0.75;
    if (beat % 2 === 1) p *= 0.55;
    if (beat === 0) p += 0.08;
    if (this.paused) p *= 0.35;
    if (this.outro) p *= 0.45;
    if (Math.random() > p) return;

    // Marche aléatoire dans la gamme, attirée vers le milieu
    let step = pick([-2, -1, -1, 1, 1, 2]);
    if (this.melIdx <= 1) step = Math.abs(step);
    if (this.melIdx >= SCALE.length - 2) step = -Math.abs(step);
    this.melIdx = Math.max(0, Math.min(SCALE.length - 1, this.melIdx + step));
    // Sur les temps forts, une note de l'accord
    if (beat === 0 || beat === 4) {
      for (let d = 0; d < SCALE.length; d++) {
        const up = this.melIdx + d, down = this.melIdx - d;
        if (up < SCALE.length && this.chord.pcs.has(SCALE[up] % 12)) { this.melIdx = up; break; }
        if (down >= 0 && this.chord.pcs.has(SCALE[down] % 12)) { this.melIdx = down; break; }
      }
    }
    const m = SCALE[this.melIdx];
    const pan = rand(-0.45, 0.45);
    this._pluck(t, m, rand(0.036, 0.052), pan);
    if (this.energy > 0.45 && Math.random() < 0.22 && this.melIdx >= 2) {
      this._pluck(t + 0.012, SCALE[this.melIdx - 2], 0.022, -pan, this.music, 2, false);
    }
    if (Math.random() < 0.1) this.rest = 3 + ((Math.random() * 4) | 0);
  }

  // ---------- Ambiance ----------

  _bird(t) {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.85, 0.85);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    pan.connect(lp).connect(this.far);
    const g = rand(0.012, 0.022) * (1 - this.speedK * 0.5);
    const kind = Math.random();
    if (kind < 0.4) {
      // Pépiements
      const n = 2 + ((Math.random() * 3) | 0);
      const f = rand(2900, 3700);
      for (let i = 0; i < n; i++) this._syllable(t + i * rand(0.11, 0.15), f, f * rand(1.2, 1.4), rand(0.05, 0.07), g, pan);
    } else if (kind < 0.75) {
      // Sifflement à deux notes, comme une grive au loin
      const f = rand(2100, 2700);
      this._syllable(t, f, f * 1.06, 0.2, g, pan);
      this._syllable(t + 0.27, f * 0.84, f * 0.78, 0.3, g * 0.9, pan);
      if (Math.random() < 0.5) this._syllable(t + 0.66, f * 1.12, f * 1.02, 0.16, g * 0.7, pan);
    } else {
      // Trille légère
      const n = 6 + ((Math.random() * 6) | 0);
      const f = rand(3300, 3900);
      for (let i = 0; i < n; i++) this._syllable(t + i * 0.062, i % 2 ? f * 0.9 : f, i % 2 ? f * 0.86 : f * 1.04, 0.045, g * (1 - i / (n * 1.6)), pan);
    }
  }

  // ---------- Boucle (appelée à chaque image) ----------

  update(speed, mode) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const dt = Math.min(0.25, Math.max(0, now - this._lastT));
    this._lastT = now;

    if (mode !== this.mode) {
      this._onMode(this.mode, mode, now);
      this.mode = mode;
    }

    const target = this.paused ? 0 : Math.min(1, speed / 11);
    this.energy += (target - this.energy) * Math.min(1, dt * 0.6);
    const airy = mode === 'air' || mode === 'wallrun' ? 1 : 0.65;
    this.speedK += (Math.min(1, speed / 14) * airy - this.speedK) * Math.min(1, dt * 5);

    // Après un long silence (onglet caché), on reprend sans rattraper le retard.
    if (this.nextChordAt < now - 2) this.nextChordAt = now + 0.1;
    if (this.nextSlot < now - 0.5) this.nextSlot = now + 0.05;
    if (this.nextBird < now - 5) this.nextBird = now + rand(2, 6);
    while (this.nextChordAt < now + 0.3) {
      this._chord(this.nextChordAt);
      this.nextChordAt += CHORD_LEN;
    }
    while (this.nextSlot < now + 0.15) {
      this._slot(this.nextSlot);
      this.nextSlot += SLOT;
    }

    if (now >= this.nextParam) {
      this.nextParam = now + 0.1;
      const k = this.speedK;
      this.rushGain.gain.setTargetAtTime(this.paused ? 0 : k * k * 0.16, now, 0.2);
      this.rushFilter.frequency.setTargetAtTime(500 + k * 1300, now, 0.25);
      this.padFilter.frequency.setTargetAtTime(800 + this.energy * 1100 + this.progress * 300, now, 1.2);
      this.shimmer.gain.setTargetAtTime(0.25 + this.progress * 0.9, now, 2);
    }

    if (now >= this.nextGust) {
      this.nextGust = now + rand(1.8, 4.5);
      const airy = this.scene === 'play' ? 1 : 1.35; // l'air du large, sur le titre et la fin
      this.windGain.gain.setTargetAtTime(rand(0.05, 0.12) * airy, now, rand(0.8, 1.6));
      this.windFilter.frequency.setTargetAtTime(rand(300, 650), now, 1.5);
      this.windPan.pan.setTargetAtTime(rand(-0.6, 0.6), now, 2.5);
    }

    if (now >= this.nextBird) {
      this.nextBird = now + rand(4.5, 12);
      if (!this.paused) {
        this._bird(now + 0.05);
        if (Math.random() < 0.35) this._bird(now + rand(0.9, 1.6));
      }
    }

    if (this._slideVoice && mode !== 'slide') this._stopSlide(now);
  }

  _onMode(prev, next, t) {
    if (prev === 'slide') this._stopSlide(t);
    if (next === 'wallrun') this._accent(t, 3, 0.03);
    else if (next === 'climb') this._accent(t, 2, 0.024);
  }

  // Petit arpège ascendant dans l'accord du moment : la musique salue le geste.
  _accent(t, count, gain) {
    if (this.paused) return;
    const tones = SCALE.filter((m) => this.chord.pcs.has(m % 12) && m >= 76);
    const start = (Math.random() * Math.max(1, tones.length - count)) | 0;
    for (let i = 0; i < count; i++) {
      const m = tones[Math.min(tones.length - 1, start + i)];
      this._pluck(t + i * 0.075, m, gain * (1 - i * 0.15), -0.3 + i * 0.3, this.sfx, 3.01);
    }
    this._noise(t, 0.5, { freq: 1800, sweep: 3200, q: 0.6, gain: 0.018, attack: 0.12, tau: 0.12 });
  }

  _stopSlide(t) {
    const v = this._slideVoice;
    if (!v) return;
    this._slideVoice = null;
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setTargetAtTime(0, t, 0.08);
    v.src.stop(t + 0.5);
  }

  // ---------- Effets (appelés par le jeu) ----------

  step(wall = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._foot = -this._foot;
    const pan = this._foot * 0.14;
    const k = (0.55 + 0.45 * this.speedK) * 1.4;
    if (wall) {
      this._thump(t, rand(120, 150), 0.07 * k, 0.09, pan);
      this._noise(t, 0.08, { freq: rand(1300, 1700), q: 1.1, gain: 0.035 * k, attack: 0.008, tau: 0.022, pan });
    } else {
      this._thump(t, rand(78, 96), 0.1 * k, 0.11, pan);
      this._noise(t, 0.1, { freq: rand(950, 1350), q: 0.9, gain: 0.04 * k, attack: 0.008, tau: 0.026, pan });
    }
  }

  jump() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.28, { type: 'bandpass', freq: 380, sweep: 1500, q: 0.7, gain: 0.045, attack: 0.03, tau: 0.07 });
    this._thump(t, 70, 0.04, 0.08);
  }

  land(impact) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, impact / 14);
    this._thump(t, 92 - k * 20, 0.09 + k * 0.17, 0.16 + k * 0.1);
    this._noise(t, 0.25, { type: 'lowpass', freq: 700 + k * 600, q: 0.6, gain: 0.035 + k * 0.08, tau: 0.04 + k * 0.04 });
  }

  slide() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this._stopSlide(t);
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(520, t + 1.2);
    f.Q.value = 0.6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.05);
    g.gain.setTargetAtTime(0.03, t + 0.1, 0.4);
    g.gain.setTargetAtTime(0, t + 1.6, 0.2);
    src.connect(f).connect(lp).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + 2.5);
    this._slideVoice = { src, g };
    this._thump(t, 80, 0.05, 0.12);
  }

  chime(index = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (t - this._lastChime < CHIME_PHRASE && this._chimeIdx >= 0 && this._chimeIdx < CHIMES.length - 1) {
      this._chimeIdx++;
    } else {
      // Nouvelle phrase : une note de l'accord du moment, dans le bas de la gamme.
      this._chimeIdx = 0;
      for (let j = 0; j < 4; j++) {
        if (this.chord.pcs.has(CHIMES[j] % 12)) { this._chimeIdx = j; break; }
      }
    }
    this._lastChime = t;
    const m = CHIMES[this._chimeIdx];
    // Un carillon de verre, puis sa quinte, plus douce
    this._pluck(t, m, 0.075, -0.15, this.sfx, 3.5);
    this._pluck(t + 0.004, m + 12, 0.02, 0.2, this.sfx, 2, false);
    const next = SCALE[Math.min(SCALE.length - 1, Math.max(0, SCALE.indexOf(m)) + 2)];
    this._pluck(t + 0.16, next, 0.04, 0.25, this.sfx, 3.5);
    this._noise(t, 0.4, { type: 'highpass', freq: 6000, q: 0.4, gain: 0.006, attack: 0.01, tau: 0.12, dest: this.far });
  }

  // Arrivée dans un nouveau lieu : une note grave et ronde, comme un souffle
  place() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const root = this.chord.bass + 24;
    this._pluck(t, root, 0.03, -0.2, this.music, 1, true);
    this._pluck(t + 0.22, root + 7, 0.022, 0.2, this.music, 1, true);
  }

  // La cloche d'arrivée : partiels inharmoniques d'une vraie cloche, longue résonance.
  bell() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const f0 = midi(62); // ré4
    const partials = [
      [0.5, 0.14, 11], [0.502, 0.05, 10], [1, 0.15, 8], [1.003, 0.05, 7],
      [1.19, 0.07, 6], [1.5, 0.05, 5], [2, 0.09, 4.5], [2.52, 0.035, 3.2],
      [3.01, 0.03, 2.6], [4.17, 0.015, 1.8], [5.43, 0.008, 1.2],
    ];
    const out = ctx.createGain();
    out.gain.value = 0.42;
    out.connect(this.sfx);
    out.connect(this.far);
    for (const [r, amp, d] of partials) {
      const o = ctx.createOscillator();
      o.frequency.value = f0 * r;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.006);
      g.gain.setTargetAtTime(0, t + 0.006, d / 4.5);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + d + 0.5);
    }
    this._noise(t, 0.06, { freq: 2400, q: 0.8, gain: 0.04, tau: 0.012 });
    this.outro = true;
    // Un arpège qui se résout, quand la cloche s'est un peu tue
    [62, 66, 69, 74, 78].forEach((m, i) => this._pluck(t + 2.6 + i * 0.32, m + 12, 0.03 - i * 0.003, -0.4 + i * 0.2, this.music, 2));
  }

  // Chute dans les nuages : un souffle qui descend, puis deux notes rassurantes
  respawn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 1.0, { freq: 1500, sweep: 260, q: 0.7, gain: 0.05, attack: 0.25, tau: 0.25 });
    const root = this.chord.bass + 24;
    this._pluck(t + 0.6, root, 0.03, -0.2, this.music, 1);
    this._pluck(t + 0.85, root + 7, 0.026, 0.2, this.music, 1);
  }

  // ---------- Interface ----------

  uiHover() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._pluck(t, 93, 0.008, 0, this.sfx, 1, false);
  }

  uiSelect() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._pluck(t, 81, 0.03, -0.15, this.sfx, 2);
    this._pluck(t + 0.07, 86, 0.026, 0.15, this.sfx, 2);
  }

  // « Commencer » : un souffle qui monte avec le voile de lumière, et un arpège
  // de l'accord de ré qui s'ouvre, comme une porte sur le matin.
  uiStart() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 1.6, { freq: 380, sweep: 2600, q: 0.6, gain: 0.03, attack: 0.55, tau: 0.45, dest: this.far });
    [62, 69, 74, 78, 81, 86].forEach((m, i) => this._pluck(t + 0.05 + i * 0.11, m, 0.034 - i * 0.003, -0.5 + i * 0.2, this.music, 2));
    this._thump(t + 0.02, 74, 0.035, 0.5);
  }

  uiBack() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._pluck(t, 81, 0.024, 0.1, this.sfx, 2);
    this._pluck(t + 0.07, 76, 0.02, -0.1, this.sfx, 2);
  }

  // ---------- Réglages et états ----------

  setPaused(p) {
    this.paused = p;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.muffle.frequency.setTargetAtTime(p ? 900 : 20000, t, p ? 0.18 : 0.3);
  }

  // Où en est le joueur : 'title', 'play' ou 'end'. Le mélange s'y adapte doucement.
  setScene(name) {
    this.scene = name;
  }

  setProgress(p) {
    this.progress = p;
    if (p === 0) this.outro = false;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(m ? 0 : this.volume, t, 0.1);
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(v, t, 0.1);
    }
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.music) this.music.gain.setTargetAtTime(v * 1.4, this.ctx.currentTime, 0.1);
  }

  setSfxVolume(v) {
    this.sfxVolume = v;
    if (this.sfx) {
      const t = this.ctx.currentTime;
      this.sfx.gain.setTargetAtTime(v, t, 0.1);
      this.far.gain.setTargetAtTime(v, t, 0.1);
    }
  }
}
