#!/usr/bin/env node
// Comparaison à l'aveugle pour la boucle gauntlet.
//
//   node tools/blind.mjs pair --ours a.png --bar b.jpg --dir <dossier> --id <nom>
//     -> crée <dossier>/<nom>.png : deux images côte à côte, étiquetées A et B
//        dans un ordre aléatoire. La correspondance est gardée dans <dossier>/.keys/.
//   node tools/blind.mjs reveal --dir <dossier> --id <nom> --pick A|B [--gap "..."]
//     -> dit si l'image choisie était la nôtre et l'ajoute à <dossier>/verdicts.jsonl.
//
// Le critique choisit d'abord, puis révèle. Il ne doit pas lire .keys/ avant.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [cmd] = process.argv.slice(2);
function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const dir = path.resolve(arg('dir') || '.blind');
const id = (arg('id') || 'pair').replace(/[^a-zA-Z0-9_-]/g, '_');
const keys = path.join(dir, '.keys');

if (cmd === 'pair') {
  const ours = arg('ours');
  const bar = arg('bar');
  if (!ours || !bar) throw new Error('--ours et --bar sont requis');
  fs.mkdirSync(keys, { recursive: true });
  const oursFirst = crypto.randomInt(2) === 0;
  const [a, b] = oursFirst ? [ours, bar] : [bar, ours];
  const size = arg('size') || '960x540';
  const prep = (src, label) => [
    '(', src, '-resize', size + '^', '-gravity', 'center', '-extent', size,
    '-gravity', 'northwest', '-fill', '#000a', '-draw', 'rectangle 0,0 64,56',
    '-fill', 'white', '-pointsize', '40', '-annotate', '+18+8', label, ')',
  ];
  const outFile = path.join(dir, id + '.png');
  execFileSync('convert', [...prep(a, 'A'), ...prep(b, 'B'), '-background', '#111', '-splice', '0x0', '+append', outFile]);
  fs.writeFileSync(path.join(keys, id + '.json'), JSON.stringify({ ours: oursFirst ? 'A' : 'B', oursFile: ours, barFile: bar }));
  console.log(outFile);
} else if (cmd === 'reveal') {
  const pick = (arg('pick') || '').toUpperCase();
  if (pick !== 'A' && pick !== 'B') throw new Error('--pick A ou B');
  const key = JSON.parse(fs.readFileSync(path.join(keys, id + '.json'), 'utf8'));
  const result = { id, pick, ours: key.ours, oursWon: pick === key.ours, gap: arg('gap') || '' };
  fs.appendFileSync(path.join(dir, 'verdicts.jsonl'), JSON.stringify(result) + '\n');
  console.log(JSON.stringify(result));
} else {
  console.log('Utilisation : blind.mjs pair|reveal (voir l’en-tête du fichier)');
  process.exit(1);
}
