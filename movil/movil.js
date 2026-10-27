// Solo de la versión móvil: abrir/cerrar el panel de ajustes y registrar la app para usarla sin internet.
const panel = document.getElementById('panel');
const toggle = document.getElementById('sheetToggle');

function setOpen(open) {
  panel.classList.toggle('open', open);
  toggle.textContent = open ? 'Ver diseño' : 'Ajustes';
  toggle.setAttribute('aria-expanded', String(open));
}
toggle.onclick = () => setOpen(!panel.classList.contains('open'));
document.getElementById('sheetGrip').onclick = () => setOpen(false);
// al elegir una imagen se cierra el panel para ver el resultado
document.getElementById('file').addEventListener('change', () => setTimeout(() => setOpen(false), 400));

// arranca con los ajustes abiertos, desde arriba
setOpen(true);
panel.querySelector('.sheet-body').scrollTop = 0;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo sin conexión */ });
}
