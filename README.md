# Modo Oscuro Forzado

Extensión para **Google Chrome** y **Brave** (y cualquier navegador basado en Chromium: Edge, Opera, Vivaldi) que fuerza modo oscuro o claro en sitios que no lo tienen.

## Instalación (modo desarrollador)

1. Abre `chrome://extensions` (en Brave: `brave://extensions`).
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar descomprimida** y elige esta carpeta (la que contiene `manifest.json`).
4. Fija el icono en la barra (icono de pieza de puzzle → chincheta).

Después de instalar, recarga las pestañas que ya estaban abiertas.

## Uso

Haz clic en el icono para abrir el panel:

- **Este sitio**: `Auto` (sigue la configuración global), `Oscuro`, `Claro` u `Original`.
- **Motor** del sitio:
  - **Dinámico** (recomendado): lee las hojas de estilo de la página, estilos inline, variables CSS, gradientes, sombras, SVG y atributos antiguos (`bgcolor`, `<font color>`), y recalcula cada color conservando su tono. Las imágenes no se tocan.
  - **Filtro**: invierte toda la página con CSS y vuelve a invertir imágenes y videos. Más rápido y funciona en cualquier sitio, pero menos fiel.
- **Todos los sitios**: modo por defecto para toda la web (Desactivado / Oscuro / Claro).
- **No tocar sitios que ya tienen el esquema elegido**: si el modo global es oscuro y la página ya es oscura, no se modifica (puedes forzarlo eligiendo un modo en "Este sitio").
- **Ajustes visuales**: brillo, contraste, sepia y atenuar imágenes.
- **Atajo**: `Alt + Shift + D` alterna el sitio actual entre oscuro y original. Se cambia en `chrome://extensions/shortcuts`.

La configuración se guarda por dominio en `chrome.storage.local`.

## Estructura

```
manifest.json         Manifest V3
background.js         Service worker: atajo, badge, descarga de CSS de otros dominios
content/colors.js     Parseo y transformación de colores (HSL)
content/content.js    Motor dinámico + motor de filtro + detección de tema
popup/                Interfaz del panel
icons/                Iconos 16/32/48/128
```

## Limitaciones conocidas

- Chrome no permite que las extensiones modifiquen páginas internas (`chrome://`, `brave://`) ni la Chrome Web Store.
- Imágenes de fondo claras (`background-image: url(...)`) no se oscurecen en el motor dinámico; usa el motor Filtro en esos sitios.
- Los estilos dentro de Shadow DOM (algunos componentes web) no se procesan.
- Para que funcione con archivos locales (`file://`), activa "Permitir acceso a URLs de archivo" en los detalles de la extensión.
