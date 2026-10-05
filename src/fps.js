// Compteur d'images par seconde, pour vérifier les 60 images/s sur une vraie machine.
// S'affiche avec #fps (ou ?fps) dans l'adresse.

export function createFpsMeter(renderer) {
  const on = /(^|[#?&])fps\b/.test(location.hash + location.search);
  if (!on) return null;

  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:50;padding:8px 12px;border-radius:10px;background:rgba(20,16,30,.72);color:#fff;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;pointer-events:none;white-space:pre';
  document.body.appendChild(el);

  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 60);

  let frames = 0;
  let worst = 0;
  let last = performance.now();
  let windowStart = last;
  const info = renderer.info;
  info.autoReset = false;

  return {
    // À appeler une fois par image, avant le rendu.
    begin() {
      info.reset();
    },
    // À appeler une fois par image, après le rendu.
    end(now) {
      const dt = now - last;
      last = now;
      frames++;
      if (dt > worst) worst = dt;
      if (now - windowStart >= 1000) {
        const fps = (frames * 1000) / (now - windowStart);
        el.textContent = `${fps.toFixed(0)} images/s   pire image ${worst.toFixed(1)} ms\n${info.render.calls} appels   ${(info.render.triangles / 1000).toFixed(0)} k triangles\n${gpu}`;
        el.style.color = fps >= 58 ? '#b9f5c8' : fps >= 45 ? '#ffe3a3' : '#ffb3a3';
        frames = 0;
        worst = 0;
        windowStart = now;
      }
    },
  };
}
