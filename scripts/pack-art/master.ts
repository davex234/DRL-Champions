/**
 * MASTER PACK DESIGN — el lenguaje visual del sobre NEXUS, en vectorial (Fase 20.1).
 *
 * ══════════════════════════ QUÉ ES ESTE FICHERO ══════════════════════════
 *
 * **UN diseño maestro parametrizado, no 35 diseños independientes.** Define la silueta, los
 * pliegues, el sellado, la geometría, el emblema, la tipografía, los materiales y la
 * iluminación una sola vez; cada producto es una ENTRADA DE DATOS sobre ese lenguaje.
 *
 * Por eso todos los sobres se reconocen como de la misma familia sin que ninguno sea «el
 * mismo cambiando de color»: lo que varía es el MATERIAL (tres paradas de degradado, foil,
 * brillo), el EMBLEMA (uno por categoría) y los MICRODETALLES (anillos del troquel, barras de
 * escalón, código interno). Lo que no varía nunca es la casa.
 *
 * ══════════════════════════ POR QUÉ VECTORIAL ══════════════════════════
 *
 * En este entorno **no hay herramienta de generación de imágenes**. El §14 del encargo prevé
 * exactamente este caso y manda crear el master vectorial. Así que el arte se AUTORA en SVG
 * —geometría, degradados metálicos, foil, biseles, viñeta— y se rasteriza con `sharp` a WEBP
 * con alfa real. No es CSS, no es un rectángulo y no es un marcador de posición: es un fichero
 * de imagen con su silueta recortada, reproducible y versionable.
 *
 * ══════════════════════════ LO QUE NO INVENTA ══════════════════════════
 *
 * · **El emblema NEXUS es el REAL**: los trazados salen de `public/branding/icon/icon.svg`,
 *   el asset de marca que ya estaba aprobado en el proyecto.
 * · **Los colores son los REALES**: `design/tokens` (RARITY/ACCENT), los `accent` que cada
 *   sobre declara en `data/packs.ts` y los colores de marca de `data/teams.ts`.
 * · **Ningún logo de equipo se dibuja.** No hay ni un logo oficial en el repositorio
 *   (`public/teams/` solo tiene un README), y el §7 prohíbe falsificarlo. Donde haría falta un
 *   logo se usa el MONOGRAMA con la etiqueta real del equipo — que es literalmente el respaldo
 *   que el propio README de `public/teams/` declara como el aprobado del proyecto.
 *
 * ══════════════════════════ TIPOGRAFÍA ══════════════════════════
 *
 * La cara de marca del producto es Rajdhani, pero **no está instalada en esta máquina**
 * (medido: `Rajdhani` y `Eurostile` caen las dos en la misma sustituta por defecto). Se
 * compone con **Bahnschrift**, que sí resuelve y es la tercera opción del propio
 * `--font-display` del proyecto. Cambiarla es una constante: instalar Rajdhani y volver a
 * ejecutar el render alinea los assets con la tipografía de la interfaz sin tocar el diseño.
 */

/** La familia tipográfica del wordmark. Una constante: ver §TIPOGRAFÍA de la cabecera. */
export const DISPLAY_FONT = "Bahnschrift, 'Segoe UI', 'DIN Alternate', sans-serif";

/** Lienzo del asset. 780×1140 = 13:19, la proporción que ya dibuja `SealedPack` (260×380). */
export const ART_W = 780;
export const ART_H = 1140;
/** Chaflán de la silueta: la misma proporción que `.nx-clip` (20 px sobre 260 de ancho). */
const CHAMFER = Math.round((20 / 260) * ART_W);
/** Altura de la zona de sellado superior (la solapa). 17,5 %, como en `SealedPack`. */
const FLAP = Math.round(ART_H * 0.175);

/** Un material: tres paradas de degradado + acento + cuánto brilla. */
export interface Material {
  /** Base del cuerpo, de arriba a abajo. Tres paradas: un solo degradado se lee como caja. */
  base: [string, string, string];
  /** Color de identidad del producto (canto, foil, emblema). */
  accent: string;
  /** Intensidad del reflejo especular, 0-1. Un sobre mate no brilla. */
  sheen: number;
  /** Densidad de las bandas de foil, 0-1. */
  foil: number;
  /** Color del texto principal sobre el material. */
  ink: string;
  /**
   * Texto SECUNDARIO (la línea de familia, el código). Existe porque el acento no sirve:
   * sobre plata pulida, un gris claro sobre gris claro desaparecía y la línea «RAREZA» era
   * ilegible en el primer render. Sobre metal claro tiene que ser tinta oscura.
   */
  inkSoft: string;
  /**
   * La zona de sellado. En el primer render era casi negra para todos, así que sobre bronce y
   * plata cortaba el objeto en dos con una banda que no parecía del mismo material. Ahora es
   * una versión OSCURECIDA del propio metal.
   */
  flap: [string, string];
  /**
   * Fondo del escudo del emblema. Fijo y casi negro, sobre plata se leía como una pegatina
   * negra pegada encima. Se tinta con el material para que el troquel parezca troquelado EN
   * la superficie, no puesto sobre ella.
   */
  emblemBase: [string, string];
}

/** Qué emblema lleva el troquel. Uno por CATEGORÍA de producto. */
export type Emblem =
  | "nexus"     // producto de la casa: el sigilo real de NEXUS
  | "ascent"    // bienvenida: el primer paso
  | "meridian"  // regional: una división del circuito
  | "crest"     // equipo: escudo con el monograma real
  | "laurel"    // evento: competición
  | "medal"     // icono: histórico
  | "trophy";   // MVP: reconocimiento individual

export interface PackArtSpec {
  /** Nombre del fichero sin extensión: `pack-champions`. */
  file: string;
  /** El nombre que se imprime en la placa inferior. */
  name: string;
  /** Segunda línea del troquel: la familia del producto («EVENTO», «TEAM PACK»…). */
  line: string;
  material: Material;
  emblem: Emblem;
  /** Solo `crest`: las siglas REALES del equipo. */
  monogram?: string;
  /**
   * Variante del emblema dentro de su categoría (`meridian`: 0-3).
   *
   * Existe por un fallo real del primer render completo: los cuatro regionales compartían
   * acento (el cian que declaran en el catálogo) Y símbolo, así que eran cuatro sobres
   * indistinguibles — exactamente «la misma bolsa cambiando de color» que el §1 prohíbe, y sin
   * cambiar ni el color. El §6 pide un símbolo propio por región, así que cada una construye
   * su globo de otra forma: meridiano, ejes cruzados, arcos y retícula.
   */
  emblemVariant?: number;
  /** Barras de escalón bajo el emblema (1-3). Microdetalle, no color. */
  bars?: number;
  /** Anillos del troquel (1-3). */
  rings?: number;
  /** Código interno impreso en pequeño. Ej. `NX-CHM-26`. */
  code: string;
}

/* ═════════════════════════════ PIEZAS DEL MASTER ═════════════════════════════ */

/** La silueta: chaflán arriba-derecha y abajo-izquierda, como `.nx-clip`. */
function silhouettePath(inset = 0): string {
  const x0 = inset, y0 = inset, x1 = ART_W - inset, y1 = ART_H - inset;
  const c = CHAMFER;
  return `M${x0} ${y0} L${x1 - c} ${y0} L${x1} ${y0 + c} L${x1} ${y1} L${x0 + c} ${y1} L${x0} ${y1 - c} Z`;
}

/**
 * EL EMBLEMA NEXUS, con los trazados REALES de `public/branding/icon/icon.svg`.
 *
 * Es el escudo hexagonal de la marca con su núcleo. Se re-colorea al material del sobre —el
 * asset original es carmesí de marca— porque aquí actúa como troquel metálico sobre el foil,
 * no como logotipo a color. La GEOMETRÍA no se toca: es la aprobada.
 */
function nexusCrest(accent: string, id: string, size: number): string {
  const k = size / 256;
  return `
  <g transform="scale(${k.toFixed(5)})">
    <path d="M60 38 L196 38 L214 72 L214 150 L128 228 L42 150 L42 72 Z" fill="url(#shield-${id})"/>
    <path d="M60 38 L196 38 L214 72 L214 150 L128 228 L42 150 L42 72 Z" fill="none" stroke="${accent}" stroke-opacity="0.85" stroke-width="3"/>
    <path d="M70 50 L186 50 L202 77 L202 147 L128 212 L54 147 L54 77 Z" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="2"/>
    <path d="M42 132 L214 96 L214 110 L42 146 Z" fill="url(#sweep-${id})"/>
    <path d="M128 70 L149 103 L170 88 L177 138 L128 198 L79 138 L86 88 L107 103 Z" fill="url(#core-${id})"/>
    <path d="M79 138 L177 138 L128 198 Z" fill="${accent}" fill-opacity="0.55"/>
    <path d="M128 70 L149 103 L170 88 L177 138 L128 198 L79 138 L86 88 L107 103 Z" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="1.4"/>
  </g>`;
}

/**
 * Los emblemas de categoría. Todos viven DENTRO del mismo marco hexagonal: el marco es lo que
 * hace familia, el interior es lo que distingue el producto.
 */
function categoryEmblem(
  kind: Emblem, accent: string, id: string, size: number, monogram?: string, variant = 0,
): string {
  if (kind === "nexus") return nexusCrest(accent, id, size);

  const k = size / 100;
  const inner = (() => {
    switch (kind) {
      case "ascent":
        return `
          <path d="M32 62 L50 40 L68 62" fill="none" stroke="url(#core-${id})" stroke-width="4.5" stroke-linecap="square"/>
          <path d="M32 74 L50 52 L68 74" fill="none" stroke="${accent}" stroke-opacity="0.45" stroke-width="3" stroke-linecap="square"/>
          <path d="M43 34 L50 24 L57 34 Z" fill="${accent}" fill-opacity="0.6" stroke="url(#core-${id})" stroke-width="1.6"/>`;
      case "meridian": {
        /*
         * Cuatro construcciones del MISMO globo. Geometría abstracta del circuito: ni una
         * bandera, ni un mapa, ni iconografía nacional (§6).
         */
        const globo = `<circle cx="50" cy="50" r="21" fill="none" stroke="url(#core-${id})" stroke-width="3"/>`;
        const dentro = [
          // 0 · EMEA — meridiano y ecuador: el eje del circuito.
          `<ellipse cx="50" cy="50" rx="8.5" ry="21" fill="none" stroke="${accent}" stroke-opacity="0.85" stroke-width="2"/>
           <path d="M29 50 H71" stroke="${accent}" stroke-opacity="0.85" stroke-width="2"/>`,
          // 1 · AMÉRICAS — dos ejes cruzados: el globo inclinado, dos continentes.
          `<path d="M35 35 L65 65" stroke="${accent}" stroke-opacity="0.9" stroke-width="2.4"/>
           <path d="M65 35 L35 65" stroke="${accent}" stroke-opacity="0.9" stroke-width="2.4"/>
           <circle cx="50" cy="50" r="7.5" fill="none" stroke="${accent}" stroke-opacity="0.7" stroke-width="2"/>`,
          // 2 · PACIFIC — arcos concéntricos: el océano, no una costa concreta.
          `<path d="M31 56 Q50 44 69 56" fill="none" stroke="${accent}" stroke-opacity="0.9" stroke-width="2.4"/>
           <path d="M33 46 Q50 34 67 46" fill="none" stroke="${accent}" stroke-opacity="0.6" stroke-width="2"/>
           <path d="M36 64 Q50 55 64 64" fill="none" stroke="${accent}" stroke-opacity="0.45" stroke-width="1.8"/>`,
          // 3 · CHINA — retícula de tres husos: la división en franjas.
          `<path d="M41 31 V69" stroke="${accent}" stroke-opacity="0.85" stroke-width="2"/>
           <path d="M50 29 V71" stroke="${accent}" stroke-opacity="0.85" stroke-width="2.2"/>
           <path d="M59 31 V69" stroke="${accent}" stroke-opacity="0.85" stroke-width="2"/>
           <path d="M30 50 H70" stroke="${accent}" stroke-opacity="0.5" stroke-width="1.8"/>`,
        ][variant % 4];
        return globo + dentro;
      }
      case "crest":
        return `
          <path d="M50 26 L72 35 L72 55 Q72 68 50 77 Q28 68 28 55 L28 35 Z"
                fill="${accent}" fill-opacity="0.14" stroke="url(#core-${id})" stroke-width="3"/>
          ${monogram ? `<text x="50" y="${monogram.length >= 4 ? 59 : 60}" text-anchor="middle"
              font-family="${DISPLAY_FONT}" font-weight="700"
              font-size="${monogram.length >= 4 ? 17 : monogram.length === 3 ? 21 : 26}"
              letter-spacing="${monogram.length >= 4 ? 0.4 : 1}" fill="${accent}">${monogram}</text>` : ""}`;
      case "laurel":
        return `
          <path d="M35 70 Q24 50 35 30" fill="none" stroke="url(#core-${id})" stroke-width="3.2"/>
          <path d="M65 70 Q76 50 65 30" fill="none" stroke="url(#core-${id})" stroke-width="3.2"/>
          ${[0, 1, 2].map((i) => `
            <path d="M35 ${62 - i * 13} L25 ${57 - i * 13}" stroke="${accent}" stroke-opacity="0.85" stroke-width="2.4"/>
            <path d="M65 ${62 - i * 13} L75 ${57 - i * 13}" stroke="${accent}" stroke-opacity="0.85" stroke-width="2.4"/>`).join("")}
          <path d="M50 34 L58 50 L50 66 L42 50 Z" fill="${accent}" fill-opacity="0.5" stroke="url(#core-${id})" stroke-width="2"/>`;
      case "medal":
        return `
          <circle cx="50" cy="48" r="23" fill="none" stroke="url(#core-${id})" stroke-width="3"/>
          <path d="M50 29 L55.5 43 L70 43 L58.5 51.5 L63 66 L50 57.5 L37 66 L41.5 51.5 L30 43 L44.5 43 Z"
                fill="${accent}" fill-opacity="0.55" stroke="url(#core-${id})" stroke-width="1.8"/>
          <path d="M26 50 Q50 66 74 50" fill="none" stroke="${accent}" stroke-opacity="0.5" stroke-width="1.8"/>`;
      case "trophy":
        return `
          <path d="M34 28 H66 V42 Q66 58 50 62 Q34 58 34 42 Z" fill="${accent}" fill-opacity="0.2" stroke="url(#core-${id})" stroke-width="3"/>
          <path d="M34 32 H24 Q22 46 34 48" fill="none" stroke="url(#core-${id})" stroke-width="2.6"/>
          <path d="M66 32 H76 Q78 46 66 48" fill="none" stroke="url(#core-${id})" stroke-width="2.6"/>
          <path d="M50 62 V70" stroke="url(#core-${id})" stroke-width="3.4"/>
          <path d="M38 74 H62 L64 78 H36 Z" fill="${accent}" fill-opacity="0.55" stroke="url(#core-${id})" stroke-width="1.8"/>
          <path d="M44 40 L50 34 L56 40 L50 48 Z" fill="#ffffff" fill-opacity="0.35"/>`;
      default:
        return "";
    }
  })();

  return `
  <g transform="scale(${k.toFixed(5)})">
    <path d="M50 8 L86 29 L86 71 L50 92 L14 71 L14 29 Z" fill="url(#shield-${id})"/>
    <path d="M50 8 L86 29 L86 71 L50 92 L14 71 L14 29 Z" fill="none" stroke="url(#core-${id})" stroke-width="2.6"/>
    <path d="M50 14 L81 32 L81 68 L50 86 L19 68 L19 32 Z" fill="none" stroke="#000" stroke-opacity="0.4" stroke-width="1.6"/>
    ${inner}
  </g>`;
}

/* ═════════════════════════════ EL SOBRE COMPLETO ═════════════════════════════ */

/**
 * LA CARA DEL SOBRE, de fuera adentro. El orden de las capas ES el diseño:
 *
 *   1. material         tres paradas cruzadas: metal, no fondo de caja
 *   2. estriado         micro-rayado vertical: superficie cepillada
 *   3. foil             bandas diagonales a 115°, la firma del sobre NEXUS
 *   4. luz cenital      un solo foco controlado desde arriba (§1: iluminación controlada)
 *   5. franja de acento diagonal difusa detrás del troquel
 *   6. viñeta           las esquinas caen: da volumen sin sombra horneada
 *   7. marco interior   un filo impreso, como en un envase real
 *   8. zona de sellado  material distinto arriba + costura perforada
 *   9. troquel          emblema de categoría + NEXUS + línea de familia
 *  10. placa inferior   nombre del producto + código interno
 *  11. canto            biseles: luz arriba, sombra abajo, canto de acento
 *
 * NO lleva sombra proyectada (§11): la iluminación de la escena es de la interfaz, y así el
 * mismo asset sirve en la tienda, en el héroe y en la apertura.
 */
export function packFrontSvg(spec: PackArtSpec): string {
  const { material: m, code } = spec;
  const id = spec.file.replace(/[^a-z0-9]/gi, "");
  const rings = spec.rings ?? 1;
  const bars = spec.bars ?? 0;
  const emblemSize = Math.round(ART_W * 0.40);
  const emblemX = (ART_W - emblemSize) / 2;
  const emblemY = FLAP + Math.round(ART_H * 0.045);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ART_W}" height="${ART_H}" viewBox="0 0 ${ART_W} ${ART_H}">
  <defs>
    <linearGradient id="body-${id}" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0" stop-color="${m.base[0]}"/>
      <stop offset="0.55" stop-color="${m.base[1]}"/>
      <stop offset="1" stop-color="${m.base[2]}"/>
    </linearGradient>
    <linearGradient id="tint-${id}" x1="0" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="${m.accent}" stop-opacity="0.18"/>
      <stop offset="0.42" stop-color="${m.accent}" stop-opacity="0.03"/>
      <stop offset="1" stop-color="${m.accent}" stop-opacity="0.10"/>
    </linearGradient>
    <radialGradient id="toplight-${id}" cx="0.5" cy="0" r="0.85">
      <stop offset="0" stop-color="#ffffff" stop-opacity="${(0.16 + m.sheen * 0.14).toFixed(3)}"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette-${id}" cx="0.5" cy="0.45" r="0.78">
      <stop offset="0.55" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.55"/>
    </radialGradient>
    <linearGradient id="spec-${id}" x1="0" y1="0" x2="1" y2="0.35">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="${(0.10 + m.sheen * 0.22).toFixed(3)}"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="shield-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${m.emblemBase[0]}" stop-opacity="0.95"/>
      <stop offset="1" stop-color="${m.emblemBase[1]}" stop-opacity="0.95"/>
    </linearGradient>
    <linearGradient id="core-${id}" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="1" stop-color="${m.accent}" stop-opacity="0.9"/>
    </linearGradient>
    <linearGradient id="sweep-${id}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${m.accent}" stop-opacity="0"/>
      <stop offset="1" stop-color="${m.accent}" stop-opacity="0.5"/>
    </linearGradient>
    <linearGradient id="plate-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${m.accent}" stop-opacity="0.26"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.62"/>
    </linearGradient>
    <linearGradient id="flap-${id}" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0" stop-color="${m.flap[0]}"/>
      <stop offset="1" stop-color="${m.flap[1]}"/>
    </linearGradient>

    <!-- Estriado: superficie cepillada. Verticales finas, opacidad muy baja. -->
    <pattern id="brush-${id}" width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="1" height="6" fill="#ffffff" opacity="0.05"/>
      <rect x="3" width="1" height="6" fill="#000000" opacity="0.07"/>
    </pattern>
    <!-- Foil: la firma del sobre. Diagonales a 115°, tintadas del acento. -->
    <pattern id="foil-${id}" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(115)">
      <rect width="2" height="26" fill="${m.accent}" opacity="${(0.22 * m.foil).toFixed(3)}"/>
      <rect x="9" width="1" height="26" fill="${m.accent}" opacity="${(0.10 * m.foil).toFixed(3)}"/>
    </pattern>
    <!-- Retícula técnica, apenas perceptible: el idioma de NEXUS. -->
    <pattern id="grid-${id}" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M0 0 H40 M0 0 V40" stroke="#ffffff" stroke-opacity="0.035" stroke-width="1"/>
    </pattern>

    <clipPath id="sil-${id}"><path d="${silhouettePath()}"/></clipPath>
  </defs>

  <!-- TODO dentro de la silueta: fuera queda alfa 0, sin fondo horneado (§10) -->
  <g clip-path="url(#sil-${id})">
    <rect width="${ART_W}" height="${ART_H}" fill="url(#body-${id})"/>
    <rect width="${ART_W}" height="${ART_H}" fill="url(#tint-${id})"/>
    <rect width="${ART_W}" height="${ART_H}" fill="url(#brush-${id})"/>
    <rect width="${ART_W}" height="${ART_H}" fill="url(#grid-${id})"/>
    <rect width="${ART_W}" height="${ART_H}" fill="url(#foil-${id})"/>

    <!--
      Franja de acento difusa tras el troquel. Al 30 % ensuciaba: sobre el Champions, el oro
      de la franja sumado al tinte dorado del cuerpo daba un verde oliva turbio. Al 16 % separa
      el troquel del fondo sin teñir el material.
    -->
    <g opacity="0.16">
      <rect x="${-ART_W * 0.2}" y="${ART_H * 0.40}" width="${ART_W * 1.4}" height="${ART_H * 0.085}"
            fill="${m.accent}" transform="rotate(-12 ${ART_W / 2} ${ART_H * 0.44})"/>
    </g>

    <rect width="${ART_W}" height="${ART_H}" fill="url(#toplight-${id})"/>
    <!-- Reflejo especular: una banda que cruza. En los mates casi no existe. -->
    <rect x="${-ART_W * 0.1}" y="0" width="${ART_W * 0.42}" height="${ART_H}"
          fill="url(#spec-${id})" transform="skewX(-12)"/>
    <rect width="${ART_W}" height="${ART_H}" fill="url(#vignette-${id})"/>

    <!-- ZONA DE SELLADO: material propio + costura perforada -->
    <rect width="${ART_W}" height="${FLAP}" fill="url(#flap-${id})" opacity="0.92"/>
    <rect width="${ART_W}" height="${FLAP}" fill="url(#foil-${id})" opacity="0.5"/>
    <path d="M0 ${FLAP} H${ART_W}" stroke="${m.accent}" stroke-opacity="0.55" stroke-width="2"/>
    <path d="M${CHAMFER * 0.5} ${FLAP - 7} H${ART_W - CHAMFER * 0.5}" stroke="${m.accent}" stroke-opacity="0.8"
          stroke-width="3" stroke-dasharray="14 11" stroke-linecap="round"/>
    ${Array.from({ length: 13 }, (_, i) => {
      const x = (ART_W / 13) * (i + 0.5);
      return `<circle cx="${x.toFixed(1)}" cy="${FLAP + 13}" r="3.2" fill="#000" fill-opacity="0.5"/>`;
    }).join("")}

    <!-- MARCO INTERIOR impreso -->
    <path d="${silhouettePath(Math.round(ART_W * 0.045))}" fill="none"
          stroke="${m.accent}" stroke-opacity="0.30" stroke-width="2"/>

    <!-- TROQUEL: anillos + emblema de categoría -->
    <g transform="translate(${ART_W / 2} ${emblemY + emblemSize / 2})">
      ${Array.from({ length: rings }, (_, i) => `
        <circle cx="0" cy="0" r="${emblemSize * (0.62 - i * 0.055)}" fill="none"
                stroke="${m.accent}" stroke-opacity="${(0.5 - i * 0.13).toFixed(2)}"
                stroke-width="2" stroke-dasharray="11 9"/>`).join("")}
    </g>
    <g transform="translate(${emblemX} ${emblemY})">
      ${categoryEmblem(spec.emblem, m.accent, id, emblemSize, spec.monogram, spec.emblemVariant ?? 0)}
    </g>

    <!-- WORDMARK + línea de familia -->
    <text x="${ART_W / 2}" y="${emblemY + emblemSize + Math.round(ART_H * 0.072)}" text-anchor="middle"
          font-family="${DISPLAY_FONT}" font-size="${Math.round(ART_W * 0.115)}" font-weight="700"
          letter-spacing="${Math.round(ART_W * 0.032)}" fill="${m.ink}">NEXUS</text>
    <!--
      LA LÍNEA DE FAMILIA. En versalitas y con tinta secundaria, no con el acento: en el primer
      render «Rareza» iba en gris claro sobre plata pulida y no se leía. Va en MAYÚSCULAS porque
      es el idioma de la casa, y con un cuerpo un punto mayor para que exista a tamaño de carril.
    -->
    <text x="${ART_W / 2}" y="${emblemY + emblemSize + Math.round(ART_H * 0.101)}" text-anchor="middle"
          font-family="${DISPLAY_FONT}" font-size="${Math.round(ART_W * 0.034)}" font-weight="700"
          letter-spacing="${Math.round(ART_W * 0.022)}" fill="${m.inkSoft}" opacity="0.95">${spec.line.toUpperCase()}</text>

    <!-- BARRAS DE ESCALÓN: microdetalle, no color -->
    ${bars > 0 ? `<g transform="translate(${ART_W / 2} ${emblemY + emblemSize + Math.round(ART_H * 0.125)})">
      ${Array.from({ length: bars }, (_, i) => {
        const w = Math.round(ART_W * 0.055), gap = Math.round(ART_W * 0.016);
        const total = bars * w + (bars - 1) * gap;
        return `<rect x="${(-total / 2 + i * (w + gap)).toFixed(1)}" y="0" width="${w}" height="5"
                      fill="${m.accent}" opacity="${(0.95 - i * 0.22).toFixed(2)}"/>`;
      }).join("")}
    </g>` : ""}

    <!--
      PLACA INFERIOR: nombre del producto + código interno.

      La placa es OSCURA en los siete materiales, y es deliberado por dos motivos. El primero
      es legibilidad: cuando el degradado dependía del material, sobre bronce y plata el código
      quedaba tinta oscura sobre placa oscurecida y desaparecía (medido en el segundo render).
      El segundo es de familia: una banda negra con el nombre en blanco es la constante que
      hace que los diecinueve sobres se lean como la misma colección aunque el cuerpo sea
      bronce, plata, oro o grafito.
    -->
    <g>
      <rect x="0" y="${ART_H - Math.round(ART_H * 0.135)}" width="${ART_W}" height="${Math.round(ART_H * 0.135)}"
            fill="#05060a" fill-opacity="0.82"/>
      <rect x="0" y="${ART_H - Math.round(ART_H * 0.135)}" width="${ART_W}" height="${Math.round(ART_H * 0.135)}"
            fill="url(#plate-${id})"/>
      <path d="M0 ${ART_H - Math.round(ART_H * 0.135)} H${ART_W}" stroke="${m.accent}" stroke-opacity="0.75" stroke-width="2.5"/>
      <text x="${ART_W / 2}" y="${ART_H - Math.round(ART_H * 0.072)}" text-anchor="middle"
            font-family="${DISPLAY_FONT}" font-size="${Math.round(ART_W * 0.062)}" font-weight="700"
            letter-spacing="${Math.round(ART_W * 0.012)}" fill="#ffffff">${spec.name.toUpperCase()}</text>
      <text x="${ART_W / 2}" y="${ART_H - Math.round(ART_H * 0.034)}" text-anchor="middle"
            font-family="${DISPLAY_FONT}" font-size="${Math.round(ART_W * 0.026)}" font-weight="700"
            letter-spacing="${Math.round(ART_W * 0.014)}" fill="${m.accent}" opacity="0.85">${code}</text>
    </g>

    <!-- CANTO: bisel de luz arriba, sombra abajo. Da grosor sin sombra proyectada. -->
    <path d="M0 1 H${ART_W}" stroke="#ffffff" stroke-opacity="0.34" stroke-width="2"/>
    <path d="M0 ${ART_H - 1} H${ART_W}" stroke="#000000" stroke-opacity="0.55" stroke-width="2"/>
    <path d="M1 0 V${ART_H}" stroke="#ffffff" stroke-opacity="0.12" stroke-width="2"/>
  </g>

  <!-- Canto de acento siguiendo la silueta: el filo del objeto -->
  <path d="${silhouettePath(1.5)}" fill="none" stroke="${m.accent}" stroke-opacity="0.9" stroke-width="3"/>
  <path d="${silhouettePath(5)}" fill="none" stroke="#000000" stroke-opacity="0.35" stroke-width="2"/>
</svg>`;
}
