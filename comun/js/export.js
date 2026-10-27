// Exportación a STL (binario) y 3MF (un objeto por pieza, listo para Bambu Studio).
import { zipSync, strToU8 } from 'fflate';

// Ubica las piezas una al lado de la otra, apoyadas en z = 0.
export function layoutParts(parts, gap = 6) {
  const boxes = parts.map(({ tris }) => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < tris.length; i += 3) {
      x0 = Math.min(x0, tris[i]); x1 = Math.max(x1, tris[i]);
      y0 = Math.min(y0, tris[i + 1]); y1 = Math.max(y1, tris[i + 1]);
      z0 = Math.min(z0, tris[i + 2]);
    }
    return { x0, y0, z0, x1, y1 };
  });
  const total = boxes.reduce((s, b) => s + (b.x1 - b.x0), 0) + gap * (boxes.length - 1);
  let x = -total / 2;
  return boxes.map((b) => {
    const off = [x - b.x0, -(b.y0 + b.y1) / 2, -b.z0];
    x += b.x1 - b.x0 + gap;
    return off;
  });
}

export function toSTL(parts, offsets) {
  const n = parts.reduce((s, p) => s + p.tris.length / 9, 0);
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let o = 84;
  parts.forEach(({ tris }, k) => {
    const [ox, oy, oz] = offsets[k];
    for (let i = 0; i < tris.length; i += 9) {
      const v = [0, 3, 6].map((j) => [tris[i + j] + ox, tris[i + j + 1] + oy, tris[i + j + 2] + oz]);
      const u = v[1].map((c, j) => c - v[0][j]), w = v[2].map((c, j) => c - v[0][j]);
      const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      [nx / l, ny / l, nz / l, ...v.flat()].forEach((c, j) => dv.setFloat32(o + j * 4, c, true));
      o += 50;
    }
  });
  return new Blob([buf], { type: 'model/stl' });
}

function meshXml(tris) {
  const index = new Map(), verts = [], faces = [];
  const id = (x, y, z) => {
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let i = index.get(key);
    if (i === undefined) { i = verts.length; index.set(key, i); verts.push(`<vertex x="${x.toFixed(4)}" y="${y.toFixed(4)}" z="${z.toFixed(4)}"/>`); }
    return i;
  };
  for (let i = 0; i < tris.length; i += 9) {
    const a = id(tris[i], tris[i + 1], tris[i + 2]);
    const b = id(tris[i + 3], tris[i + 4], tris[i + 5]);
    const c = id(tris[i + 6], tris[i + 7], tris[i + 8]);
    if (a !== b && b !== c && a !== c) faces.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  return `<mesh><vertices>${verts.join('')}</vertices><triangles>${faces.join('')}</triangles></mesh>`;
}

// parts: [{ name, tris, color, subparts?: [{ name, tris, color }] }]
// Una pieza con subparts se guarda como un objeto hecho de partes (por ejemplo el sello:
// cuerpo + relieve), para poder asignarle un filamento a cada parte en Bambu Studio.
// Cada color distinto recibe un número de filamento (1, 2, 3…) en el orden en que aparece.
export function to3MF(parts, offsets, bedCenter = [128, 128]) {
  const colors = [];
  const colorIndex = (c) => {
    const hex = (c || '#CCCCCC').toUpperCase();
    if (!colors.includes(hex)) colors.push(hex);
    return colors.indexOf(hex);
  };
  const name = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const objects = [], items = [], settings = [];
  let nextId = 2; // el 1 es la lista de materiales
  parts.forEach((p, k) => {
    const meshes = p.subparts || [{ name: p.name, tris: p.tris, color: p.color }];
    const meshIds = meshes.map((s) => {
      const id = nextId++;
      objects.push(`<object id="${id}" name="${name(s.name)}" type="model" pid="1" pindex="${colorIndex(s.color)}">${meshXml(s.tris)}</object>`);
      return id;
    });
    let topId = meshIds[0];
    if (p.subparts) {
      topId = nextId++;
      objects.push(`<object id="${topId}" name="${name(p.name)}" type="model"><components>${meshIds.map((id) => `<component objectid="${id}"/>`).join('')}</components></object>`);
    }
    const [ox, oy, oz] = offsets[k];
    items.push(`<item objectid="${topId}" transform="1 0 0 0 1 0 0 0 1 ${(ox + bedCenter[0]).toFixed(4)} ${(oy + bedCenter[1]).toFixed(4)} ${oz.toFixed(4)}"/>`);
    // filamento sugerido para Bambu Studio
    const ext = (s) => colorIndex(s.color) + 1;
    settings.push(`<object id="${topId}"><metadata key="name" value="${name(p.name)}"/><metadata key="extruder" value="${ext(meshes[0])}"/>${
      meshes.map((s, i) => `<part id="${meshIds[i]}" subtype="normal_part"><metadata key="name" value="${name(s.name)}"/><metadata key="extruder" value="${ext(s)}"/></part>`).join('')}</object>`);
  });
  const materials = `<basematerials id="1">${colors.map((c, i) => `<base name="Color ${i + 1}" displaycolor="${c}FF"/>`).join('')}</basematerials>`;
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="es-AR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Diseñador de sellos</metadata>
<resources>${materials}${objects.join('')}</resources>
<build>${items.join('')}</build>
</model>`;
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(model),
    'Metadata/model_settings.config': strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<config>${settings.join('')}</config>`),
  };
  return new Blob([zipSync(files)], { type: 'model/3mf' });
}

export async function download(blob, filename) {
  // En el celular, si el sistema lo permite, se abre el menú de compartir (Drive, WhatsApp, mail…).
  // Si no (o en la computadora), se descarga como siempre.
  const file = new File([blob], filename, { type: blob.type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // la usuaria cerró el menú
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
