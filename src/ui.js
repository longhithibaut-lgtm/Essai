// Écrans et HUD (DOM par-dessus le canvas).

const BASE_SENSITIVITY = 0.0022;

function load(key, fallback) {
  try {
    const v = localStorage.getItem('aube.' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem('aube.' + key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : on continue sans */
  }
}

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

export class UI {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'),
      title: $('title'),
      pause: $('pause'),
      end: $('end'),
      start: $('start-btn'),
      loading: $('loading'),
      resume: $('resume-btn'),
      restart: $('restart-btn'),
      again: $('again-btn'),
      sens: $('sens'),
      vol: $('vol'),
      orbCount: $('orb-count'),
      orbs: document.querySelector('.orbs'),
      orbTotal: document.querySelector('.orb-total'),
      hint: $('hint'),
      endTime: $('end-time'),
      endOrbs: $('end-orbs'),
      endBest: $('end-best'),
      touchNote: $('touch-note'),
    };
    this.hintTimer = 0;

    const sens = load('sensitivity', 1);
    const vol = load('volume', 0.8);
    this.el.sens.value = sens;
    this.el.vol.value = vol;
    game.input.sensitivity = BASE_SENSITIVITY * sens;
    game.audio.setVolume(vol);

    this.el.start.addEventListener('click', () => game.start());
    this.el.resume.addEventListener('click', () => game.resume());
    this.el.restart.addEventListener('click', () => game.restart());
    this.el.again.addEventListener('click', () => game.restart());
    this.el.sens.addEventListener('input', () => {
      const v = parseFloat(this.el.sens.value);
      game.input.sensitivity = BASE_SENSITIVITY * v;
      save('sensitivity', v);
    });
    this.el.vol.addEventListener('input', () => {
      const v = parseFloat(this.el.vol.value);
      game.audio.setVolume(v);
      save('volume', v);
    });

    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) {
      this.el.touchNote.hidden = false;
    }
  }

  ready() {
    this.el.loading.hidden = true;
    this.el.start.disabled = false;
  }

  screen(name) {
    this.el.title.hidden = name !== 'title';
    this.el.pause.hidden = name !== 'pause';
    this.el.end.hidden = name !== 'end';
    this.el.hud.hidden = !(name === 'play' || name === 'pause');
  }

  setOrbs(n, total) {
    this.el.orbCount.textContent = n;
    this.el.orbTotal.textContent = `/ ${total}`;
    this.el.orbs.classList.remove('pulse');
    void this.el.orbs.offsetWidth;
    this.el.orbs.classList.add('pulse');
  }

  showHint(html, duration = 4.5) {
    this.el.hint.innerHTML = html;
    this.el.hint.classList.add('show');
    this.hintTimer = duration;
  }

  update(dt) {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.el.hint.classList.remove('show');
    }
  }

  showEnd(time, orbs, total) {
    const best = load('best', null);
    const isBest = best === null || time < best;
    if (isBest) save('best', time);
    this.el.endTime.textContent = formatTime(time);
    this.el.endOrbs.textContent = `${orbs} / ${total}`;
    this.el.endBest.textContent = isBest ? 'Meilleur temps' : `Meilleur temps : ${formatTime(best)}`;
    this.screen('end');
  }
}
