/**
 * FASE 51.2 · instrumento: para cada mapa, el caso de RODEO más claro: dos nodos a menos de 450 px en
 * línea recta, cuya recta atraviesa al menos 6 muestras de pared/fondo (no una letra de rótulo), y cuya
 * ruta real es la más larga en proporción a la recta. Mismo criterio que el test F512 W1.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { availableMaps } from "../src/domain/tactics/maps";
import { NAV_GRAPHS } from "../src/domain/tactics/navigation/maps";
import { pixelClassAt } from "../src/domain/tactics/navigation/walkability";
import { findPath } from "../src/domain/tactics/navigation/pathfinding";
(async () => {
  const out: Record<string, [string, string]> = {};
  for (const m of availableMaps()) {
    const { data, info } = await sharp(join(process.cwd(), "public", "maps", m.asset)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const im = { width: info.width, height: info.height, channels: info.channels, data };
    const g = NAV_GRAPHS[m.id];
    let best: { a: string; b: string; d: number; ratio: number } | null = null;
    for (const a of g.nodes) for (const b of g.nodes) {
      if (a.id >= b.id) continue;
      const ax = a.x * im.width, ay = a.y * im.height, bx = b.x * im.width, by = b.y * im.height;
      const d = Math.hypot(bx - ax, by - ay); const n = Math.ceil(d / 1.5);
      let malas = 0;
      for (let k = 0; k <= n; k++) if (pixelClassAt(im, ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n) !== "floor") malas++;
      if (malas < 6 || d < 120 || d > 450) continue;
      const r = findPath(g, a.id, b.id);
      if (!r.ok) continue;
      let len = 0;
      for (let k = 1; k < r.points.length; k++) len += Math.hypot((r.points[k][0] - r.points[k - 1][0]) * im.width, (r.points[k][1] - r.points[k - 1][1]) * im.height);
      const ratio = len / d;
      if (!best || ratio > best.ratio) best = { a: a.id, b: b.id, d, ratio };
    }
    if (best) out[m.id] = [best.a, best.b];
    console.log(m.id, best);
  }
  writeFileSync(join(process.cwd(), "src", "app", "design-system", "fase51-2", "wallCases.ts"),
    `/** FASE 51.2 · generado por scripts/_fase51-2-wallcases.ts: el par de nodos más cercano cuya recta cruza geometría. */\nexport const WALL_CASES: Record<string, [string, string]> = ${JSON.stringify(out, null, 2)};\n`);
})();
