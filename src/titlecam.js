import { Birds } from './birds.js';

// Plans fixes de l'écran titre et de la page de fin, posés sur la vraie ville du parcours.
//
// Titre : au-dessus du jardin du bassin, du côté de l'ombre. Au premier plan la pelouse,
// les cerisiers et le bassin ; à droite la façade du palais, ses balcons et ses lierres ;
// au loin, entre deux flèches noyées dans la brume, le campanile où mène le parcours. À
// gauche l'aqueduc descend vers la mer de nuages et guide le regard vers le fond. Le
// soleil bas éclaire de côté, par la gauche : les arêtes tournées vers lui brillent, la
// gauche du ciel est blonde, et c'est là que se pose le texte.
//
// Fin : sur le pavillon de la cloche, qu'on vient d'atteindre. Le campanile se dresse à
// droite, l'aqueduc le relie à la brume, le pavillon et ses bassins sont à nos pieds ; la
// gauche de l'image, ouverte sur la mer de nuages, reçoit les mots de la fin.
//
// Objectif décentré (comme une chambre d'architecte) : l'horizon descend sans incliner
// la caméra, les façades restent droites. ui.screen('play') rend l'objectif normal.

export const TITLE_SHOT = { pos: [-6, 18, -60], yaw: -0.2, pitch: -0.12, fov: 54, shift: 0.08, birds: 26, caption: 'Le jardin du bassin' };
export const END_SHOT = { pos: [-7, 18, -176], yaw: -0.404, pitch: -0.16, fov: 58, shift: 0.1, birds: 16, caption: 'Le pavillon de la cloche' };

const TEST = new URLSearchParams(location.search).has('test');
const STILL = matchMedia('(prefers-reduced-motion: reduce)');

// Mouvement d'arrivée sur chaque plan, en temps réel (pas en temps de jeu : une machine
// lente le voit aussi se poser à temps). Titre : on glisse vers le jardin en descendant
// un peu, comme un oiseau qui se pose. Fin : on part du pied du campanile et l'on
// recule en s'élevant, la ville se découvre. Rien en mode test, ni sur une machine trop
// lente pour l'animer (le titre s'y affiche déjà composé).
const ARRIVAL = {
  title: { secs: 12, back: 10, rise: 2.4 },
  end: { secs: 14, back: -8, rise: -2.5 },
};

export function titleCamera(game, dt) {
  const end = game.ui.dawn;
  const shot = end ? (game.endShot || END_SHOT) : (game.titleShot || TITLE_SHOT);
  const cam = game.camera;
  const now = performance.now();
  const key = end ? 'end' : 'title';
  // Un plan qui change, ou qu'on retrouve après une partie, rejoue son arrivée.
  if (game._shotKey !== key || now - (game._shotSeen ?? 0) > 500) {
    game._shotKey = key;
    game._shotT0 = now;
  }
  game._shotSeen = now;
  let arrive = 0;
  const still = STILL.matches;
  if (!TEST && !still && !document.body.classList.contains('instant')) {
    const u = Math.min(1, (now - game._shotT0) / (ARRIVAL[key].secs * 1000));
    arrive = (1 - u) * (1 - u) * (1 - u);
  }
  // Dérive très lente : on avance et recule de quelques mètres en trois minutes, on
  // flotte un peu, comme porté par l'air tiède. Assez pour sentir la profondeur
  // (les toits proches glissent devant les tours lointaines), jamais assez pour la voir.
  // (Mouvement réduit demandé : la caméra ne bouge presque plus.)
  const a = game.time * (still ? 0.004 : 0.032);
  const along = Math.sin(a) * 3.2 - arrive * ARRIVAL[key].back;
  const side = Math.sin(a * 0.71 + 1.3) * 1.4;
  const lift = Math.sin(a * 1.27 + 0.4) * 0.5 + arrive * ARRIVAL[key].rise;
  const sy = Math.sin(shot.yaw), cy = Math.cos(shot.yaw);
  cam.position.set(shot.pos[0] - sy * along + cy * side, shot.pos[1] + lift, shot.pos[2] - cy * along - sy * side);
  // Le regard suit à peine le pointeur.
  const look = game.titleLook || (game.titleLook = { x: 0, y: 0 });
  const k = Math.min(1, dt * 1.2);
  look.x += (game.ui.pointer.x - look.x) * k;
  look.y += (game.ui.pointer.y - look.y) * k;
  cam.rotation.order = 'YXZ';
  cam.rotation.set(
    shot.pitch + Math.sin(a * 0.83) * 0.004 - look.y * 0.012 - arrive * 0.03,
    shot.yaw + Math.sin(a * 0.57 + 2.1) * 0.01 - look.x * 0.02,
    Math.sin(a * 0.49) * 0.002,
  );
  // Les plans sont composés en 16:9 ; sur un écran plus étroit, on garde le même champ
  // horizontal (le palais et le campanile restent dans l'image), sur un plus large le
  // même champ vertical.
  const aspect = cam.aspect || 16 / 9;
  const fov = aspect < 16 / 9
    ? Math.min(84, (2 * Math.atan(Math.tan((shot.fov * Math.PI) / 360) * (16 / 9) / aspect) * 180) / Math.PI)
    : shot.fov;
  if (Math.abs(cam.fov - fov) > 1e-4 || !cam.view || !cam.view.enabled || cam.view.offsetY !== -shot.shift) {
    cam.fov = fov;
    cam.view = { enabled: true, fullWidth: 1, fullHeight: 1, offsetX: 0, offsetY: -shot.shift, width: 1, height: 1 };
    cam.updateProjectionMatrix();
  }
  if (end) game.r.setFade(0);
  game.ui.setStill?.(shot.caption);
  (game.birds || (game.birds = new Birds(game.scene))).update(dt, shot);
}
