// Texto -> contornos, con tipografías de Google Fonts (vía @fontsource) o una propia.
import { parse } from 'opentype.js';

// [id, nombre, versión de @fontsource, peso]
// Todas con licencia libre (SIL Open Font License o Apache 2.0): se pueden usar para vender y publicar.
const LIST = [
  // cursivas
  ['pacifico', 'Pacifico', '5.2.7', 400],
  ['dancing-script', 'Dancing Script', '5.2.8', 400],
  ['great-vibes', 'Great Vibes', '5.2.8', 400],
  ['norican', 'Norican', '5.2.7', 400],
  ['sacramento', 'Sacramento', '5.2.8', 400],
  ['satisfy', 'Satisfy', '5.2.7', 400],
  ['yesteryear', 'Yesteryear', '5.2.8', 400],
  ['cookie', 'Cookie', '5.2.7', 400],
  ['courgette', 'Courgette', '5.2.7', 400],
  ['kaushan-script', 'Kaushan Script', '5.2.8', 400],
  ['lobster', 'Lobster', '5.2.8', 400],
  ['oleo-script', 'Oleo Script', '5.2.7', 700],
  ['pattaya', 'Pattaya', '5.2.8', 400],
  // a mano
  ['caveat', 'Caveat', '5.2.8', 400],
  ['caveat-brush', 'Caveat Brush', '5.2.8', 400],
  ['kalam', 'Kalam', '5.2.8', 700],
  ['knewave', 'Knewave', '5.2.7', 400],
  ['patrick-hand', 'Patrick Hand', '5.2.8', 400],
  ['covered-by-your-grace', 'Covered By Your Grace', '5.2.8', 400],
  ['just-another-hand', 'Just Another Hand', '5.2.8', 400],
  ['sue-ellen-francisco', 'Sue Ellen Francisco', '5.2.8', 400],
  ['amatic-sc', 'Amatic SC', '5.2.7', 400],
  ['mali', 'Mali', '5.2.8', 300],
  // de imprenta
  ['playfair-display', 'Playfair Display', '5.2.8', 400],
  ['poppins', 'Poppins', '5.2.7', 700],
  ['montserrat', 'Montserrat', '5.2.8', 700],
  ['barlow-semi-condensed', 'Barlow Semi Condensed', '5.2.7', 700],
  ['quicksand', 'Quicksand', '5.2.10', 700],
  ['comfortaa', 'Comfortaa', '5.2.8', 700],
  ['fredoka', 'Fredoka', '5.2.10', 700],
  ['baloo-2', 'Baloo 2', '5.2.7', 700],
  ['oswald', 'Oswald', '5.2.8', 700],
];

export const FONTS = LIST.map(([id, name]) => [id, name]);

const cache = new Map();
// Las tipografías están guardadas en comun/fuentes (bajadas de @fontsource, versión y peso de la lista),
// así el programa funciona sin internet.
const fontUrl = (f) => new URL(`../fuentes/${f[0]}.woff`, import.meta.url).href;

export function loadFont(id) {
  if (!cache.has(id)) {
    const f = LIST.find((x) => x[0] === id) || LIST[0];
    cache.set(id, fetch(fontUrl(f)).then((r) => {
      if (!r.ok) throw new Error(`No pude descargar la tipografía ${f[1]}.`);
      return r.arrayBuffer();
    }).then(parse));
    cache.get(id).catch(() => cache.delete(id));
  }
  return cache.get(id);
}

// Nombre CSS con el que se muestra cada tipografía en el selector.
export const cssFamily = (id) => 'muestra-' + id.replace(/[^a-z0-9]/gi, '-');

// Registra las tipografías en la página para que el selector muestre cada nombre en su letra.
const shown = new Set();
export function showFontsInPage(ids) {
  for (const id of ids) {
    const f = LIST.find((x) => x[0] === id);
    if (!f || shown.has(id)) continue;
    shown.add(id);
    const face = new FontFace(cssFamily(id), `url(${fontUrl(f)})`, { weight: String(f[3]) });
    document.fonts.add(face);
    face.load().catch(() => shown.delete(id));
  }
}

// Tipografía propia subida por la usuaria (.ttf, .otf o .woff)
export async function addCustomFont(file) {
  const buf = await file.arrayBuffer();
  const font = parse(buf);
  const id = 'propia:' + file.name;
  cache.set(id, Promise.resolve(font));
  const face = new FontFace(cssFamily(id), buf);
  document.fonts.add(face);
  face.load().catch(() => {}); // si el navegador no la puede mostrar, el selector usa la letra común
  const name = font.names.fontFamily?.en || file.name;
  return [id, `${name} (propia)`];
}

// Devuelve lazos cerrados con y hacia abajo (como los píxeles), en unidades de 100 por em.
export function textLoops(font, text, { letterSpacing = 0, lineHeight = 1.1 } = {}) {
  const size = 100;
  const scale = size / font.unitsPerEm;
  const lines = text.split('\n');
  const loops = [];
  lines.forEach((line, li) => {
    const y = li * size * lineHeight;
    const glyphs = font.stringToGlyphs(line);
    // ancho de la línea para centrarla
    let width = 0;
    const xs = glyphs.map((g, i) => {
      const x = width;
      width += g.advanceWidth * scale + (letterSpacing / 100) * size;
      if (i < glyphs.length - 1) width += font.getKerningValue(g, glyphs[i + 1]) * scale;
      return x;
    });
    glyphs.forEach((g, i) => {
      const path = g.getPath(xs[i] - width / 2, y, size);
      loops.push(...flatten(path.commands));
    });
  });
  return loops.filter((l) => l.length >= 3);
}

function flatten(cmds) {
  const loops = [];
  let cur = null, x = 0, y = 0;
  const seg = (len) => Math.max(3, Math.min(24, Math.ceil(len / 1.5)));
  for (const c of cmds) {
    if (c.type === 'M') {
      if (cur && cur.length) loops.push(cur);
      cur = [[c.x, c.y]];
    } else if (c.type === 'L') {
      cur.push([c.x, c.y]);
    } else if (c.type === 'Q') {
      const n = seg(Math.hypot(c.x - x, c.y - y));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.push([u * u * x + 2 * u * t * c.x1 + t * t * c.x, u * u * y + 2 * u * t * c.y1 + t * t * c.y]);
      }
    } else if (c.type === 'C') {
      const n = seg(Math.hypot(c.x - x, c.y - y) * 1.3);
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.push([
          u * u * u * x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        ]);
      }
    } else if (c.type === 'Z') {
      if (cur && cur.length) loops.push(cur);
      cur = null;
      continue;
    }
    x = c.x; y = c.y;
  }
  if (cur && cur.length) loops.push(cur);
  // quita el punto final repetido
  return loops.map((l) => {
    const a = l[0], b = l[l.length - 1];
    return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6 ? l.slice(0, -1) : l;
  });
}
