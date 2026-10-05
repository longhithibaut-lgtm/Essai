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

export function titleCamera(game, dt) {
  const end = game.ui.dawn;
  const shot = end ? (game.endShot || END_SHOT) : (game.titleShot || TITLE_SHOT);
  const cam = game.camera;
  // Dérive très lente : on avance et recule de quelques mètres en trois minutes, on
  // flotte un peu, comme porté par l'air tiède. Assez pour sentir la profondeur
  // (les toits proches glissent devant les tours lointaines), jamais assez pour la voir.
  const a = game.time * 0.032;
  const along = Math.sin(a) * 3.2, side = Math.sin(a * 0.71 + 1.3) * 1.4, lift = Math.sin(a * 1.27 + 0.4) * 0.5;
  const sy = Math.sin(shot.yaw), cy = Math.cos(shot.yaw);
  cam.position.set(shot.pos[0] - sy * along + cy * side, shot.pos[1] + lift, shot.pos[2] - cy * along - sy * side);
  // Le regard suit à peine le pointeur.
  const look = game.titleLook || (game.titleLook = { x: 0, y: 0 });
  const k = Math.min(1, dt * 1.2);
  look.x += (game.ui.pointer.x - look.x) * k;
  look.y += (game.ui.pointer.y - look.y) * k;
  cam.rotation.order = 'YXZ';
  cam.rotation.set(
    shot.pitch + Math.sin(a * 0.83) * 0.004 - look.y * 0.012,
    shot.yaw + Math.sin(a * 0.57 + 2.1) * 0.01 - look.x * 0.02,
    Math.sin(a * 0.49) * 0.002,
  );
  if (cam.fov !== shot.fov || !cam.view || !cam.view.enabled || cam.view.offsetY !== -shot.shift) {
    cam.fov = shot.fov;
    cam.view = { enabled: true, fullWidth: 1, fullHeight: 1, offsetX: 0, offsetY: -shot.shift, width: 1, height: 1 };
    cam.updateProjectionMatrix();
  }
  if (end) game.r.setFade(0);
  game.ui.setStill?.(shot.caption);
  (game.birds || (game.birds = new Birds(game.scene))).update(dt, shot);
}
