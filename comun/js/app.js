import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { rasterize, makeMask, traceMask } from './trace.js';
import { designFromLoops, buildModel, buildRoller, measure, pathsToSvg } from './geometry.js';
import { layoutParts, toSTL, to3MF, download } from './export.js';
import { FONTS, loadFont, addCustomFont, textLoops, cssFamily, showFontsInPage } from './text.js';

// ---------- Parámetros ----------
// show: en qué modos aparece el control (stamp, both, cutter)
const PARAMS = [
  { group: 'Diseño' },
  { id: 'size', label: 'Tamaño (lado más largo)', unit: 'mm', type: 'range', min: 10, max: 200, step: 0.5, def: 30, show: ['stamp', 'both', 'cutter'] },
  { id: 'threshold', label: 'Umbral claro / oscuro', type: 'range', min: 10, max: 245, step: 1, def: 128, showIf: () => raster },
  { id: 'invert', label: 'Invertir (lo claro es relieve)', type: 'check', def: false, showIf: () => raster },
  { id: 'mirror', label: 'Espejar (se lee bien al usarlo)', type: 'check', def: true },
  { id: 'smooth', label: 'Suavizado del trazo', type: 'range', min: 0, max: 3, step: 0.1, def: 0.7, showIf: () => raster },
  { id: 'thicken', label: 'Engrosar líneas', unit: 'mm', type: 'range', min: 0, max: 1.5, step: 0.05, def: 0 },

  { group: 'Texto' },
  { id: 'textOn', label: 'Agregar texto', type: 'check', def: false },
  { id: 'text', label: 'Texto (Enter para otra línea)', type: 'textarea', def: 'Nébela', showIf: (p) => p.textOn },
  { id: 'font', label: 'Tipografía', type: 'font', def: 'pacifico', showIf: (p) => p.textOn },
  { id: 'textSize', label: 'Tamaño respecto al dibujo', unit: '%', type: 'range', min: 5, max: 200, step: 1, def: 35, showIf: (p) => p.textOn && raster },
  { id: 'textPos', label: 'Ubicación', type: 'select', def: 'below', showIf: (p) => p.textOn && raster,
    options: [['below', 'Debajo del dibujo'], ['above', 'Arriba del dibujo'], ['right', 'A la derecha'], ['left', 'A la izquierda'], ['over', 'Encima del dibujo']] },
  { id: 'textGap', label: 'Separación del dibujo', unit: '%', type: 'range', min: -20, max: 60, step: 1, def: 6, showIf: (p) => p.textOn && raster && p.textPos !== 'over' },
  { id: 'letterSpacing', label: 'Espacio entre letras', unit: '%', type: 'range', min: -20, max: 60, step: 1, def: 0, showIf: (p) => p.textOn },
  { id: 'lineHeight', label: 'Interlineado', type: 'range', min: 0.6, max: 2, step: 0.05, def: 1.1, showIf: (p) => p.textOn && p.text.includes('\n') },

  { group: 'Rodillo', show: ['roller'] },
  { id: 'rollerDiameter', label: 'Diámetro', unit: 'mm', type: 'range', min: 15, max: 100, step: 0.5, def: 40 },
  { id: 'rollerLength', label: 'Largo', unit: 'mm', type: 'range', min: 20, max: 250, step: 1, def: 100 },
  { id: 'rollerMark', label: 'Marca en la arcilla', type: 'select', def: 'raised',
    options: [['raised', 'Dibujo hundido (relieve en el rodillo)'], ['sunk', 'Dibujo en relieve (hundido en el rodillo)']] },
  { id: 'rollerDepth', label: 'Profundidad del dibujo', unit: 'mm', type: 'range', min: 0.3, max: 4, step: 0.1, def: 1 },
  { id: 'rollerPattern', label: 'Repetición', type: 'select', def: 'grid',
    options: [['grid', 'Cuadrícula'], ['brick', 'Ladrillo (filas corridas)'], ['single', 'Una sola vuelta (sin repetir)']] },
  { id: 'repAround', label: 'Repeticiones alrededor', type: 'range', min: 1, max: 30, step: 1, def: 6, showIf: (p) => p.rollerPattern !== 'single' },
  { id: 'repAlong', label: 'Repeticiones a lo largo', type: 'range', min: 1, max: 30, step: 1, def: 4, showIf: (p) => p.rollerPattern !== 'single' },
  { id: 'patternGap', label: 'Separación entre dibujos', unit: 'mm', type: 'range', min: 0, max: 30, step: 0.5, def: 3 },
  { id: 'rollerMargin', label: 'Margen en los extremos', unit: 'mm', type: 'range', min: 0.5, max: 30, step: 0.5, def: 3 },
  { id: 'rollerRotate', label: 'Girar el dibujo 90°', type: 'check', def: false },
  { id: 'rollerHole', label: 'Agujero de punta a punta', type: 'check', def: true },
  { id: 'holeBy', label: 'Definir por', type: 'select', def: 'hole', showIf: (p) => p.rollerHole,
    options: [['hole', 'Diámetro del agujero'], ['wall', 'Grosor de la pared']] },
  { id: 'holeDiameter', label: 'Diámetro del agujero', unit: 'mm', type: 'range', min: 2, max: 90, step: 0.1, def: 10,
    showIf: (p) => p.rollerHole && p.holeBy === 'hole',
    hint: 'Para pasar un eje o mango que ya tengan, medilo y sumale unos 0,5 mm para que entre sin forzar.' },
  { id: 'rollerWall', label: 'Grosor de la pared', unit: 'mm', type: 'range', min: 1, max: 40, step: 0.1, def: 4,
    showIf: (p) => p.rollerHole && p.holeBy === 'wall',
    hint: 'Se mide en la parte más fina: hasta el fondo del dibujo si va hundido en el rodillo.' },

  { group: 'Forma de la base', show: ['stamp', 'both', 'cutter'] },
  { id: 'baseShape', label: 'Forma', type: 'select', def: 'outline',
    options: [['outline', 'Contorno del diseño'], ['rect', 'Rectángulo'], ['circle', 'Círculo']] },
  { id: 'margin', label: 'Margen alrededor del diseño', unit: 'mm', type: 'range', min: 0, max: 10, step: 0.05, def: 0.45 },
  { id: 'joinGap', label: 'Unir piezas separadas', unit: 'mm', type: 'range', min: 0, max: 10, step: 0.1, def: 2, showIf: (p) => p.baseShape === 'outline' },
  { id: 'cornerR', label: 'Redondeo de esquinas', unit: 'mm', type: 'range', min: 0, max: 10, step: 0.1, def: 1, showIf: (p) => p.baseShape === 'rect' },

  { group: 'Sello', show: ['stamp', 'both'] },
  { id: 'baseThickness', label: 'Grosor de la base', unit: 'mm', type: 'range', min: 1, max: 12, step: 0.1, def: 5.5 },
  { id: 'reliefHeight', label: 'Altura del relieve', unit: 'mm', type: 'range', min: 0.4, max: 5, step: 0.1, def: 1.7 },
  { id: 'reliefInset', label: 'Separar relieve del borde', unit: 'mm', type: 'range', min: 0, max: 3, step: 0.05, def: 0 },
  { id: 'stampClearance', label: 'Holgura sello / cortante', unit: 'mm', type: 'range', min: 0, max: 3, step: 0.05, def: 0.9, show: ['both'] },
  { id: 'stampColor', label: 'Color de la base y el mango', type: 'color', def: '#3BBFB0' },
  { id: 'reliefColor', label: 'Color del relieve', type: 'seg', def: '#FFFFFF',
    options: [['#FFFFFF', 'Blanco'], ['#000000', 'Negro']],
    hint: 'Los colores quedan en el nombre del 3MF. En el archivo, base y relieve van como partes separadas: en Bambu Studio les asignás un filamento a cada una. El STL no guarda colores.' },

  { group: 'Mango', show: ['stamp', 'both'] },
  { id: 'socket', label: 'Encastre para mango', type: 'check', def: true },
  { id: 'includeHandle', label: 'Incluir un mango para imprimir', type: 'check', def: false },
  { id: 'handleLength', label: 'Largo del mango', unit: 'mm', type: 'range', min: 10, max: 80, step: 0.5, def: 23.5, showIf: (p) => p.includeHandle },
  { id: 'handleDiameter', label: 'Grosor del mango (diámetro)', unit: 'mm', type: 'range', min: 6, max: 30, step: 0.5, def: 10, showIf: (p) => p.includeHandle },
  { id: 'threadSize', label: 'Tamaño de la rosca', unit: 'mm', type: 'range', min: 5, max: 20, step: 0.01, def: 9.58,
    showIf: (p) => p.socket || p.includeHandle,
    hint: 'Con 9,58 mm encaja con los mangos que ya tenés impresos. Si lo cambiás, imprimí un mango nuevo con la misma medida.' },
  { id: 'socketFit', label: 'Holgura del encastre', unit: 'mm', type: 'range', min: 0.1, max: 0.8, step: 0.05, def: 0.4, showIf: (p) => p.socket },
  { id: 'socketX', label: 'Mover encastre (izq./der.)', unit: 'mm', type: 'range', min: -40, max: 40, step: 0.5, def: 0, showIf: (p) => p.socket },
  { id: 'socketY', label: 'Mover encastre (arriba/abajo)', unit: 'mm', type: 'range', min: -40, max: 40, step: 0.5, def: 0, showIf: (p) => p.socket },

  { group: 'Cortante', show: ['both', 'cutter'] },
  { id: 'cutHeight', label: 'Altura total', unit: 'mm', type: 'range', min: 5, max: 40, step: 0.5, def: 12.5 },
  { id: 'wallBase', label: 'Grosor de la pared', unit: 'mm', type: 'range', min: 0.4, max: 4, step: 0.05, def: 0.8 },
  { id: 'wallTip', label: 'Ancho de la punta del filo', unit: 'mm', type: 'range', min: 0.2, max: 2, step: 0.05, def: 0.4 },
  { id: 'tipHeight', label: 'Altura del chaflán del filo', unit: 'mm', type: 'range', min: 0, max: 10, step: 0.2, def: 2 },
  { id: 'flangeWidth', label: 'Ancho de la pestaña', unit: 'mm', type: 'range', min: 0, max: 10, step: 0.5, def: 4 },
  { id: 'flangeHeight', label: 'Alto de la pestaña', unit: 'mm', type: 'range', min: 0.6, max: 8, step: 0.1, def: 3.5 },
];

const STORE_KEY = 'disenador-sellos-v2';
const P = { mode: 'stamp' };
PARAMS.forEach((d) => { if (d.id) P[d.id] = d.def; });
try { Object.assign(P, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch { /* sin guardado */ }
// las tipografías propias no se guardan entre sesiones
if (P.font.startsWith('propia:')) P.font = 'pacifico';
// el relieve ahora es solo blanco o negro: los colores guardados de antes vuelven a blanco
if (P.reliefColor !== '#000000') P.reliefColor = '#FFFFFF';
const customFonts = [];

const $ = (s) => document.querySelector(s);
const controlsEl = $('#controls');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const PALETTE = [
  ['#E8D84A', 'Amarillo'], ['#F5F0E8', 'Blanco roto'], ['#3BBFB0', 'Turquesa'], ['#F0196E', 'Fucsia'],
  ['#E8522A', 'Naranja'], ['#9ACD32', 'Lima'], ['#2B2B2B', 'Grafito'],
];

// cierra la lista de tipografías al hacer clic afuera o con Escape
function closeFontLists(except) {
  document.querySelectorAll('.fontpick').forEach((fp) => {
    if (fp === except) return;
    fp.querySelector('.fp-list').hidden = true;
    fp.querySelector('.fp-btn').setAttribute('aria-expanded', 'false');
  });
}
document.addEventListener('pointerdown', (e) => closeFontLists(e.target.closest('.fontpick')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFontLists(null); });

function renderControls() {
  controlsEl.innerHTML = '';
  let fs = null, groupShow = null;
  for (const d of PARAMS) {
    if (d.group) {
      groupShow = d.show;
      fs = document.createElement('fieldset');
      fs.innerHTML = `<legend>${d.group}</legend>${d.hint ? `<p class="hint">${d.hint}</p>` : ''}`;
      fs.hidden = groupShow && !groupShow.includes(P.mode);
      controlsEl.append(fs);
      continue;
    }
    const show = d.show || groupShow;
    if ((show && !show.includes(P.mode)) || (d.showIf && !d.showIf(P))) continue;
    const row = document.createElement('div');
    row.className = 'row' + (d.type === 'check' ? ' check' : '');
    if (d.type === 'check') {
      row.innerHTML = `<input type="checkbox" id="p_${d.id}" ${P[d.id] ? 'checked' : ''}><label for="p_${d.id}">${d.label}</label>`;
      row.querySelector('input').onchange = (e) => set(d.id, e.target.checked, true);
    } else if (d.type === 'textarea') {
      row.innerHTML = `<label>${d.label}</label><textarea rows="2" style="grid-column:1/-1"></textarea>`;
      const ta = row.querySelector('textarea');
      ta.value = P[d.id];
      ta.oninput = () => set(d.id, ta.value);
      ta.onchange = () => renderControls();
    } else if (d.type === 'font') {
      // lista propia (no <select>) para poder mostrar cada nombre en su tipografía
      const opts = FONTS.concat(customFonts);
      const cur = opts.find(([v]) => v === P[d.id]) || opts[0];
      const look = (v) => `font-family:'${cssFamily(v)}', var(--ui-font)`;
      row.innerHTML = `<label>${d.label}<a href="#" class="link">Subir una propia…</a></label>
        <div class="fontpick" style="grid-column:1/-1">
          <button type="button" class="fp-btn" aria-haspopup="listbox" aria-expanded="false"><span style="${look(cur[0])}">${esc(cur[1])}</span></button>
          <div class="fp-list" role="listbox" hidden>${opts.map(([v, t]) => `<button type="button" role="option" data-v="${esc(v)}" aria-selected="${v === cur[0]}" style="${look(v)}">${esc(t)}</button>`).join('')}</div>
        </div>
        <input type="file" accept=".ttf,.otf,.woff" hidden>`;
      showFontsInPage([cur[0]]);
      const fileIn = row.querySelector('input');
      const btn = row.querySelector('.fp-btn'), list = row.querySelector('.fp-list');
      btn.onclick = () => {
        showFontsInPage(FONTS.map(([v]) => v));
        list.hidden = !list.hidden;
        btn.setAttribute('aria-expanded', String(!list.hidden));
        if (!list.hidden) (list.querySelector('[aria-selected="true"]') || list.firstElementChild).focus();
      };
      list.onclick = (e) => {
        const item = e.target.closest('[data-v]');
        if (item) set(d.id, item.dataset.v, true);
      };
      row.querySelector('a').onclick = (e) => { e.preventDefault(); fileIn.click(); };
      fileIn.onchange = async () => {
        try {
          const opt = await addCustomFont(fileIn.files[0]);
          customFonts.push(opt);
          set(d.id, opt[0], true);
        } catch {
          alert('No pude leer esa tipografía. Probá con un archivo .ttf u .otf.');
        }
      };
    } else if (d.type === 'seg') {
      row.innerHTML = `<label>${d.label}</label>
        <div class="seg" style="grid-column:1/-1">${d.options.map(([v, t]) => `<button type="button" data-v="${v}" class="${P[d.id] === v ? 'on' : ''}" aria-pressed="${P[d.id] === v}">${t}</button>`).join('')}</div>`;
      row.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => set(d.id, b.dataset.v, true); });
    } else if (d.type === 'color') {
      // paleta de Nébela + cualquier otro color
      const cur = P[d.id].toUpperCase();
      const inPalette = PALETTE.some(([hex]) => hex === cur);
      row.innerHTML = `<label>${d.label}</label>
        <div class="swatches" style="grid-column:1/-1">
          ${PALETTE.map(([hex, name]) => `<button type="button" class="sw" data-c="${hex}" title="${name}" aria-label="${name}" aria-pressed="${hex === cur}" style="background:${hex}"></button>`).join('')}
          <label class="sw sw-other" title="Otro color" aria-pressed="${!inPalette}" style="${inPalette ? '' : `background:${cur}`}"><input type="color" value="${cur.toLowerCase()}" aria-label="Otro color"></label>
        </div>`;
      row.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => set(d.id, b.dataset.c, true); });
      const other = row.querySelector('input');
      other.oninput = () => set(d.id, other.value.toUpperCase());
      other.onchange = () => renderControls();
    } else if (d.type === 'select') {
      row.innerHTML = `<label>${d.label}</label><select style="grid-column:1/-1">${d.options.map(([v, t]) => `<option value="${v}" ${P[d.id] === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
      row.querySelector('select').onchange = (e) => set(d.id, e.target.value, true);
    } else {
      row.innerHTML = `<label>${d.label}<small>${d.unit || ''}</small></label>
        <input type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${P[d.id]}">
        <input type="number" min="${d.min}" max="${d.max}" step="${d.step}" value="${P[d.id]}">`;
      const [r, n] = row.querySelectorAll('input');
      r.oninput = () => { n.value = r.value; set(d.id, +r.value); };
      n.onchange = () => { r.value = n.value; set(d.id, +n.value); };
    }
    fs.append(row);
    if (d.hint) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = d.hint;
      fs.append(hint);
    }
  }
}

function set(id, v, rerenderControls = false) {
  P[id] = v;
  if (id === 'mode') framed = false;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(P)); } catch { /* sin guardado */ }
  if (rerenderControls) renderControls();
  // los colores solo cambian la vista: no hace falta recalcular las piezas
  if (id.endsWith('Color')) { show3d(); show2d(); return; }
  schedule(['threshold', 'invert', 'smooth'].includes(id) ? 'trace' : 'design');
}

document.querySelectorAll('#modeSeg button').forEach((b) => {
  b.classList.toggle('on', b.dataset.mode === P.mode);
  b.onclick = () => {
    document.querySelectorAll('#modeSeg button').forEach((x) => x.classList.toggle('on', x === b));
    set('mode', b.dataset.mode, true);
  };
});

// ---------- Imagen ----------
let raster = null, loops = null, model = null;

function loadFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    raster = rasterize(img);
    $('#dropText').innerHTML = `<img src="${url}" alt=""><small>${file.name} · cambiar</small>`;
    $('#name').value = file.name.replace(/\.[^.]+$/, '');
    $('#clearImg').hidden = false;
    framed = false;
    renderControls();
    schedule('trace');
  };
  img.onerror = () => alert('No pude abrir esa imagen.');
  img.src = url;
}
$('#file').onchange = (e) => loadFile(e.target.files[0]);
$('#clearImg').onclick = () => {
  raster = loops = null;
  $('#file').value = '';
  $('#dropText').innerHTML = DROP_TEXT;
  $('#clearImg').hidden = true;
  framed = false;
  renderControls();
  schedule('design');
};
const DROP_TEXT = $('#dropText').innerHTML;
const drop = $('#drop');
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); loadFile(e.dataTransfer.files[0]); };

// ---------- Recalcular ----------
let pending = null, timer = 0;
function schedule(level) {
  pending = pending === 'trace' ? 'trace' : level;
  clearTimeout(timer);
  timer = setTimeout(run, 120);
}

let runId = 0;
async function run() {
  const id = ++runId;
  if (raster && (pending === 'trace' || !loops)) {
    const mask = makeMask(raster, P.threshold, P.invert);
    loops = traceMask(mask, raster.w, raster.h, P.smooth);
  }
  pending = null;
  const warn = [];
  const sources = [];

  // dibujo normalizado: lado más largo = 100 unidades, centrado
  let art = null;
  if (raster && loops.length) {
    art = normalize(loops);
    sources.push({ loops: art.loops, evenOdd: true });
  } else if (raster) {
    warn.push('No se encontró nada oscuro en la imagen. Probá mover el umbral o invertir.');
  }
  if (P.textOn && P.text.trim()) {
    try {
      const font = await loadFont(P.font);
      if (id !== runId) return;
      const tl = textLoops(font, P.text.trim(), { letterSpacing: P.letterSpacing, lineHeight: P.lineHeight });
      if (tl.length) sources.push({ loops: placeText(tl, art), evenOdd: false });
    } catch (e) {
      warn.push(e.message || 'No pude cargar la tipografía.');
    }
  }

  const roller = P.mode === 'roller';
  $('[data-view="2d"]').textContent = roller ? 'Desenrollado' : 'Vista de arriba';
  if (roller && sources.length) {
    // un rodillo grande puede tardar unos segundos: se avisa antes de calcular
    $('#size').textContent = 'Calculando…';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (id !== runId) return;
  }
  // en el rodillo el tamaño lo dan las repeticiones, no el "lado más largo"
  const design = !sources.length ? null
    : roller ? designFromLoops(sources, { artMM: 100, mirror: P.mirror }) : fitDesign(sources);
  if (!design) {
    model = null;
  } else {
    model = roller ? buildRoller(design, P) : buildModel(design, P);
    warn.push(...model.warnings);
  }
  $('#warnings').innerHTML = warn.map((w) => `<div>⚠ ${w}</div>`).join('');
  $('#empty').hidden = !!model;
  $('#dl3mf').disabled = $('#dlstl').disabled = !model || !model.parts.length;
  const sz = model?.size;
  const mm = (x) => String(+x.toFixed(1)).replace('.', ',');
  const holeTxt = sz?.hole ? ` · agujero Ø${mm(sz.hole)} · pared ${mm(sz.wall)}` : '';
  $('#size').textContent = !sz ? '' : sz.roller ? `Ø${mm(sz.w)} × ${mm(sz.h)}${holeTxt} mm` : `${mm(sz.w)} × ${mm(sz.h)} mm`;
  $('#size').title = $('#size').textContent; // completo al pasar el mouse si no entra
  show3d();
  show2d();
}

// Escala el dibujo para que la pieza terminada (base del sello o cortante)
// mida P.size en su lado más largo. El margen y las paredes no escalan,
// así que se corrige la diferencia un par de veces.
function fitDesign(sources) {
  let extra = 0, design = null;
  for (let i = 0; i < 3; i++) {
    const artMM = Math.max(1, P.size - extra);
    design = designFromLoops(sources, { artMM, mirror: P.mirror });
    if (!design) return null;
    const s = measure(design, P);
    const err = Math.max(s.w, s.h) - P.size;
    if (Math.abs(err) < 0.02) break;
    extra += err;
  }
  return design;
}

function boxOf(loops) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of loops) for (const [x, y] of l) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

function normalize(src) {
  const b = boxOf(src);
  const s = 100 / Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const out = src.map((l) => l.map(([x, y]) => [(x - cx) * s, (y - cy) * s]));
  return { loops: out, box: boxOf(out) };
}

// Ubica el texto respecto del dibujo (y hacia abajo). El texto viene a 100 unidades por em.
function placeText(tl, art) {
  if (!art) return tl;
  const k = P.textSize / 100;
  const scaled = tl.map((l) => l.map(([x, y]) => [x * k, y * k]));
  const t = boxOf(scaled), a = art.box, gap = P.textGap;
  let dx = -(t.x0 + t.x1) / 2, dy = -(t.y0 + t.y1) / 2;
  if (P.textPos === 'below') dy = a.y1 + gap - t.y0;
  if (P.textPos === 'above') dy = a.y0 - gap - t.y1;
  if (P.textPos === 'right') dx = a.x1 + gap - t.x0;
  if (P.textPos === 'left') dx = a.x0 - gap - t.x1;
  return scaled.map((l) => l.map(([x, y]) => [x + dx, y + dy]));
}

// ---------- Vista 3D ----------
const v3 = $('#view3d');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
v3.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xF5F0E8); // blanco roto
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
camera.up.set(0, 0, 1);
camera.position.set(0, -120, 110);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x77716A, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(60, -80, 150);
scene.add(sun);
const grid = new THREE.GridHelper(256, 26, 0xD6CCBC, 0xE6DED1);
grid.rotation.x = Math.PI / 2;
scene.add(grid);
const group = new THREE.Group();
scene.add(group);
let framed = false;

function show3d() {
  group.children.forEach((m) => m.geometry.dispose());
  group.clear();
  if (!model || !model.parts.length) return;
  const offs = layoutParts(model.parts);
  model.parts.forEach((p, k) => {
    // colores elegidos por la usuaria para el sello y el mango; el resto usa los de cada pieza
    const color = p.name === 'Sello' || p.name === 'Mango' ? P.stampColor : p.color;
    const accent = p.name === 'Sello' ? P.reliefColor : p.accent;
    const pieces = p.split ? [[p.tris.subarray(0, p.split), color], [p.tris.subarray(p.split), accent]] : [[p.tris, color]];
    for (const [tris, color] of pieces) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(tris, 3));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true }));
      mesh.position.set(...offs[k]);
      group.add(mesh);
    }
  });
  if (!framed) {
    const box = new THREE.Box3().setFromObject(group);
    // en pantallas angostas (celular vertical) hay que alejarse más para que entre todo de costado
    const r = box.getSize(new THREE.Vector3()).length() * Math.max(1, 1 / camera.aspect);
    const c = box.getCenter(new THREE.Vector3());
    camera.position.set(c.x, c.y - r * 1.7, c.z + r * 1.5);
    controls.target.copy(c);
    framed = true;
  }
}

function resize() {
  const { clientWidth: w, clientHeight: h } = v3;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(v3);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

// ---------- Vista de arriba ----------
function show2d() {
  const el = $('#view2d');
  if (!model?.view2d) { el.innerHTML = ''; return; }
  const v = model.view2d;
  const all = [v.cutter, v.plate, v.art].filter(Boolean).flat();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of all) for (const q of p) {
    x0 = Math.min(x0, q.X); x1 = Math.max(x1, q.X); y0 = Math.min(y0, -q.Y); y1 = Math.max(y1, -q.Y);
  }
  const s = model.SC, pad = 3;
  const isStamp = P.mode === 'stamp' || P.mode === 'both';
  const baseCol = isStamp ? P.stampColor : '#3BBFB0', artCol = isStamp ? P.reliefColor : '#F0196E';
  const vb = [x0 / s - pad, y0 / s - pad, (x1 - x0) / s + pad * 2, (y1 - y0) / s + pad * 2];
  el.innerHTML = `<svg viewBox="${vb.join(' ')}" width="900" height="${900 * vb[3] / vb[2]}">
    ${v.cutter ? `<path d="${pathsToSvg(v.cutter)}" fill="#E8D84A" fill-rule="nonzero"/>` : ''}
    ${v.plate ? `<path d="${pathsToSvg(v.plate)}" fill="${baseCol}" fill-opacity="0.35" stroke="${baseCol}" stroke-width="0.15"/>` : ''}
    <path d="${pathsToSvg(v.art)}" fill="${artCol}" fill-rule="nonzero" opacity="${v.plate ? 1 : 0.5}"/>
    ${v.socket ? `<circle cx="${v.socket.cx}" cy="${-v.socket.cy}" r="${v.socket.r}" fill="none" stroke="#2B2B2B" stroke-width="0.25" stroke-dasharray="0.8 0.6"/>` : ''}
  </svg>`;
}

document.querySelectorAll('#viewSeg button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#viewSeg button').forEach((x) => x.classList.toggle('on', x === b));
    $('#view3d').hidden = b.dataset.view !== '3d';
    $('#view2d').hidden = b.dataset.view !== '2d';
    resize();
  };
});

// ---------- Descargas ----------
// Piezas con los colores elegidos; el sello va con sus dos partes (cuerpo y relieve)
function exportParts() {
  const hex = (c) => (typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c);
  return model.parts.map((p) => {
    if (p.name === 'Sello') {
      return { ...p, color: P.stampColor, subparts: p.subparts.map((s, i) => ({ ...s, color: i === 0 ? P.stampColor : P.reliefColor })) };
    }
    if (p.name === 'Mango') return { ...p, color: P.stampColor };
    return { ...p, color: hex(p.color) };
  });
}

// Nombre del 3MF con los colores para configurar en Bambu Studio: loli_turquesa_relieve-blanco.3mf
function fileName3mf() {
  const name = $('#name').value || 'sello';
  if (P.mode !== 'stamp' && P.mode !== 'both') return `${name}.3mf`;
  const base = PALETTE.find(([hex]) => hex === P.stampColor.toUpperCase());
  const baseTxt = base ? base[1].toLowerCase().replace(' ', '-') : P.stampColor.slice(1).toUpperCase();
  const relief = P.reliefColor === '#000000' ? 'negro' : 'blanco';
  return `${name}_${baseTxt}_relieve-${relief}.3mf`;
}

$('#dl3mf').onclick = () => {
  const offs = layoutParts(model.parts);
  download(to3MF(exportParts(), offs), fileName3mf());
};
$('#dlstl').onclick = () => {
  const offs = layoutParts(model.parts);
  download(toSTL(model.parts, offs), `${$('#name').value || 'sello'}.stl`);
};

renderControls();
schedule('design');
