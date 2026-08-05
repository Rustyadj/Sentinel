// Neural Lens — procedural textures for the GPU point-cloud renderer.
//
// Canvas-generated once and cached, not shipped as image assets: a soft
// circular dot (for the bulk THREE.Points node field) and a softer, wider
// radial glow (for hub/selected bloom sprites). Both are tiny (64px) —
// texture memory is irrelevant here, this is purely about avoiding square
// GL points and faking bloom without a postprocessing pipeline.

let dotTexture: unknown = null;
let glowTexture: unknown = null;

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/** A crisp, softly anti-aliased round dot — used for every ordinary node. */
export function getDotTexture() {
  if (dotTexture) return dotTexture;
  const size = 64;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d")!;
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.7, "rgba(255,255,255,0.85)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  // THREE.CanvasTexture — imported lazily by the caller (client-only module).
  dotTexture = canvas;
  return canvas;
}

/** A much wider, softer falloff — used behind hub/selected nodes to fake a
 * small bloom without a full postprocessing pipeline. */
export function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d")!;
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, "rgba(255,255,255,0.55)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.22)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  glowTexture = canvas;
  return canvas;
}
