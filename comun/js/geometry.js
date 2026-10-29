// Geometría 2D (con ClipperLib) y armado de las piezas 3D en milímetros.
import * as THREE from 'three';

const C = window.ClipperLib;
const SC = 1000; // milímetros -> enteros para Clipper

// ---------- 2D ----------

const toClip = (loop) => loop.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) }));
const fromClip = (path) => path.map((p) => [p.X / SC, p.Y / SC]);

function boolean(type, subj, clip = [], fill = C.PolyFillType.pftNonZero, keepCollinear = false) {
  const c = new C.Clipper();
  c.PreserveCollinear = keepCollinear;
  c.AddPaths(subj, C.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, C.PolyType.ptClip, true);
  const out = new C.Paths();
  c.Execute(type, out, fill, fill);
  return out;
}
const union = (a, fill) => boolean(C.ClipType.ctUnion, a, [], fill);
const diff = (a, b) => boolean(C.ClipType.ctDifference, a, b);
const intersect = (a, b) => boolean(C.ClipType.ctIntersection, a, b);

function offset(paths, mm) {
  if (!mm) return paths;
  const co = new C.ClipperOffset(2, 0.01 * SC);
  co.AddPaths(paths, C.JoinType.jtRound, C.EndType.etClosedPolygon);
  const out = new C.Paths();
  co.Execute(out, mm * SC);
  return out;
}

// Agrupa contornos en polígonos con agujeros: [{outer, holes}]
function toExPolys(paths) {
  const c = new C.Clipper();
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const res = [];
  const walk = (node) => {
    for (const ch of node.Childs()) {
      if (ch.IsHole()) continue;
      res.push({
        outer: fromClip(C.Clipper.CleanPolygon(ch.Contour(), 0.002 * SC)),
        // al limpiar, un agujero diminuto puede quedar sin área: se descarta (si no, el triangulador falla)
        holes: ch.Childs().map((h) => fromClip(C.Clipper.CleanPolygon(h.Contour(), 0.002 * SC)))
          .filter((h) => h.length >= 3 && Math.abs(signedArea(h)) > 1e-6),
      });
      for (const h of ch.Childs()) walk(h);
    }
  };
  walk(tree);
  return res.filter((e) => e.outer.length >= 3 && Math.abs(signedArea(e.outer)) > 1e-6);
}

// Solo los contornos exteriores, rellenando agujeros.
const fillHoles = (paths) => toExPolys(paths).map((e) => toClip(e.outer));

function bbox(paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) for (const q of p) {
    x0 = Math.min(x0, q.X); y0 = Math.min(y0, q.Y); x1 = Math.max(x1, q.X); y1 = Math.max(y1, q.Y);
  }
  return { x0: x0 / SC, y0: y0 / SC, x1: x1 / SC, y1: y1 / SC };
}

function circlePath(cx, cy, r, n = 96) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return toClip(out);
}

function roundedRect(x0, y0, x1, y1, r) {
  r = Math.max(0, Math.min(r, (x1 - x0) / 2 - 0.01, (y1 - y0) / 2 - 0.01));
  if (r <= 0) return toClip([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  return offset([toClip([[x0 + r, y0 + r], [x1 - r, y0 + r], [x1 - r, y1 - r], [x0 + r, y1 - r]])], r)[0];
}

const areaOf = (paths) => paths.reduce((s, p) => s + C.Clipper.Area(p), 0) / (SC * SC);

// Contornos (y hacia abajo, en cualquier unidad) -> diseño en mm, centrado, con el lado más largo pedido.
// sources: [{ loops, evenOdd }]. La imagen usa par-impar; el texto, no-cero (las letras cursivas se superponen).
export function designFromLoops(sources, { artMM, mirror }) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const { loops } of sources) for (const l of loops) for (const [x, y] of l) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (!isFinite(x0)) return null;
  const s = artMM / Math.max(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const parts = sources.flatMap(({ loops, evenOdd }) => union(
    loops.map((l) => toClip(l.map(([x, y]) => [(mirror ? -1 : 1) * (x - cx) * s, -(y - cy) * s]))),
    evenOdd ? C.PolyFillType.pftEvenOdd : C.PolyFillType.pftNonZero,
  ));
  return { paths: union(parts), heightMM: (y1 - y0) * s };
}

// ---------- 3D ----------

class MeshBuilder {
  constructor() { this.p = []; }
  tri(a, b, c) { this.p.push(...a, ...b, ...c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
}

function signedArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const q = loop[(i + 1) % loop.length];
    a += loop[i][0] * q[1] - q[0] * loop[i][1];
  }
  return a / 2;
}
const orient = (loop, ccw) => ((signedArea(loop) > 0) === ccw ? loop : loop.slice().reverse());

// Pared vertical; el sólido queda a la izquierda del recorrido.
function wall(m, loop, z0, z1) {
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    m.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]);
  }
}

// Tapa horizontal con agujeros, mirando hacia arriba o hacia abajo.
function cap(m, outer, holes, z, up) {
  const v2 = (l) => l.map(([x, y]) => new THREE.Vector2(x, y));
  const faces = THREE.ShapeUtils.triangulateShape(v2(outer), holes.map(v2));
  const all = outer.concat(...holes);
  for (const [i, j, k] of faces) {
    const A = all[i];
    let B = all[j], Cc = all[k];
    const cr = (B[0] - A[0]) * (Cc[1] - A[1]) - (Cc[0] - A[0]) * (B[1] - A[1]);
    if (cr > 0 !== up) [B, Cc] = [Cc, B];
    m.tri([A[0], A[1], z], [B[0], B[1], z], [Cc[0], Cc[1], z]);
  }
}

function extrude(m, ex, z0, z1) {
  const outer = orient(ex.outer, true);
  const holes = ex.holes.map((h) => orient(h, false));
  wall(m, outer, z0, z1);
  holes.forEach((h) => wall(m, h, z0, z1));
  cap(m, outer, holes, z0, false);
  cap(m, outer, holes, z1, true);
}

// Une anillos (misma cantidad de puntos) a distintas alturas.
function loft(m, rings, zs) {
  for (let k = 0; k < rings.length - 1; k++) {
    const r0 = rings[k], r1 = rings[k + 1];
    for (let i = 0; i < r0.length; i++) {
      const j = (i + 1) % r0.length;
      m.quad([r0[i][0], r0[i][1], zs[k]], [r0[j][0], r0[j][1], zs[k]],
        [r1[j][0], r1[j][1], zs[k + 1]], [r1[i][0], r1[i][1], zs[k + 1]]);
    }
  }
}

// ---------- Encastre de mango (rosca de un cuarto de vuelta) ----------
// Medidas base del sistema de mango de tus sellos: llave elíptica de 9,58 × 5,58 mm
// que gira 90° cada 1,6 mm. El tamaño de la rosca escala la llave manteniendo su forma.
export const HANDLE = {
  keyLength: 3.5, socketDepth: 4.5, twist: Math.PI / 2 / 1.6, steps: 128,
  baseThread: 9.58, baseB: 2.79, baseTip: 2.57,
};

function handleDims(P) {
  const k = P.threadSize / HANDLE.baseThread;
  const keyA = P.threadSize / 2;
  return {
    radius: P.handleDiameter / 2,
    bodyLength: P.handleLength - HANDLE.keyLength,
    keyA, keyB: HANDLE.baseB * k, tipR: HANDLE.baseTip * k,
  };
}

const ellipseR = (psi, a, b) => (a * b) / Math.hypot(b * Math.cos(psi), a * Math.sin(psi));

function polarRing(rFn, cx = 0, cy = 0, n = HANDLE.steps) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const phi = (i / n) * Math.PI * 2;
    const r = rFn(phi);
    out.push([cx + r * Math.cos(phi), cy + r * Math.sin(phi)]);
  }
  return out;
}

function socketRings(cx, cy, P) {
  const d = handleDims(P);
  const A = d.keyA + P.socketFit, B = d.keyB + P.socketFit, mouth = A + 0.01;
  const zs = [], rings = [];
  const n = Math.round(HANDLE.socketDepth / 0.1);
  for (let i = 0; i <= n; i++) {
    const zz = (i / n) * HANDLE.socketDepth;
    zs.push(zz);
    // anillos en sentido horario: la normal apunta hacia el hueco
    rings.push(polarRing((phi) => Math.max(ellipseR(phi - HANDLE.twist * zz, A, B), mouth - zz), cx, cy).reverse());
  }
  return { zs, rings };
}

export function buildHandle(P) {
  const H = { ...HANDLE, ...handleDims(P) }, m = new MeshBuilder();
  const top = H.bodyLength + H.keyLength;
  const zs = [], rings = [];
  // base redondeada (más chica si el mango es fino o corto)
  const fr = Math.min(1.7, H.radius * 0.35), fh = Math.min(2, H.bodyLength / 3);
  for (let i = 0; i <= 10; i++) {
    const z = (i / 10) * fh;
    const r = H.radius - fr + fr * Math.sqrt(1 - (1 - z / fh) ** 2);
    zs.push(z); rings.push(polarRing(() => r));
  }
  zs.push(H.bodyLength); rings.push(polarRing(() => H.radius));
  const n = Math.round(H.keyLength / 0.1);
  for (let i = 0; i <= n; i++) {
    const zz = H.bodyLength + (i / n) * H.keyLength;
    zs.push(zz);
    rings.push(polarRing((phi) => Math.min(ellipseR(phi - H.twist * (zz - H.bodyLength), H.keyA, H.keyB), H.tipR + (top - zz))));
  }
  loft(m, rings, zs);
  cap(m, rings[0], [], 0, false);
  cap(m, rings[rings.length - 1], [], top, true);
  return new Float32Array(m.p);
}

// Punto de la base más alejado de los bordes (donde mejor entra el encastre).
// Búsqueda en grilla que se va afinando alrededor del mejor punto.
function deepestPoint(exs) {
  const loops = exs.flatMap((e) => [e.outer, ...e.holes]);
  const inside = (x, y) => exs.some((e) => pip(e.outer, x, y) && !e.holes.some((h) => pip(h, x, y)));
  const depth = (x, y) => {
    if (!inside(x, y)) return -1;
    let d = Infinity;
    for (const l of loops) for (let i = 0; i < l.length; i++) d = Math.min(d, segDist(x, y, l[i], l[(i + 1) % l.length]));
    return d;
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of exs) for (const [x, y] of e.outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  let best = [(x0 + x1) / 2, (y0 + y1) / 2], bestD = depth(...best);
  let cx = best[0], cy = best[1], hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
  for (let round = 0; round < 4; round++) {
    const n = 20;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const x = cx - hw + (2 * hw * i) / n, y = cy - hh + (2 * hh * j) / n;
      const d = depth(x, y);
      if (d > bestD + 1e-9) { bestD = d; best = [x, y]; }
    }
    [cx, cy] = best;
    hw /= 4; hh /= 4;
  }
  return best;
}

function pip(loop, x, y) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i], [xj, yj] = loop[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

// ---------- Armado de piezas ----------

const prepareArt = (design, P) => (P.thicken ? union(offset(design.paths, P.thicken)) : design.paths);

// Contorno de la base del sello / interior del cortante.
function computeOutline(art, P) {
  const b = bbox(art);
  if (P.baseShape === 'rect') {
    return [roundedRect(b.x0 - P.margin, b.y0 - P.margin, b.x1 + P.margin, b.y1 + P.margin, P.cornerR)];
  }
  if (P.baseShape === 'circle') {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    let r = 0;
    for (const p of art) for (const q of p) r = Math.max(r, Math.hypot(q.X / SC - cx, q.Y / SC - cy));
    return [circlePath(cx, cy, r + P.margin, 160)];
  }
  // silueta: une piezas separadas (cierre morfológico) y rellena agujeros
  let sil = fillHoles(union(art));
  if (P.joinGap > 0) sil = union(offset(fillHoles(offset(sil, P.joinGap)), -P.joinGap));
  return union(offset(sil, P.margin));
}

export function buildModel(design, P) {
  const warnings = [];
  const art = prepareArt(design, P);
  const outline = computeOutline(art, P);

  const parts = [];
  const view2d = { art, plate: null, cutter: null, socket: null };
  const withStamp = P.mode !== 'cutter';
  const withCutter = P.mode !== 'stamp';

  if (withCutter) {
    const m = new MeshBuilder();
    const ring = (w) => toExPolys(diff(offset(outline, w), outline));
    const tipH = Math.min(P.tipHeight, P.cutHeight - P.flangeHeight);
    const tipZ = P.cutHeight - tipH;
    ring(P.flangeWidth).forEach((e) => extrude(m, e, 0, P.flangeHeight));
    ring(P.wallBase).forEach((e) => extrude(m, e, P.flangeHeight - 0.2, tipZ));
    // chaflán exterior del filo, en escalones finos (por debajo de la altura de capa)
    const steps = Math.max(1, Math.round(tipH / 0.2));
    for (let i = 0; i < steps; i++) {
      const w = P.wallBase + (P.wallTip - P.wallBase) * ((i + 1) / steps);
      const z0 = tipZ + (tipH * i) / steps;
      ring(w).forEach((e) => extrude(m, e, z0 - 0.05, z0 + tipH / steps));
    }
    parts.push({ name: 'Cortante', color: 0xE8D84A, tris: new Float32Array(m.p) });
    view2d.cutter = diff(offset(outline, P.wallBase), outline);
  }

  if (withStamp) {
    const plate = withCutter ? union(offset(outline, -P.stampClearance)) : outline;
    if (!plate.length) {
      warnings.push('La base del sello quedó vacía: el diseño es muy chico para esa holgura.');
    } else {
      const m = new MeshBuilder();
      const H = P.baseThickness;
      const plateEx = toExPolys(plate);
      const center = deepestPoint(plateEx);
      const cx = center[0] + P.socketX, cy = center[1] + P.socketY;
      let socketUsed = false, socketOk = P.socket;
      const keyA = handleDims(P).keyA;
      if (P.socket) {
        if (H < HANDLE.socketDepth + 0.6) {
          socketOk = false;
          warnings.push(`Con encastre, la base necesita al menos ${(HANDLE.socketDepth + 0.6).toFixed(1)} mm de grosor.`);
        }
        const need = circlePath(cx, cy, keyA + P.socketFit + 0.8);
        if (areaOf(diff([need], plate)) > 0.01) {
          socketOk = false;
          warnings.push('El encastre del mango no entra en la base, así que el sello sale sin encastre: agrandá el diseño o el margen, o mové el encastre.');
        }
      }
      for (const ex of plateEx) {
        const inside = socketOk && !socketUsed &&
          C.Clipper.PointInPolygon({ X: cx * SC, Y: cy * SC }, toClip(ex.outer)) === 1;
        if (!inside) { extrude(m, ex, 0, H); continue; }
        socketUsed = true;
        const outer = orient(ex.outer, true);
        const holes = ex.holes.map((h) => orient(h, false));
        const s = socketRings(cx, cy, P);
        wall(m, outer, 0, H);
        holes.forEach((h) => wall(m, h, 0, H));
        cap(m, outer, holes.concat([s.rings[0]]), 0, false);
        cap(m, outer, holes, H, true);
        loft(m, s.rings, s.zs);
        cap(m, s.rings[s.rings.length - 1], [], HANDLE.socketDepth, false);
        view2d.socket = { cx, cy, r: keyA + P.socketFit };
      }
      // el relieve arranca 0,2 mm dentro de la base para que el slicer lo una
      const relief = toExPolys(intersect(art, offset(plate, -P.reliefInset)));
      if (!relief.length) warnings.push('El relieve quedó vacío.');
      const split = m.p.length;
      const body = new Float32Array(m.p);
      relief.forEach((e) => extrude(m, e, H - 0.2, H + P.reliefHeight));
      // Para el 3MF cuerpo y relieve van como partes separadas (para asignarles filamentos distintos):
      // ahí el relieve arranca justo sobre la base, sin superponerse, así no queda una franja de color dudoso.
      const mr = new MeshBuilder();
      relief.forEach((e) => extrude(mr, e, H, H + P.reliefHeight));
      // split: desde dónde empieza el relieve (para pintarlo distinto en la vista)
      parts.push({
        name: 'Sello', color: 0x3BBFB0, accent: 0xF0196E, split, tris: new Float32Array(m.p),
        subparts: [{ name: 'Cuerpo', tris: body }, { name: 'Relieve', tris: new Float32Array(mr.p) }],
      });
      view2d.plate = plate;
    }
    if (P.includeHandle) {
      if (P.threadSize > P.handleDiameter) warnings.push('La rosca es más ancha que el mango: la punta va a sobresalir del cuerpo.');
      parts.push({ name: 'Mango', color: 0x9ACD32, tris: buildHandle(P) });
    }
  }

  return { parts, warnings, view2d, size: mainSize(outline, P), SC };
}

// Tamaño de la pieza principal: el cortante (sin pestaña) o la base del sello.
function mainSize(outline, P) {
  const b = bbox(P.mode === 'stamp' ? outline : offset(outline, P.wallBase));
  return { w: b.x1 - b.x0, h: b.y1 - b.y0 };
}

// Calcula rápido el tamaño final (sin armar las piezas 3D), para ajustar la escala.
export function measure(design, P) {
  return mainSize(computeOutline(prepareArt(design, P), P), P);
}

// Como toExPolys, pero sin limpiar puntos: el rodillo necesita que el dibujo y el fondo
// conserven exactamente los mismos vértices en su borde común.
function rawExPolys(paths) {
  const c = new C.Clipper();
  c.StrictlySimple = true;
  c.PreserveCollinear = true;
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const res = [];
  const walk = (node) => {
    for (const ch of node.Childs()) {
      if (ch.IsHole()) continue;
      res.push({ outer: fromClip(ch.Contour()), holes: ch.Childs().map((h) => fromClip(h.Contour())) });
      for (const h of ch.Childs()) walk(h);
    }
  };
  walk(tree);
  return res.filter((e) => e.outer.length >= 3);
}

// Parte un triángulo (u, v) en las líneas de corte verticales. Devuelve polígonos convexos antihorarios.
function splitTriangle(tri, crossings) {
  let [A, B, Q] = tri;
  if ((B[0] - A[0]) * (Q[1] - A[1]) - (Q[0] - A[0]) * (B[1] - A[1]) < 0) [B, Q] = [Q, B];
  const ring = [], cutXs = new Set();
  for (const [p, q] of [[A, B], [B, Q], [Q, A]]) {
    const cr = crossings(p, q);
    cr.forEach((c) => cutXs.add(c[0]));
    ring.push(p, ...cr);
  }
  if (ring.length === 3) return [ring];
  const lo = Math.min(A[0], B[0], Q[0]), hi = Math.max(A[0], B[0], Q[0]);
  const xs = [...cutXs].sort((a, b) => a - b);
  const bounds = [lo, ...xs, hi];
  const pieces = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i] - 1e-9, b = bounds[i + 1] + 1e-9;
    const poly = ring.filter((p) => p[0] >= a && p[0] <= b);
    if (poly.length >= 3) pieces.push(poly);
  }
  return pieces;
}

// Repara "uniones en T": un lado de triángulo que pasa justo por el vértice de otro
// (earcut lo hace a veces con puntos alineados). Ese triángulo se parte en el vértice.
function fixTJunctions(tris) {
  const key = (p) => p[0] + ',' + p[1];
  const CELL = 2;
  for (let pass = 0; pass < 8; pass++) {
    const edges = new Map();
    tris.forEach((t, ti) => { for (let e = 0; e < 3; e++) edges.set(key(t[e]) + '|' + key(t[(e + 1) % 3]), [ti, e]); });
    const open = [];
    const grid = new Map();
    const addPt = (p) => {
      const c = Math.floor(p[0] / CELL) + ',' + Math.floor(p[1] / CELL);
      const list = grid.get(c);
      if (!list) grid.set(c, [p]); else if (!list.some((q) => q[0] === p[0] && q[1] === p[1])) list.push(p);
    };
    for (const [k, te] of edges) {
      const [ka, kb] = k.split('|');
      if (edges.has(kb + '|' + ka)) continue;
      const t = tris[te[0]];
      open.push(te);
      addPt(t[te[1]]); addPt(t[(te[1] + 1) % 3]);
    }
    const replace = new Map();
    for (const [ti, e] of open) {
      if (replace.has(ti)) continue;
      const t = tris[ti], a = t[e], b = t[(e + 1) % 3], c = t[(e + 2) % 3];
      const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
      let best = null, bestT = 2;
      for (let gx = Math.floor(Math.min(a[0], b[0]) / CELL); gx <= Math.floor(Math.max(a[0], b[0]) / CELL); gx++) {
        for (let gy = Math.floor(Math.min(a[1], b[1]) / CELL); gy <= Math.floor(Math.max(a[1], b[1]) / CELL); gy++) {
          for (const p of grid.get(gx + ',' + gy) || []) {
            const s = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
            if (s <= 1e-9 || s >= 1 - 1e-9) continue;
            const dist = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(len2);
            if (dist < 1e-6 && s < bestT) { best = p; bestT = s; }
          }
        }
      }
      if (best) replace.set(ti, [[a, best, c], [best, b, c]]);
    }
    if (!replace.size) break;
    tris = tris.flatMap((t, ti) => replace.get(ti) || [t]);
  }
  return tris;
}

// ---------- Rodillo texturizador ----------
// Se trabaja sobre el rodillo "desenrollado": u = alrededor (0..circunferencia), v = a lo largo.
// El dibujo y el resto de la superficie se triangulan por franjas finas en u, para que
// al enrollarlas cada triángulo siga la curva del cilindro.

const mapPaths = (paths, fn) => paths.map((p) => p.map((q) => {
  const [x, y] = fn(q.X / SC, q.Y / SC);
  return { X: Math.round(x * SC), Y: Math.round(y * SC) };
}));

export function buildRoller(design, P) {
  const warnings = [];
  const R = P.rollerDiameter / 2;
  const W = Math.round(2 * Math.PI * R * SC) / SC; // circunferencia, redondeada a la grilla de Clipper
  const L = P.rollerLength, m = P.rollerMargin;
  const depth = P.rollerDepth;
  const raised = P.rollerMark === 'raised';
  if (!raised && depth > R - 2) warnings.push('El dibujo es más profundo que lo que permite el diámetro.');

  // agujero pasante: la pared se mide en su parte más fina (hasta el fondo del dibujo si va hundido)
  const minR = raised ? R : R - depth;
  let holeR = 0;
  if (P.rollerHole) {
    holeR = P.holeBy === 'wall' ? minR - P.rollerWall : P.holeDiameter / 2;
    if (minR - holeR < 1) {
      warnings.push('La pared quedaría de menos de 1 mm: el rodillo sale sin agujero. Achicá el agujero o agrandá el diámetro.');
      holeR = 0;
    } else if (holeR < 1) {
      warnings.push('El agujero quedaría de menos de 2 mm: el rodillo sale macizo.');
      holeR = 0;
    }
  }

  // motivo: rotado si se pide, con su caja
  let tile = design.paths;
  if (P.rollerRotate) tile = mapPaths(tile, (x, y) => [-y, x]);
  const tb = bbox(tile);
  const tw = tb.x1 - tb.x0, th = tb.y1 - tb.y0;

  const single = P.rollerPattern === 'single';
  const nu = single ? 1 : P.repAround, nv = single ? 1 : P.repAlong;
  const cellW = W / nu, cellH = (L - 2 * m) / nv;
  const gap = P.patternGap;
  const s = Math.min((cellW - gap) / tw, (cellH - gap) / th);
  if (!(s > 0)) {
    return { parts: [], warnings: ['No entra el dibujo: achicá la separación o el margen, o agrandá el rodillo.'], view2d: null, size: null, SC };
  }
  let scaled = mapPaths(tile, (x, y) => [(x - (tb.x0 + tb.x1) / 2) * s, (y - (tb.y0 + tb.y1) / 2) * s]);
  if (P.thicken) scaled = union(offset(scaled, P.thicken));
  // limpia puntos casi alineados (las curvas del texto traen muchos); antes de repetir y cortar en la unión
  scaled = C.Clipper.CleanPolygons(scaled, 0.01 * SC);

  const copies = [];
  for (let j = 0; j < nv; j++) {
    const shift = P.rollerPattern === 'brick' && j % 2 ? cellW / 2 : 0;
    for (let i = 0; i < nu; i++) {
      // corrimiento de milésimas por copia: si las copias quedan exactamente alineadas,
      // el triangulador (earcut) puede trazar lados que pasan justo por otro vértice
      const jitter = ((i * 37 + j * 11) % 13) * 0.001;
      const cu = (i + 0.5) * cellW + shift + jitter, cv = m + (j + 0.5) * cellH + jitter;
      // copias a ambos lados (corridas en enteros exactos) para que lo que cruza la unión aparezca del otro lado
      const placed = mapPaths(scaled, (x, y) => [x + cu, y + cv]);
      const WI = Math.round(W * SC);
      for (const k of [-1, 0, 1]) copies.push(...placed.map((p) => p.map((q) => ({ X: q.X + k * WI, Y: q.Y }))));
    }
  }
  const rect = [toClip([[0, 0], [W, 0], [W, L], [0, L]])];
  // se conservan los puntos alineados: el dibujo y el fondo tienen que compartir todos los vértices del borde
  const NZ = C.PolyFillType.pftNonZero;
  let D = boolean(C.ClipType.ctIntersection, union(copies), rect, NZ, true);
  // lo que cruza la unión se corta dos veces (en u = 0 y u = W) y el redondeo puede diferir
  // en una milésima: los puntos del lado W toman la altura exacta del lado 0
  const WI = Math.round(W * SC);
  const side0 = D.flat().filter((p) => p.X === 0).map((p) => p.Y);
  D = D.map((path) => path.map((p) => {
    if (p.X !== WI) return p;
    // el más cercano a menos de 5 milésimas
    let near = p.Y, best = 6;
    for (const y of side0) {
      const dist = Math.abs(y - p.Y);
      if (dist < best) { best = dist; near = y; }
    }
    return { X: p.X, Y: near };
  }));
  const Cpl = boolean(C.ClipType.ctDifference, rect, D, NZ, true);
  if (!D.length) warnings.push('El dibujo quedó vacío.');

  // líneas de corte en u, lo bastante juntas para que la cuerda se aparte menos de 0,025 mm del cilindro
  const strip = Math.min(3, Math.sqrt(8 * Math.min(R, R - (raised ? 0 : depth)) * 0.025));
  const n = Math.ceil(W / strip);
  const cuts = Array.from({ length: n + 1 }, (_, k) => (k * W) / n);
  const rD = raised ? R + depth : R - depth;

  const m3 = new MeshBuilder();
  const to3 = ([u, v], r) => {
    const t = u >= W - 1e-9 ? 0 : (2 * Math.PI * u) / W;
    return [r * Math.cos(t), r * Math.sin(t), v];
  };
  // Puntos donde un segmento cruza las líneas de corte. Se calculan siempre desde los
  // extremos ordenados, así dos triángulos que comparten el lado obtienen exactamente los mismos.
  const firstCut = (u) => Math.floor((u * n) / W + 1e-9) + 1;
  const crossings = (a, b) => {
    const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? [a, b] : [b, a];
    const out = [];
    for (let k = firstCut(p[0]); k <= n && cuts[k] < q[0] - 1e-9; k++) {
      out.push([cuts[k], p[1] + ((cuts[k] - p[0]) / (q[0] - p[0])) * (q[1] - p[1])]);
    }
    return p === a ? out : out.reverse();
  };

  // los dos lados de la unión (u = 0 y u = W) se pegan en 3D: tienen que tener los mismos puntos
  const regions = [[rawExPolys(D), rD], [rawExPolys(Cpl), R]];
  const seamVs = new Set();
  for (const [exs] of regions) for (const ex of exs) for (const l of [ex.outer, ...ex.holes]) {
    for (const p of l) if (p[0] === 0 || p[0] === W) seamVs.add(p[1]);
  }
  // Clipper puede redondear distinto cada lado: los valores a menos de 0,006 mm se unifican
  const canon = new Map();
  let start = null;
  for (const v of [...seamVs].sort((a, b) => a - b)) {
    if (start === null || v - start > 0.0065) start = v;
    canon.set(v, start);
  }
  for (const [exs] of regions) for (const ex of exs) for (const l of [ex.outer, ...ex.holes]) {
    for (const p of l) if (p[0] === 0 || p[0] === W) p[1] = canon.get(p[1]);
  }
  for (const [exs] of regions) for (const ex of exs) {
    // quita puntos repetidos que haya dejado la unificación
    ex.outer = ex.outer.filter((p, i, l) => { const q = l[(i + 1) % l.length]; return p[0] !== q[0] || p[1] !== q[1]; });
    ex.holes = ex.holes.map((h) => h.filter((p, i, l) => { const q = l[(i + 1) % l.length]; return p[0] !== q[0] || p[1] !== q[1]; }));
  }
  const sortedVs = [...new Set(canon.values())].sort((a, b) => a - b);
  const densify = (loop) => loop.flatMap((a, i) => {
    const b = loop[(i + 1) % loop.length];
    if (a[0] !== b[0] || (a[0] !== 0 && a[0] !== W)) return [a];
    const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
    const mid = sortedVs.filter((v) => v > lo && v < hi).map((v) => [a[0], v]);
    return [a, ...(a[1] < b[1] ? mid : mid.reverse())];
  });

  let split = 0; // hasta acá el dibujo (para pintarlo distinto en la vista)
  for (const [exs, r] of regions) {
    const region = r === rD ? D : Cpl;
    if (region === Cpl) split = m3.p.length;
    for (const ex0 of exs) {
      const ex = { outer: densify(ex0.outer), holes: ex0.holes.map(densify) };
      const outer = orient(ex.outer, true);
      const holes = ex.holes.map((h) => orient(h, false));
      const v2 = (l) => l.map(([x, y]) => new THREE.Vector2(x, y));
      const all = outer.concat(...holes);
      // superficie: cada triángulo se parte en las líneas de corte
      let surf = [];
      for (const [i, j, q] of THREE.ShapeUtils.triangulateShape(v2(outer), holes.map(v2))) {
        splitTriangle([all[i], all[j], all[q]], crossings).forEach((poly) => {
          for (let t = 1; t < poly.length - 1; t++) surf.push([poly[0], poly[t], poly[t + 1]]);
        });
      }
      surf = fixTJunctions(surf);
      for (const [a, b, q] of surf) m3.tri(to3(a, r), to3(b, r), to3(q, r));
      if (region !== D) continue;
      // paredes del dibujo; en relieve la normal sale del dibujo, hundido entra en él
      for (const loop of [outer, ...holes]) {
        for (let i = 0; i < loop.length; i++) {
          const a = loop[i], b = loop[(i + 1) % loop.length];
          if (a[0] === b[0] && (a[0] === 0 || a[0] === W)) continue; // la unión del rodillo no es pared
          const pts = [a, ...crossings(a, b), b];
          for (let s2 = 0; s2 < pts.length - 1; s2++) {
            const [p, q] = raised ? [pts[s2], pts[s2 + 1]] : [pts[s2 + 1], pts[s2]];
            m3.quad(to3(p, Math.min(R, rD)), to3(q, Math.min(R, rD)), to3(q, Math.max(R, rD)), to3(p, Math.max(R, rD)));
          }
        }
      }
    }
  }

  // el agujero es un polígono: sus vértices van un poco afuera para que las caras planas
  // queden justo en el radio pedido y el eje nunca encuentre un agujero más chico
  const holeV = holeR / Math.cos(Math.PI / n);

  // tapas de los extremos (el dibujo no llega a los bordes por el margen):
  // discos si es macizo, aros si tiene agujero
  for (const [v, up] of [[0, false], [L, true]]) {
    const center = [0, 0, v];
    for (let k = 0; k < n; k++) {
      const a = to3([cuts[k], v], R), b = to3([cuts[k + 1], v], R);
      if (!holeR) {
        if (up) m3.tri(center, a, b); else m3.tri(center, b, a);
        continue;
      }
      const ai = to3([cuts[k], v], holeV), bi = to3([cuts[k + 1], v], holeV);
      if (up) m3.quad(a, b, bi, ai); else m3.quad(b, a, ai, bi);
    }
  }
  // pared interior del agujero, con la normal hacia el eje
  if (holeR) {
    for (let k = 0; k < n; k++) {
      const a0 = to3([cuts[k], 0], holeV), b0 = to3([cuts[k + 1], 0], holeV);
      const a1 = to3([cuts[k], L], holeV), b1 = to3([cuts[k + 1], L], holeV);
      m3.quad(b0, a0, a1, b1);
    }
  }

  return {
    parts: [{ name: 'Rodillo', color: 0xF0196E, accent: 0x3BBFB0, split, tris: new Float32Array(m3.p) }],
    warnings,
    view2d: { art: mapPaths(D, (x, y) => [x, y]), plate: rect, cutter: null, socket: null },
    size: { w: P.rollerDiameter, h: L, roller: true, hole: holeR * 2, wall: holeR ? minR - holeR : 0 },
    SC,
  };
}

export function pathsToSvg(paths) {
  return paths.map((p) => 'M' + p.map((q) => `${(q.X / SC).toFixed(3)},${(-q.Y / SC).toFixed(3)}`).join('L') + 'Z').join('');
}
