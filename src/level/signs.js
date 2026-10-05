import * as THREE from 'three';
import { Batch } from './kit.js';
import { K } from './surfaces.js';

// Plaques de rue émaillées et vieilles réclames peintes sur les murs pignons.
// Une seule texture (atlas dessiné au canevas), un seul appel de dessin.

const W = 1024, H = 1024;

// Régions de l'atlas (en pixels) : [x, y, w, h]
const REGIONS = {};

function drawAtlas() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  const serif = '"Cormorant Garamond", Georgia, "DejaVu Serif", serif';
  const sans = '"Nunito Sans", "DejaVu Sans", Arial, sans-serif';

  // Plaques émaillées bleues (style parisien)
  const plaques = [
    ['terrasse', 'TERRASSE', "DE L'AUBE"],
    ['lavandieres', 'RUELLE DES', 'LAVANDIÈRES'],
    ['bassin', 'JARDIN', 'DU BASSIN'],
    ['montee', 'MONTÉE', 'DE LA CLOCHE'],
    ['nuages', 'PASSAGE', 'DES NUAGES'],
  ];
  plaques.forEach(([id, l1, l2], i) => {
    const x = 16, y = 16 + i * 104, w = 360, h = 92;
    REGIONS[id] = [x, y, w, h];
    g.fillStyle = '#f4f1ea';
    roundRect(g, x, y, w, h, 14); g.fill();
    g.fillStyle = '#2d4f86';
    roundRect(g, x + 6, y + 6, w - 12, h - 12, 10); g.fill();
    g.strokeStyle = '#f4f1ea';
    g.lineWidth = 3;
    roundRect(g, x + 13, y + 13, w - 26, h - 26, 7); g.stroke();
    g.fillStyle = '#f4f1ea';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `600 22px ${sans}`;
    g.fillText(l1, x + w / 2, y + 34);
    g.font = `700 30px ${sans}`;
    g.fillText(l2, x + w / 2, y + 62);
  });

  // Réclames peintes, délavées (fond transparent, peinture irrégulière)
  const ghost = (id, x, y, w, h, draw) => {
    REGIONS[id] = [x, y, w, h];
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const t = tmp.getContext('2d');
    draw(t, w, h);
    // usure : on efface par petites touches
    let seed = 3 + x;
    const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    t.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i++) {
      t.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.35})`;
      t.beginPath();
      t.ellipse(r() * w, r() * h, 2 + r() * 10, 1 + r() * 4, r() * 3, 0, Math.PI * 2);
      t.fill();
    }
    g.globalAlpha = 0.82;
    g.drawImage(tmp, x, y);
    g.globalAlpha = 1;
  };
  ghost('savon', 400, 16, 600, 300, (t, w, h) => {
    t.fillStyle = '#d9a089';
    t.fillRect(0, 0, w, h);
    t.fillStyle = '#f6efe4';
    t.fillRect(14, 14, w - 28, h - 28);
    t.fillStyle = '#c4694f';
    t.textAlign = 'center';
    t.textBaseline = 'middle';
    t.font = `italic 500 46px ${serif}`;
    t.fillText('Savonnerie', w / 2, 72);
    t.font = `700 74px ${serif}`;
    t.fillText('DES NUAGES', w / 2, 146);
    t.fillStyle = '#7a8fb5';
    t.font = `600 26px ${sans}`;
    t.fillText('DOUX COMME LE MATIN  ·  DEPUIS 1921', w / 2, 222);
    t.strokeStyle = '#c4694f';
    t.lineWidth = 3;
    t.beginPath(); t.moveTo(80, 190); t.lineTo(w - 80, 190); t.stroke();
  });
  ghost('the', 400, 340, 600, 260, (t, w, h) => {
    t.fillStyle = '#9fb59a';
    t.fillRect(0, 0, w, h);
    t.fillStyle = '#f3ede0';
    t.textAlign = 'center';
    t.textBaseline = 'middle';
    t.font = `700 82px ${serif}`;
    t.fillText('THÉ DE L’AUBE', w / 2, 100);
    t.font = `italic 500 40px ${serif}`;
    t.fillText('infusé au premier rayon', w / 2, 178);
  });
  // Enseigne de café (lettres sur bandeau)
  REGIONS.cafe = [16, 560, 360, 80];
  g.fillStyle = '#3f5f55';
  roundRect(g, 16, 560, 360, 80, 8); g.fill();
  g.fillStyle = '#f4e9d4';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `italic 600 44px ${serif}`;
  g.fillText('Café des Toits', 16 + 180, 600);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export class Signs {
  constructor() {
    this.batch = new Batch();
    this.tex = drawAtlas();
  }

  // Panneau plaqué sur une façade. (nx, nz) : normale de la façade ; centre (x, y, z) ; largeur w (hauteur déduite du ratio).
  add(id, x, y, z, nx, nz, w) {
    const reg = REGIONS[id];
    if (!reg) return;
    const [rx, ry, rw, rh] = reg;
    const h = w * rh / rw;
    const tx = nz, tz = -nx; // vers la droite vu de face
    const off = 0.03;
    const px = x + nx * off, pz = z + nz * off;
    const u0 = rx / W, u1 = (rx + rw) / W;
    const v0 = 1 - (ry + rh) / H, v1 = 1 - ry / H;
    const b = this.batch;
    const rgb = [1, 1, 1];
    const ids = [
      b.vertex(px - tx * w / 2, y + h / 2, pz - tz * w / 2, nx, 0, nz, u0, v1, rgb, K.PLAIN, 1, 1, 0),
      b.vertex(px - tx * w / 2, y - h / 2, pz - tz * w / 2, nx, 0, nz, u0, v0, rgb, K.PLAIN, 1, 1, 0),
      b.vertex(px + tx * w / 2, y - h / 2, pz + tz * w / 2, nx, 0, nz, u1, v0, rgb, K.PLAIN, 1, 1, 0),
      b.vertex(px + tx * w / 2, y + h / 2, pz + tz * w / 2, nx, 0, nz, u1, v1, rgb, K.PLAIN, 1, 1, 0),
    ];
    b.quadIdx(ids[0], ids[1], ids[2], ids[3]);
  }

  mesh() {
    if (!this.batch.count) return null;
    const mat = new THREE.MeshStandardMaterial({
      map: this.tex, transparent: true, roughness: 0.75, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false,
    });
    const m = new THREE.Mesh(this.batch.build(), mat);
    m.receiveShadow = true;
    m.renderOrder = 1;
    m.matrixAutoUpdate = false;
    return m;
  }
}
