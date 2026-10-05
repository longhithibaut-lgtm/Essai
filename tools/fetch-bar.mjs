#!/usr/bin/env node
// Télécharge la « barre » de la boucle gauntlet depuis Steam : captures officielles
// de VHOLUME et de Mirror's Edge, et leurs vidéos de gameplay si ffmpeg est installé.
//
//   node tools/fetch-bar.mjs [--out .captures/bar]
//
// Ces images restent hors du dépôt (.captures est ignoré par git) : elles servent
// seulement de référence aux critiques.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const i = process.argv.indexOf('--out');
const out = path.resolve(i > 0 ? process.argv[i + 1] : '.captures/bar');
const GAMES = [
  { id: '4131730', prefix: 'vholume', videos: { 'VHOLUME - Gameplay 01': 'vholume_gameplay', 'Release Trailer': 'vholume_release' } },
  { id: '17410', prefix: 'mirrorsedge', videos: { 'GamePlay Video': 'mirrorsedge_gameplay', "Mirror's Edge™ HD Trailer": 'mirrorsedge_trailer' } },
];

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  for (const d of ['shots', 'video', 'frames']) fs.mkdirSync(path.join(out, d), { recursive: true });
  const ffmpeg = hasFfmpeg();
  // D'abord toutes les captures (rapide), ensuite les vidéos (long).
  const details = [];
  for (const g of GAMES) {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${g.id}`);
    const data = (await res.json())[g.id].data;
    details.push([g, data]);
    console.log(`${data.name} : ${data.screenshots.length} captures, ${data.movies?.length || 0} vidéos`);
    for (const [n, s] of data.screenshots.entries()) {
      const file = path.join(out, 'shots', `${g.prefix}_${String(n).padStart(2, '0')}.jpg`);
      if (fs.existsSync(file)) continue;
      const img = await fetch(s.path_full);
      fs.writeFileSync(file, Buffer.from(await img.arrayBuffer()));
    }
  }
  for (const [g, data] of details) {
    if (!ffmpeg) break;
    for (const m of data.movies || []) {
      const name = g.videos[m.name];
      const url = m.hls_h264 || m.mp4?.max;
      if (!name || !url) continue;
      const file = path.join(out, 'video', name + '.mp4');
      if (!fs.existsSync(file)) {
        console.log(`  vidéo ${m.name}…`);
        execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', url, '-t', '150', '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-an', file]);
      }
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-vf', 'fps=1/2,scale=640:-2', path.join(out, 'frames', name + '_%03d.jpg')]);
    }
  }
  if (!ffmpeg) console.log('ffmpeg introuvable : seules les captures sont téléchargées (les vidéos aident à juger le mouvement).');
  fs.writeFileSync(path.join(out, 'README.md'), `# La barre : VHOLUME et Mirror's Edge (matériel récupéré sur Steam)

- shots/vholume_NN.jpg : captures officielles de VHOLUME (app Steam 4131730)
- shots/mirrorsedge_NN.jpg : captures officielles de Mirror's Edge (app Steam 17410)
- video/*.mp4 : vidéos de gameplay et bandes-annonces (si ffmpeg est installé)
- frames/<video>_NNN.jpg : une image toutes les 2 s de chaque vidéo (NNN=1 -> 0 s)

Extraire une séquence de mouvement (10 images à 0,1 s d'intervalle à partir de 36 s) :
  ffmpeg -loglevel error -ss 36 -i video/mirrorsedge_gameplay.mp4 -vf "fps=10,scale=640:-2" -frames:v 10 seq_%02d.jpg
`);
  console.log('Barre prête dans', out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
