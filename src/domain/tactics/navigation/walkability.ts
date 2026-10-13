/**
 * FASE 51.2 · QUÉ ES TRANSITABLE EN UN ASSET DE MAPA — clasificador de píxeles, puro.
 *
 * Lo usan el generador de grafos (`scripts/_fase51-2-navgen.ts`) y los tests, sobre los MISMOS PNG del
 * Tactical Coach (`public/maps/*.png`). Los doce comparten estilo: fondo casi negro, suelo gris,
 * sitios en tono tostado y paredes/contornos en líneas blancas.
 *
 *   · FONDO     luminancia < 21                          → no transitable (fuera del mapa)
 *   · PARED     luminancia > 140 y poco saturado          → no transitable (contorno, pared, rótulo)
 *   · MARCA     luminancia > 120 y saturado               → no transitable (líneas de color fuera del suelo)
 *   · SUELO     el resto                                  → transitable
 *
 * No se usa en el navegador: el grafo ya generado es lo único que viaja con la aplicación.
 */
export type PixelClass = "floor" | "wall" | "background" | "mark";

export function classifyPixel(r: number, g: number, b: number, a = 255): PixelClass {
  if (a < 128) return "background";
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < 21) return "background";
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  if (lum > 140 && sat < 45) return "wall";
  if (lum > 120 && sat >= 45) return "mark";
  return "floor";
}

export interface RawImage { width: number; height: number; channels: number; data: Uint8Array | Buffer }

export function pixelClassAt(img: RawImage, x: number, y: number): PixelClass {
  const xi = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const o = (yi * img.width + xi) * img.channels;
  return classifyPixel(img.data[o], img.data[o + 1], img.data[o + 2], img.channels > 3 ? img.data[o + 3] : 255);
}

/**
 * Rejilla de celdas `cell × cell` px. Una celda es transitable solo si TODOS sus píxeles son suelo:
 * una sola muestra de pared, marca o fondo la bloquea (el antialias gris de una línea cuenta como suelo).
 */
export function walkGrid(img: RawImage, cell: number): { cols: number; rows: number; walk: Uint8Array } {
  const cols = Math.floor(img.width / cell);
  const rows = Math.floor(img.height / cell);
  const walk = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let bad = 0;
      for (let y = r * cell; y < (r + 1) * cell && !bad; y++) {
        for (let x = c * cell; x < (c + 1) * cell; x++) {
          if (pixelClassAt(img, x, y) !== "floor") { bad = 1; break; }
        }
      }
      walk[r * cols + c] = bad ? 0 : 1;
    }
  }
  return { cols, rows, walk };
}
