// Convierte una imagen en contornos (en píxeles) separando "tinta" de fondo.

// Dibuja la imagen en un canvas de tamaño de trabajo, con un borde blanco.
export function rasterize(img, workSide = 1400) {
  const w0 = img.naturalWidth || img.width || 1000;
  const h0 = img.naturalHeight || img.height || 1000;
  const scale = Math.min(4, workSide / Math.max(w0, h0));
  const pad = 4;
  const w = Math.round(w0 * scale) + pad * 2;
  const h = Math.round(h0 * scale) + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, pad, pad, w - pad * 2, h - pad * 2);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

// 1 = tinta (parte del diseño), 0 = fondo.
export function makeMask({ w, h, data }, threshold, invert) {
  const mask = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      const ink = lum < threshold;
      mask[i] = ink !== invert ? 1 : 0;
    }
  }
  // el borde siempre es fondo para que todos los contornos cierren
  for (let x = 0; x < w; x++) { mask[x] = 0; mask[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { mask[y * w] = 0; mask[y * w + w - 1] = 0; }
  return mask;
}

// Sigue los bordes entre píxeles de tinta y fondo y devuelve lazos cerrados.
export function traceMask(mask, w, h, smoothPx = 0.7, minAreaPx = 6) {
  const W = w + 1;
  const next = new Map();
  const add = (x0, y0, x1, y1) => {
    const k = y0 * W + x0;
    const v = y1 * W + x1;
    const a = next.get(k);
    if (a) a.push(v); else next.set(k, [v]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (!mask[(y - 1) * w + x]) add(x, y, x + 1, y);
      if (!mask[y * w + x + 1]) add(x + 1, y, x + 1, y + 1);
      if (!mask[(y + 1) * w + x]) add(x + 1, y + 1, x, y + 1);
      if (!mask[y * w + x - 1]) add(x, y + 1, x, y);
    }
  }

  const loops = [];
  for (const [start, arr] of next) {
    while (arr.length) {
      const pts = [];
      let cur = start;
      do {
        pts.push([cur % W, Math.floor(cur / W)]);
        cur = next.get(cur).pop();
      } while (cur !== start);
      // puntos medios de cada borde: convierte la escalera de píxeles en diagonales
      const mid = pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      });
      const simple = simplifyClosed(mid, smoothPx);
      if (simple.length >= 3 && Math.abs(polyArea(simple)) >= minAreaPx) loops.push(simple);
    }
  }
  return loops;
}

export function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

// Douglas-Peucker para lazos cerrados.
function simplifyClosed(pts, eps) {
  if (pts.length < 8 || eps <= 0) return pts;
  let far = 0, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp(pts.slice(far).concat([pts[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function rdp(pts, eps) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = pts[s], [bx, by] = pts[e];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let maxD = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
