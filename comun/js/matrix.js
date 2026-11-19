// Matrices para moldes de yeso de colada, de 1 o 2 taceles, a partir del STL de la pieza.
//
// 1 tacel (tazas, vasos, cuencos que se abren hacia la boca): la pieza va boca abajo sobre la placa,
//   apoyada en un collar de colada 2 mm más ancho que la boca.
// 2 taceles (floreros, botellas): la pieza se parte al medio a lo largo y la mitad va acostada sobre
//   la placa, con un canal de colada desde la boca hasta el borde. Las llaves (2 botones y 2 huecos)
//   van en espejo: al enfrentar dos bloques de yeso colados con la misma matriz, los botones de uno
//   calzan en los huecos del otro. Si la pieza no es igual de los dos lados, sale una matriz para
//   cada mitad, con las mismas llaves.
// Encofrado: la placa tiene un bisel a 45° en el borde de arriba; las paredes, partidas en dos, la
//   rodean con 0,3 mm de juego y la traban por encima del bisel (así la placa no flota en el yeso).
//   Las dos mitades se cierran con broches que se deslizan desde arriba sobre las aletas.
import { geo } from './geometry.js';

const { C, MeshBuilder, toClip, union, diff, intersect, offset, toExPolys, extrude, cap, circlePath, roundedRect, bbox, areaOf, signedArea, pip } = geo;

const E = {
  bevel: 3,           // bisel del borde de la placa
  clr: 0.3,           // juego entre la placa y las paredes
  lipH: 2, lipIn: 3,  // pestaña de abajo de las paredes: alto y cuánto entra debajo de la placa
  clrV: 0.1,          // juego vertical entre la placa y el bisel de las paredes
  wallT: 3,           // espesor de las paredes
  tabT: 3, tabL: 8,   // aletas de las juntas
  clipGap: 0.15,      // juego por lado entre broche y aletas
  clipT: 2.5,         // espesor del broche
  step: 0.2,          // escalones del bisel y de los huecos de las llaves (una capa de impresión)
  lip: 2,             // 1 tacel: el collar es 2 mm más ancho que la boca
  coladaLess: 5,      // 2 taceles: el canal es 5 mm más angosto que la boca
};
const BIG = 5000;
const EO = C.PolyFillType.pftEvenOdd;
const rect = (x0, y0, x1, y1) => toClip([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);

// ---------- STL ----------

export function parseSTL(buf) {
  const dv = new DataView(buf);
  const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  const readBin = () => {
    const t = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) for (let j = 0; j < 9; j++) t[i * 9 + j] = dv.getFloat32(84 + i * 50 + 12 + j * 4, true);
    return t;
  };
  if (n > 0 && 84 + n * 50 === buf.byteLength) return readBin();
  const txt = new TextDecoder().decode(buf);
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  const v = [];
  for (let mm; (mm = re.exec(txt));) v.push(+mm[1], +mm[2], +mm[3]);
  if (v.length >= 9 && v.length % 9 === 0 && v.every(Number.isFinite)) return new Float32Array(v);
  if (n > 0 && 84 + n * 50 <= buf.byteLength) return readBin();
  throw new Error('No pude leer ese STL.');
}

function mapTris(t, f) {
  const out = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 3) {
    const q = f(t[i], t[i + 1], t[i + 2]);
    out[i] = q[0]; out[i + 1] = q[1]; out[i + 2] = q[2];
  }
  return out;
}

// [x0, y0, z0, x1, y1, z1]
function bounds3(t) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (t[i + k] < b[k]) b[k] = t[i + k];
      if (t[i + k] > b[k + 3]) b[k + 3] = t[i + k];
    }
  }
  return b;
}

export function pieceSize(t) {
  const b = bounds3(t);
  return [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
}

// Sólido de revolución a partir de un perfil [(radio, z), ...] que arranca y termina en el eje.
function revolveTris(profile, n = 128, cx = 0, cy = 0) {
  const out = [];
  const pt = (r, z, i) => {
    const a = (2 * Math.PI * (i % n)) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
  };
  const same = (p, q) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
  const tri = (a, b, c) => { if (!same(a, b) && !same(b, c) && !same(a, c)) out.push(...a, ...b, ...c); };
  for (let k = 0; k < profile.length - 1; k++) {
    const [r0, z0] = profile[k], [r1, z1] = profile[k + 1];
    for (let i = 0; i < n; i++) {
      const A = pt(r0, z0, i), B = pt(r0, z0, i + 1), Q = pt(r1, z1, i + 1), D = pt(r1, z1, i);
      tri(A, B, Q); tri(A, Q, D);
    }
  }
  return out;
}

// Piezas de ejemplo, en mm de la pieza cocida
export function examplePiece(kind) {
  if (kind === 'florero') {
    const ctrl = [[0, 30], [10, 38], [32, 47], [55, 46], [80, 34], [100, 21], [114, 18], [124, 21], [130, 24]]; // [z, radio]
    const prof = [[0, 0]];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      for (let s = 0; s < 8; s++) {
        const t = s / 8;
        const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
        prof.push([cr(p0[1], p1[1], p2[1], p3[1]), cr(p0[0], p1[0], p2[0], p3[0])]);
      }
    }
    prof.push([24, 130], [0, 130]);
    return { name: 'Florero de ejemplo', file: 'matriz-florero', tris: new Float32Array(revolveTris(prof)), tassels: '2' };
  }
  return { name: 'Vaso de ejemplo', file: 'matriz-vaso', tris: new Float32Array(revolveTris([[0, 0], [30, 0], [42, 90], [0, 90]])), tassels: '1' };
}

// Centra la pieza, la apoya en z = 0 y la lleva al alto pedido (en crudo). "flip" la da vuelta.
function normalizePiece(src, rawH, flip) {
  const b = bounds3(src);
  const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2;
  const k = rawH / (b[5] - b[2] || 1);
  return mapTris(src, (x, y, z) => (flip
    ? [(x - cx) * k, -(y - cy) * k, (b[5] - z) * k] // giro de 180° (no espejo)
    : [(x - cx) * k, (y - cy) * k, (z - b[2]) * k]));
}

// ---------- Cortes de la malla ----------

// Punto donde la arista (a, b) cruza el plano z = z0. Se calcula siempre desde los extremos
// ordenados: así los dos triángulos que comparten la arista obtienen exactamente el mismo punto.
function crossEdge(t, a, b, z0) {
  const first = t[a] < t[b] || (t[a] === t[b] && (t[a + 1] < t[b + 1] || (t[a + 1] === t[b + 1] && t[a + 2] < t[b + 2])));
  const [p, q] = first ? [a, b] : [b, a];
  const s = (z0 - t[p + 2]) / (t[q + 2] - t[p + 2]);
  return [t[p] + s * (t[q] - t[p]), t[p + 1] + s * (t[q + 1] - t[p + 1])];
}

// Une los segmentos del corte en contornos cerrados (exteriores antihorarios, agujeros horarios).
function chain(segs) {
  const key = (p) => p[0] + ',' + p[1];
  const next = new Map();
  for (const [a, b] of segs) if (key(a) !== key(b)) next.set(key(a), [a, b]);
  const loops = [], used = new Set();
  let closed = 0;
  for (const k0 of next.keys()) {
    if (used.has(k0)) continue;
    const loop = [];
    let k = k0;
    while (next.has(k) && !used.has(k)) {
      used.add(k);
      const [a, b] = next.get(k);
      loop.push(a);
      k = key(b);
    }
    if (k === k0 && loop.length >= 3) { loops.push(loop); closed += loop.length; }
  }
  return { loops, open: segs.length > 0 && closed < segs.length * 0.98 };
}

// Corta la malla con el plano z = z0. Devuelve el contorno del corte y, si keep, la parte de arriba.
function cutMesh(t, z0, keep) {
  const out = keep ? [] : null, segs = [];
  for (let i = 0; i < t.length; i += 9) {
    const up = [t[i + 2] >= z0, t[i + 5] >= z0, t[i + 8] >= z0];
    const nUp = up[0] + up[1] + up[2];
    if (nUp === 0) continue;
    if (nUp === 3) {
      if (keep) for (let j = 0; j < 9; j++) out.push(t[i + j]);
      continue;
    }
    const poly = [];
    let leave = null, enter = null;
    for (let e = 0; e < 3; e++) {
      const a = i + e * 3, b = i + ((e + 1) % 3) * 3;
      if (up[e]) poly.push([t[a], t[a + 1], t[a + 2]]);
      if (up[e] !== up[(e + 1) % 3]) {
        const [x, y] = crossEdge(t, a, b, z0);
        poly.push([x, y, z0]);
        if (up[e]) leave = [x, y]; else enter = [x, y];
      }
    }
    segs.push([leave, enter]);
    if (keep) for (let k = 1; k < poly.length - 1; k++) out.push(...poly[0], ...poly[k], ...poly[k + 1]);
  }
  const { loops, open } = chain(segs);
  return { tris: keep ? new Float32Array(out) : null, loops, open };
}

// Corte horizontal como polígonos de Clipper
function sliceAt(t, z) {
  const { loops } = cutMesh(t, z, false);
  return loops.length ? union(loops.map(toClip), EO) : [];
}

// Tapa los contornos del corte (cada exterior con sus agujeros) en el plano z.
function capLoops(m, loops, z, up) {
  const groups = loops.filter((l) => signedArea(l) > 0).map((o) => ({ o, h: [], a: signedArea(o) }));
  for (const h of loops.filter((l) => signedArea(l) < 0)) {
    let best = null;
    for (const g of groups) if (pip(g.o, h[0][0], h[0][1]) && (!best || g.a < best.a)) best = g;
    if (best) best.h.push(h);
  }
  for (const g of groups) cap(m, g.o, g.h, z, up);
}

// La pieza tiene que ir achicándose a medida que se aleja de la placa: si un corte de más arriba
// se sale del de más abajo, hay contrasalida y no desmolda.
function hasUndercut(t, z0, z1) {
  let prev = null;
  for (let k = 0; k <= 24; k++) {
    const s = sliceAt(t, z0 + (z1 - z0) * (0.02 + (0.96 * k) / 24) + 1.37e-4);
    if (prev && areaOf(diff(s, offset(prev, 0.3))) > 1) return true;
    prev = s;
  }
  return false;
}

// ¿Las dos mitades son iguales? (pieza simétrica respecto del corte)
function sameHalves(TA, TB, z0, z1) {
  for (const f of [0.1, 0.35, 0.6, 0.85]) {
    const z = z0 + (z1 - z0) * f + 1.13e-4;
    const a = sliceAt(TA, z), b = sliceAt(TB, z);
    if (areaOf(diff(a, offset(b, 0.15))) + areaOf(diff(b, offset(a, 0.15))) > 1) return false;
  }
  return true;
}

// ---------- Encofrado ----------

// Contorno de la placa a la altura z (se achica en el bisel)
const plateAt = (plate, z, e, b) => (z > e - b + 1e-6 ? offset(plate, -(z - (e - b))) : plate);

// Escalones de 0,2 mm desde la superficie hacia abajo, hasta zMin: [[z0, z1], ...]
function steps(e, zMin) {
  const out = [];
  const n = Math.round((e - zMin) / E.step);
  for (let k = 0; k < n; k++) out.push([e - (k + 1) * E.step, e - k * E.step]);
  return out;
}

const pushTris = (m, t) => { for (let i = 0; i < t.length; i++) m.p.push(t[i]); };

// Placa con bisel y huecos semiesféricos para las llaves (en escalones de una capa)
function buildPlate(m, plate, e, b, pockets) {
  const depth = Math.max(b, ...pockets.map((p) => p.r));
  const zA = Math.max(0.6, e - Math.ceil(depth / E.step) * E.step);
  toExPolys(plate).forEach((ex) => extrude(m, ex, 0, zA));
  for (const [z0, z1] of steps(e, zA)) {
    let sh = plateAt(plate, z1, e, b);
    const holes = pockets.filter((p) => p.r * p.r - (e - z1) ** 2 > 0.04)
      .map((p) => circlePath(p.x, p.y, Math.sqrt(p.r * p.r - (e - z1) ** 2), 64));
    if (holes.length) sh = diff(sh, holes);
    toExPolys(sh).forEach((ex) => extrude(m, ex, z0 - 0.05, z1));
  }
}

// Media pared (side = 1 a la derecha, -1 a la izquierda) con sus aletas, y los broches.
// La placa apoya sobre una pestaña de abajo (entra 3 mm debajo de ella) y el bisel la traba por
// arriba: así no flota en el yeso y tampoco se cae al levantar el molde.
// H es el alto desde la base de la placa; las paredes miden lipH + clrV más.
function wallParts(plate, e, b, H) {
  const zb = E.lipH, dz = E.lipH + E.clrV; // la placa apoya en z = zb; el bisel de la pared va dz más arriba
  const outer = offset(plate, E.clr + E.wallT);
  const ob = bbox(intersect(outer, [rect(-0.01, -BIG, 0.01, BIG)]));
  const parts = [];
  for (const s of [1, -1]) {
    const xa = Math.min(0, s * E.tabT), xb = Math.max(0, s * E.tabT);
    const tabs = [rect(xa, ob.y1 - E.wallT, xb, ob.y1 + E.tabL), rect(xa, ob.y0 - E.tabL, xb, ob.y0 + E.wallT)];
    const side = [s > 0 ? rect(0, -BIG, BIG, BIG) : rect(-BIG, -BIG, 0, BIG)];
    const shape = (inner) => union(intersect(diff(outer, inner), side).concat(tabs));
    const ring = (z) => shape(offset(plateAt(plate, z, e, b), E.clr));
    const m = new MeshBuilder();
    toExPolys(shape(offset(plate, -E.lipIn))).forEach((ex) => extrude(m, ex, 0, zb)); // pestaña
    toExPolys(ring(0)).forEach((ex) => extrude(m, ex, zb - 0.05, dz + e - b));
    for (const [z0, z1] of steps(e, e - b)) toExPolys(ring(z1)).forEach((ex) => extrude(m, ex, dz + z0 - 0.05, dz + z1));
    toExPolys(ring(e)).forEach((ex) => extrude(m, ex, dz + e - 0.05, dz + H));
    parts.push({ name: `Pared ${s > 0 ? 1 : 2}`, color: 0xE8D84A, tris: new Float32Array(m.p) });
  }
  // broche en C: abraza las dos aletas de una junta
  const w = E.tabT + E.clipGap, o = w + E.clipT, L = E.tabL + E.clipGap;
  const prof = diff([rect(-o, 0.4, o, L + E.clipT)], [rect(-w, -1, w, L)]);
  for (const k of [1, 2]) {
    const m = new MeshBuilder();
    toExPolys(prof).forEach((ex) => extrude(m, ex, 0, dz + H));
    parts.push({ name: `Broche ${k}`, color: 0x9ACD32, tris: new Float32Array(m.p) });
  }
  return { parts, height: dz + H, rings: union(diff(outer, offset(plateAt(plate, e, e, b), E.clr)).concat(
    [1, -1].flatMap((s) => [rect(Math.min(0, s * E.tabT), ob.y1 - E.wallT, Math.max(0, s * E.tabT), ob.y1 + E.tabL),
      rect(Math.min(0, s * E.tabT), ob.y0 - E.tabL, Math.max(0, s * E.tabT), ob.y0 + E.wallT)]))) };
}

// Botón semiesférico de una llave (hundido 0,3 mm en la placa para que el slicer lo una)
function bump(x, y, r, e) {
  const prof = [[0, e - 0.3], [r, e - 0.3], [r, e]];
  for (let k = 1; k <= 12; k++) {
    const a = (k / 12) * (Math.PI / 2);
    prof.push([k === 12 ? 0 : r * Math.cos(a), e + r * Math.sin(a)]);
  }
  return revolveTris(prof, 64, x, y);
}

// Prisma con perfil (x, z) a lo largo de y, entre y0 e y1
function prismY(profile, y0, y1) {
  const m = new MeshBuilder();
  toExPolys(union([toClip(profile)])).forEach((ex) => extrude(m, ex, -y1, -y0));
  // (u, v, w) -> (u, -w, v): giro de 90° en X (no espeja, las caras siguen mirando afuera)
  return mapTris(new Float32Array(m.p), (u, v, w) => [u, -w, v]);
}

// ---------- Matriz ----------

const fmt = (x) => String(+x.toFixed(1)).replace('.', ',');

export function buildMatrix(src, P) {
  const warnings = [];
  const rawH = P.moldHeight / (1 - P.shrink / 100);
  const e = P.plateThickness, b = Math.min(E.bevel, e - 2), mg = P.moldMargin;
  const piece = normalizePiece(src, rawH, P.flip);
  const pb = bounds3(piece);
  const halfW = Math.max(-pb[0], pb[3]);
  const parts = [];
  let plate, art, H, info;

  if (P.tassels === '1') {
    // ----- 1 tacel: boca abajo, sobre el collar de colada
    const Zb = e + P.collarHeight;
    const T = mapTris(piece, (x, y, z) => [x, -y, Zb + rawH - z]);
    const mouthCut = cutMesh(T, Zb + 0.3137, false);
    if (!mouthCut.loops.length) warnings.push('No encontré la boca de la pieza. Tiene que estar parada, con la boca hacia arriba: probá con "Dar vuelta".');
    if (mouthCut.open) warnings.push('El STL tiene agujeros o caras sueltas: puede salir con fallas. Conviene repararlo antes (por ejemplo en Bambu Studio).');
    const collar = offset(union(mouthCut.loops.map(toClip), EO), E.lip);
    if (hasUndercut(T, Zb, Zb + rawH)) {
      warnings.push('La pieza se angosta hacia la boca (tiene contrasalidas): con 1 tacel no va a salir del yeso. Si la subiste boca abajo, marcá "Dar vuelta"; si no, probá con 2 taceles.');
    }
    let R = 0;
    for (let i = 0; i < T.length; i += 3) R = Math.max(R, Math.hypot(T[i], T[i + 1]));
    for (const p of collar) for (const q of p) R = Math.max(R, Math.hypot(q.X, q.Y) / geo.SC);
    plate = [circlePath(0, 0, R + mg + b, 192)];
    H = Zb + rawH + mg;

    const m = new MeshBuilder();
    buildPlate(m, plate, e, b, []);
    const split = m.p.length;
    toExPolys(collar).forEach((ex) => extrude(m, ex, e - 0.2, Zb));
    pushTris(m, T);
    parts.push({ name: 'Matriz', color: 0x3BBFB0, accent: 0xF0196E, split, tris: new Float32Array(m.p) });
    const cuts = [];
    for (let k = 0; k <= 10; k++) cuts.push(...sliceAt(T, Zb + rawH * (0.01 + 0.98 * k / 10) + 1.7e-4));
    art = union(cuts.concat(collar));
    info = '1 tacel';
  } else {
    // ----- 2 taceles: media pieza acostada, con canal de colada hasta el borde
    const d = 1e-3; // el corte va 0,001 mm al costado del centro para no pasar justo por vértices
    const Y0 = -mg - b, Y1 = rawH + P.coladaLength + b, cy = (Y0 + Y1) / 2;
    // (x, y, z) -> (x, z, -y): giro de 90°; la boca queda hacia +Y y el corte en el plano de la placa
    const lay = (t) => mapTris(t, (x, y, z) => [x, z - cy, e - y - d]);
    const TA = lay(piece), TB = lay(mapTris(piece, (x, y, z) => [-x, -y, z]));
    const cutA = cutMesh(TA, e, true), cutB = cutMesh(TB, e, true);
    if (!cutA.loops.length) {
      return { parts: [], warnings: ['No pude partir la pieza al medio. Revisá que el STL sea una pieza maciza y cerrada.'], view2d: null, size: null, SC: geo.SC };
    }
    if (cutA.open || cutB.open) warnings.push('El STL tiene agujeros o caras sueltas: el corte al medio puede salir con fallas. Conviene repararlo antes (por ejemplo en Bambu Studio).');
    const hA = bounds3(cutA.tris)[5] - e, hB = bounds3(cutB.tris)[5] - e;
    const same = sameHalves(TA, TB, e, e + Math.min(hA, hB));
    if (hasUndercut(TA, e, e + hA) || (!same && hasUndercut(TB, e, e + hB))) {
      warnings.push('Hay partes que no salen del yeso aunque la pieza se parta al medio (contrasalidas). Revisá la forma o cómo está parada.');
    }
    const X1 = halfW + mg + b;
    plate = [roundedRect(-X1, Y0 - cy, X1, Y1 - cy, 10)];
    H = e + Math.max(hA, hB) + mg;

    // canal de colada: medio cilindro desde la boca hasta el borde de la placa (antes del bisel)
    const mouth = sliceAt(piece, rawH - 0.3137);
    if (!mouth.length) warnings.push('No encontré la boca de la pieza. Tiene que estar parada, con la boca hacia arriba: probá con "Dar vuelta".');
    const mb = mouth.length ? bbox(mouth) : { x0: -halfW / 2, x1: halfW / 2 };
    const rc = Math.max(2, (mb.x1 - mb.x0 - E.coladaLess) / 2), mx = (mb.x0 + mb.x1) / 2;
    const prof = [[mx + rc, e - 0.3]];
    for (let k = 0; k <= 48; k++) prof.push([mx + rc * Math.cos((k / 48) * Math.PI), e + rc * Math.sin((k / 48) * Math.PI)]);
    prof.push([mx - rc, e - 0.3]);
    const yc0 = rawH - 2 - cy, yc1 = Y1 - b - cy;
    const colada = prismY(prof, yc0, yc1);

    // llaves: botón y hueco enfrentados en espejo, cruzados entre las dos alturas
    const rh = Math.min(4.8, e - 1.6), rk = rh + 0.2;
    const kx = halfW + mg / 2, ky = [0.25, 0.75].map((f) => rawH * f - cy);
    const bumps = [[kx, ky[0]], [-kx, ky[1]]], pockets = [[-kx, ky[0]], [kx, ky[1]]];

    const matrix = (name, half) => {
      const m = new MeshBuilder();
      buildPlate(m, plate, e, b, pockets.map(([x, y]) => ({ x, y, r: rh })));
      const split = m.p.length;
      pushTris(m, half.tris);
      capLoops(m, half.loops, e, false);
      pushTris(m, colada);
      bumps.forEach(([x, y]) => pushTris(m, bump(x, y, rk, e)));
      return { name, color: 0x3BBFB0, accent: 0xF0196E, split, tris: new Float32Array(m.p) };
    };
    if (same) {
      parts.push(matrix('Matriz', cutA));
    } else {
      parts.push(matrix('Matriz A', cutA), matrix('Matriz B', cutB));
    }
    art = union(sliceAt(TA, e + 0.0513).concat(
      [rect(mx - rc, yc0, mx + rc, yc1)],
      bumps.map(([x, y]) => circlePath(x, y, rk, 48)),
      pockets.map(([x, y]) => circlePath(x, y, rh, 48)),
    ));
    info = same ? '2 taceles, 1 matriz para las dos mitades' : '2 taceles, 1 matriz por mitad (la pieza no es igual de los dos lados)';
  }

  const walls = wallParts(plate, e, b, H);
  parts.push(...walls.parts);
  const pbx = bbox(plate);
  const pw = pbx.x1 - pbx.x0, ph = pbx.y1 - pbx.y0;
  if (Math.max(pw, ph) + 2 * (E.clr + E.wallT) > 250) warnings.push('La placa es más grande que la cama de la P1S (256 mm): achicá el yeso alrededor o la pieza.');
  H = walls.height;
  if (H > 250) warnings.push('Las paredes son más altas que lo que imprime la P1S (256 mm).');

  return {
    parts, warnings, SC: geo.SC,
    view2d: { art, plate, cutter: walls.rings, socket: null },
    size: { text: `Placa ${fmt(pw)} × ${fmt(ph)} · paredes ${fmt(H)} mm · pieza en crudo ${fmt(rawH)} mm · ${info}` },
  };
}
