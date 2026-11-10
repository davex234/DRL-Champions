/**
 * FASE 51.2 · GENERADOR DE LOS GRAFOS DE NAVEGACIÓN (instrumento fuera de CI; determinista).
 *
 *   npx tsx scripts/_fase51-2-navgen.ts [--only=ascent]
 *
 * Para cada uno de los doce mapas del catálogo, sobre SU PNG (`public/maps/*.png`):
 *   1. clasifica píxeles (suelo / pared / fondo / marca) con `navigation/walkability.ts`;
 *   2. rejilla de celdas de 4 px y componente transitable principal;
 *   3. coloca cada NODO táctico (una zona del simulador) sobre suelo, cerca de su anclaje
 *      (`NAV_ANCHORS`) y con holgura respecto a las paredes;
 *   4. para cada arista del modelo del simulador (`ADJ`), A* sobre la rejilla —coste mayor pegado a
 *      las paredes, para ir por el centro de los pasillos— y estirado de la cuerda con línea de
 *      visión: los WAYPOINTS son los vértices mínimos para no atravesar ninguna pared;
 *   5. escribe `src/domain/tactics/navigation/maps/<id>.ts`.
 *
 * Nada se inventa: si dos nodos no tienen camino sobre el suelo del asset, el generador FALLA.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { availableMaps } from "../src/domain/tactics/maps";
import { ZONES, ADJ, type ZoneId } from "../src/sim/map/ascentA";
import { walkGrid, type RawImage } from "../src/domain/tactics/navigation/walkability";
import { NAV_ANCHORS } from "../src/domain/tactics/navigation/anchors";

const CELL = 4;
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);

async function main() {
  const only = arg("only");
  for (const m of availableMaps()) {
    if (only && m.id !== only) continue;
    const { data, info } = await sharp(join(process.cwd(), "public", "maps", m.asset)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const img: RawImage = { width: info.width, height: info.height, channels: info.channels, data };
    const { cols, rows, walk } = walkGrid(img, CELL);
    const idx = (c: number, r: number) => r * cols + c;

    /* Componente principal (4-vecinos). */
    const comp = new Int32Array(cols * rows).fill(-1);
    const sizes: number[] = [];
    for (let i = 0; i < walk.length; i++) {
      if (!walk[i] || comp[i] >= 0) continue;
      const id = sizes.length; let n = 0; const q = [i]; comp[i] = id;
      while (q.length) {
        const k = q.pop()!; n++;
        const c = k % cols, r = (k - c) / cols;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
          const j = idx(cc, rr);
          if (walk[j] && comp[j] < 0) { comp[j] = id; q.push(j); }
        }
      }
      sizes.push(n);
    }
    const main = sizes.indexOf(Math.max(...sizes));
    const ok = (i: number) => comp[i] === main;

    /* Holgura: distancia (en celdas, 8-vecinos) a la celda no transitable más cercana. */
    const clr = new Int32Array(cols * rows).fill(1 << 20);
    const q: number[] = [];
    for (let i = 0; i < walk.length; i++) if (!ok(i)) { clr[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const k = q[h]; const c = k % cols, r = (k - c) / cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = idx(cc, rr);
        if (clr[j] > clr[k] + 1) { clr[j] = clr[k] + 1; q.push(j); }
      }
    }

    /* Nodos: la celda con más holgura (hasta 5) dentro de un radio del anclaje; empate → la más cercana. */
    const anchors = NAV_ANCHORS[m.id];
    if (!anchors) throw new Error(`${m.id}: sin anclajes`);
    const nodeCell: Record<string, number> = {};
    for (const z of Object.keys(ZONES) as ZoneId[]) {
      const [ax, ay] = anchors[z];
      const c0 = Math.floor((ax * img.width) / CELL), r0 = Math.floor((ay * img.height) / CELL);
      let best = -1, bs = -Infinity;
      for (let rad = 6; best < 0 && rad < 80; rad += 6) {
        for (let r = r0 - rad; r <= r0 + rad; r++) for (let c = c0 - rad; c <= c0 + rad; c++) {
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          const i = idx(c, r); if (!ok(i)) continue;
          const d = Math.hypot(c - c0, r - r0); if (d > rad) continue;
          const s = Math.min(clr[i], 5) * 10 - d;
          if (s > bs) { bs = s; best = i; }
        }
      }
      if (best < 0) throw new Error(`${m.id}/${z}: ningún suelo cerca del anclaje`);
      nodeCell[z] = best;
    }

    /* LOS en la rejilla: todas las celdas atravesadas (muestreo fino) transitables. */
    const los = (a: number, b: number) => {
      const ac = a % cols, ar = (a - ac) / cols, bc = b % cols, br = (b - bc) / cols;
      const n = Math.ceil(Math.hypot(bc - ac, br - ar) * 5) + 1;
      for (let s = 0; s <= n; s++) {
        const t = s / n; const x = ac + 0.5 + (bc - ac) * t, y = ar + 0.5 + (br - ar) * t;
        for (const [ox, oy] of [[0, 0], [0.35, 0.35], [-0.35, 0.35], [0.35, -0.35], [-0.35, -0.35]]) {
          const cc = Math.floor(x + ox), rr = Math.floor(y + oy);
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows || !ok(idx(cc, rr))) return false;
        }
      }
      return true;
    };

    /* A* 8-vecinos, sin cortar esquinas, con coste extra pegado a pared. */
    const astar = (s: number, g: number): number[] | null => {
      const gs = new Float64Array(cols * rows).fill(Infinity);
      const prev = new Int32Array(cols * rows).fill(-1);
      const gc = g % cols, gr = (g - gc) / cols;
      const open: [number, number][] = [[0, s]]; gs[s] = 0;
      const closed = new Uint8Array(cols * rows);
      while (open.length) {
        let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0] || (open[i][0] === open[bi][0] && open[i][1] < open[bi][1])) bi = i;
        const [, k] = open.splice(bi, 1)[0];
        if (closed[k]) continue; closed[k] = 1;
        if (k === g) break;
        const c = k % cols, r = (k - c) / cols;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
          const j = idx(cc, rr); if (!ok(j) || closed[j]) continue;
          if (dr && dc && (!ok(idx(c + dc, r)) || !ok(idx(c, r + dr)))) continue;
          const pen = 1 + 3 / Math.min(clr[j], 6);
          const ng = gs[k] + Math.hypot(dc, dr) * pen;
          if (ng < gs[j]) { gs[j] = ng; prev[j] = k; open.push([ng + Math.hypot(gc - cc, gr - rr), j]); }
        }
      }
      if (!closed[g]) return null;
      const path: number[] = []; for (let k = g; k >= 0; k = prev[k]) path.unshift(k);
      return path[0] === s ? path : null;
    };

    const pt = (i: number): [number, number] => {
      const c = i % cols, r = (i - c) / cols;
      return [+(((c + 0.5) * CELL) / img.width).toFixed(4), +(((r + 0.5) * CELL) / img.height).toFixed(4)];
    };

    const pares: [ZoneId, ZoneId][] = [];
    for (const a of Object.keys(ADJ) as ZoneId[]) for (const b of ADJ[a]) if (a < b || !ADJ[b].includes(a)) pares.push(a < b ? [a, b] : [b, a]);
    const unicos = [...new Map(pares.map((p) => [p.join("|"), p])).values()].sort((x, y) => x.join().localeCompare(y.join()));

    const edges: string[] = [];
    let nwp = 0;
    for (const [a, b] of unicos) {
      const path = astar(nodeCell[a], nodeCell[b]);
      if (!path) throw new Error(`${m.id}: sin camino ${a} → ${b}`);
      /* Estirado de cuerda: desde cada vértice, el más lejano visible. */
      const keep: number[] = [path[0]];
      let i = 0;
      while (i < path.length - 1) {
        let j = path.length - 1;
        while (j > i + 1 && !los(path[i], path[j])) j--;
        keep.push(path[j]); i = j;
      }
      const pts = keep.map(pt);
      /* Holgura mínima a lo largo de la trayectoria ya estirada (muestreo fino), menos un margen. */
      let minClr = Infinity;
      for (let k = 1; k < keep.length; k++) {
        const a0 = keep[k - 1], b0 = keep[k];
        const ac = a0 % cols, ar = (a0 - ac) / cols, bc = b0 % cols, br = (b0 - bc) / cols;
        const n = Math.ceil(Math.hypot(bc - ac, br - ar) * 4) + 1;
        for (let s2 = 0; s2 <= n; s2++) {
          const cc = Math.floor(ac + 0.5 + ((bc - ac) * s2) / n), rr = Math.floor(ar + 0.5 + ((br - ar) * s2) / n);
          minClr = Math.min(minClr, clr[idx(cc, rr)]);
        }
      }
      const halfWidth = Math.max(0, (minClr - 1.5) * CELL) / Math.min(img.width, img.height);
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += Math.hypot((pts[k][0] - pts[k - 1][0]) * img.width, (pts[k][1] - pts[k - 1][1]) * img.height);
      const wps = pts.slice(1, -1);
      nwp += wps.length;
      edges.push(`    { from: "${a}", to: "${b}", cost: ${(len / 1000).toFixed(4)}, halfWidth: ${halfWidth.toFixed(4)}, waypoints: [${wps.map((p) => `[${p[0]}, ${p[1]}]`).join(", ")}] },`);
    }

    const nodes = (Object.keys(ZONES) as ZoneId[]).map((z) => { const [x, y] = pt(nodeCell[z]); return `    { id: "${z}", zone: "${z}", x: ${x}, y: ${y} },`; });
    const file = `/**
 * FASE 51.2 · Grafo de navegación de ${m.name.toUpperCase()} — GENERADO por \`scripts/_fase51-2-navgen.ts\`
 * sobre \`public/maps/${m.asset}\` (${img.width} × ${img.height}). No editar a mano: cambiar los
 * anclajes (\`navigation/anchors.ts\`) y regenerar. Nodos = zonas del simulador; aristas = su grafo de
 * corredores (\`ADJ\`) recorrido sobre el suelo real del asset; waypoints = rodeos de pared.
 */
import type { MapNavigationGraph } from "../types";

export const ${m.id.toUpperCase()}_NAV: MapNavigationGraph = {
  mapId: "${m.id}",
  asset: { width: ${img.width}, height: ${img.height} },
  nodes: [
${nodes.join("\n")}
  ],
  edges: [
${edges.join("\n")}
  ],
};
`;
    writeFileSync(join(process.cwd(), "src", "domain", "tactics", "navigation", "maps", `${m.id}.ts`), file);
    console.log(`${m.id}: ${nodes.length} nodos, ${edges.length} aristas, ${nwp} waypoints · componente principal ${sizes[main]} celdas de ${walk.reduce((s, v) => s + v, 0)}`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
