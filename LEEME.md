# Diseñador de sellos · Nébela Studio

Sellos, cortantes y rodillos texturizadores para cerámica. Hay **dos versiones que se mantienen juntas**:
la de escritorio y la app para celular (instalable, funciona sin internet).

## Cómo abrirlo

- **Computadora:** doble clic en `Abrir diseñador.bat` (necesita Python). Abre `http://localhost:8642/escritorio/`.
- **Celular:** cuando esté publicada en internet, abrir la dirección y elegir "Agregar a pantalla de inicio".

## Carpetas

```
index.html        Entrada: manda a escritorio/ o movil/ según el dispositivo
servidor.py       Servidor local (le pide al navegador no guardar copias viejas)
comun/            TODO lo compartido: un cambio acá llega a las dos versiones
  js/app.js         Pantalla: controles, vista 3D, vista de arriba, descargas
  js/geometry.js    Geometría: sello, encastre, mango, cortante, rodillo
  js/trace.js       Imagen → contornos
  js/text.js        Texto → contornos, lista de tipografías
  js/export.js      3MF (con partes y colores) y STL
  libs/             Three.js 0.160.0, Clipper 6.4.2, fflate 0.8.2, opentype.js 1.3.4 (copias locales)
  fuentes/          20 tipografías + DM Sans y Pacifico (de @fontsource, copias locales)
  estilos.css       Colores, letras y controles de Nébela
escritorio/       Solo el armado de pantalla de la computadora (index.html)
movil/            Solo el armado de pantalla del celular
  index.html, movil.css, movil.js   Panel que sube desde abajo, barra inferior
  manifest.webmanifest, iconos/     Datos para instalarla como app
  sw.js                             Modo sin internet (lista de archivos que guarda)
```

## Regla para cambios

1. La lógica (geometría, trazado, texto, exportación, controles) va en `comun/`: llega sola a las dos.
2. Si un cambio toca lo que se ve en pantalla (un botón nuevo, un elemento con `id` que usa `app.js`),
   hay que agregarlo en **`escritorio/index.html` y en `movil/index.html`**, y revisar los dos.
3. Si se agrega un archivo nuevo en `comun/` (una librería, una tipografía, un .js), sumarlo a la lista
   `FILES` de `movil/sw.js` para que la app lo tenga sin internet.
4. Probar las dos versiones antes de dar algo por terminado.
