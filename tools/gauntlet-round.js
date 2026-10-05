export const meta = {
  name: 'aube-gauntlet-round',
  description: 'Un tour de boucle gauntlet sur Aube : un constructeur puis un critique à l\'aveugle par morceau',
  phases: [
    { title: 'Construire', detail: 'un constructeur par morceau, chacun dans son worktree git' },
    { title: 'Critiquer', detail: 'un critique neuf par morceau, comparaison à l\'aveugle contre VHOLUME et Mirror\'s Edge' },
  ],
}

const { round, bar, blindDir, pieces } = args

const CONTEXT = `You are part of a "gauntlet loop" building **Aube**, a calm, soothing first-person parkour game playable in the browser, built with three.js r186 (ES modules through an import map from jsdelivr, no build step).
The user's goal: a first-person parkour game where you run, jump, climb, slide and wall-run through a calm and soothing setting, with fluid, gentle movement that is a pleasure to chain without stress. The bar is VHOLUME and Mirror's Edge for movement quality and image beauty; the ambiance must be more soothing than both. The game must also hold 60 frames per second.
The bar material (official Steam screenshots and gameplay videos) is in ${bar}. Read ${bar}/README.md first.
Codebase (in your worktree): index.html, style.css, src/main.js (game loop and states), src/player.js (controller and camera effects), src/input.js, src/physics.js (axis-aligned box collision world), src/level.js (course geometry, orbs, checkpoints, hints, viewpoints, autopilot route), src/world.js (sky, lights, clouds, distant towers, pollen), src/render.js (renderer and post-processing), src/materials.js, src/audio.js (generative WebAudio), src/ui.js, src/testapi.js (window.__aube test API and autopilot), tools/capture.mjs (headless capture), tools/blind.mjs (blind pairs).
Capture: from the worktree run \`node tools/capture.mjs --root <worktree> --out <worktree>/.captures/<name> [--only views,route,frames,ui,perf]\`. A full run takes 3 to 5 minutes (software WebGL); --only views,route takes about 30 s. It writes views/*.png, frames/*_sheet.png (10-frame movement sequences around jump, vault, wallrunStart, slideStart, climb, mantle, finish, plus run_sheet.png), ui/*.png, route.json (does the autopilot finish the course?), perf.json and summary.json (summary.errors must stay empty). Look at images with your Read tool.
Hard constraints: the game must keep working in a normal desktop browser (three loads from jsdelivr through the import map; no npm build step; no runtime dependency other than three and three/addons). Keep ?test mode and the window.__aube API working, and keep the autopilot finishing the course (summary.route.finished true, no falls). All in-game text stays in French. Performance target: 60 fps on a mid-range laptop GPU, so keep draw calls low (merge static geometry, use instancing), avoid per-frame allocations, keep post-processing affordable. The calm, soothing mood is a requirement: soft palette, gentle motion, no stress, no timer pressure.`

const BUILDER_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'French, 2 to 4 plain sentences for the user: what changed and why' },
    commit: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    routeFinished: { type: 'boolean' },
    errors: { type: 'number' },
    calls: { type: 'number' },
    triangles: { type: 'number' },
    notesForLead: { type: 'string', description: 'cross-piece requests or integration notes, empty if none' },
  },
  required: ['summary', 'commit', 'filesChanged', 'routeFinished', 'errors', 'notesForLead'],
}

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    oursWon: { type: 'boolean', description: 'true only if ours was picked in every blind pair' },
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          ours: { type: 'string' },
          bar: { type: 'string' },
          pick: { type: 'string' },
          oursWon: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['id', 'ours', 'bar', 'pick', 'oursWon', 'reason'],
      },
    },
    biggestGap: { type: 'string', description: 'French, one or two sentences: the single biggest remaining gap, concrete and actionable' },
    verdict: { type: 'string', description: 'French one-line verdict for the progress page' },
    bestShot: { type: 'string', description: 'absolute path of our most representative capture for this piece' },
  },
  required: ['oursWon', 'pairs', 'biggestGap', 'verdict', 'bestShot'],
}

function builderPrompt(p) {
  return `${CONTEXT}

You are the BUILDER for the piece "${p.name}" in round ${round}.
Your worktree is ${p.path} (git branch ${p.branch}). Work ONLY inside this worktree.
Your scope: ${p.scope}
Files you own: ${p.files}. You may create new files under src/ for your piece. Only if strictly required, you may make a minimal additive edit to src/main.js (one import and one hook line). Do not edit files owned by other pieces: other builders are changing them in parallel right now. If you need something from another piece, write it in notesForLead.
${p.gap ? `The critic of the previous round said: "${p.verdict}". The single biggest remaining gap it named: "${p.gap}". Close that gap first, then keep pushing the piece toward beating the bar.` : 'This is the first round for this piece: find what separates it most from the bar and fix the biggest things first.'}
${p.notes ? 'Integration notes from the lead (the four pieces of the previous round are now merged into your starting point): ' + p.notes + '\n' : ''}Start by running a capture of the current game and by looking at the bar (several screenshots and the relevant contact sheets). Then make substantial, high-impact improvements; this is not a polishing pass. Run the capture again, put your images next to the bar honestly, and iterate until you believe yours is genuinely closer to beating it. Make sure summary.errors is empty and the route still finishes.
Finally commit in the worktree: git add -A && git commit -m "<message en français qui décrit le changement>". Do not push. Never commit node_modules or .captures.
Return the structured result.`
}

function criticPrompt(p, built) {
  return `${CONTEXT}

You are the CRITIC for the piece "${p.name}" in round ${round}. You have fresh context and you did not build this. Be a harsh critic: praise is not useful. Your job is a binary blind judgment against the bar, plus naming the single biggest remaining gap.
The builder's worktree is ${p.path}. Do not edit any code.
1. From ${p.path}, run the capture: node tools/capture.mjs --root ${p.path} --out ${p.path}/.captures/critic --only ${p.captureOnly || 'views,route,frames,ui,perf'}
2. Pick our captures that show this piece best: ${p.judge}
3. Pick the most comparable bar images from ${bar} (the same kind of shot): ${p.barHint}
4. Build at least 3 blind pairs, at least one against VHOLUME and one against Mirror's Edge: node ${p.path}/tools/blind.mjs pair --ours <our file> --bar <bar file> --dir ${blindDir} --id r${round}-${p.id}-<n>. Open each composite with Read and decide which of A or B is better on this piece's criteria: ${p.criteria}. Commit to your pick, then reveal: node ${p.path}/tools/blind.mjs reveal --dir ${blindDir} --id r${round}-${p.id}-<n> --pick A|B. Never read ${blindDir}/.keys before picking.
5. Ours wins only if it was picked in every pair.
6. Name the single biggest remaining gap for this piece: concrete, visible, actionable, in French, one or two sentences (what is wrong and what it should look or feel like instead).
Builder's own summary, for context only (do not trust it): ${built ? built.summary : 'builder returned nothing'}
Return the structured result.`
}

const results = await pipeline(
  pieces,
  (p) => agent(builderPrompt(p), { label: `construire:${p.id}`, phase: 'Construire', schema: BUILDER_SCHEMA }),
  (built, p) => agent(criticPrompt(p, built), { label: `critiquer:${p.id}`, phase: 'Critiquer', schema: CRITIC_SCHEMA }).then((c) => ({ id: p.id, built, critic: c })),
)
return results.filter(Boolean)
