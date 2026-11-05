/**
 * F80 · INSTRUMENTO (fuera de CI): huella de TODO lo que define un sobre salvo su precio.
 *
 *   npx tsx scripts/_f80-pack-snapshot.ts <salida.json>
 *
 * Serializa, para cada sobre: la definición sin `price` (contenido, nº de cartas, pesos, garantías, región, equipo,
 * ciclo de vida…), su estadística medida sin `price`, la distribución por clase de la línea principal y las odds que
 * enseña la UI (`packOddsFor`, la misma llamada que /packs/[id] y la tienda). Más los créditos iniciales. Imprime el
 * sha256 de cada bloque: antes/después de F80 deben ser IDÉNTICOS salvo el bloque `prices`.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PACKS } from "../src/data/packs";
import { PACK_STATS } from "../src/data/packStats";
import { MAIN_PACK_DISTRIBUTION } from "../src/domain/packs/packClass";
import { packOddsFor } from "../src/domain/packs/odds";
import { STARTER_GRANT } from "../src/domain/onboarding/starterMath";

const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v);
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(stable(v))).digest("hex");
const omit = <T extends object>(o: T, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));

const packsNoPrice = PACKS.map((p) => omit(p, "price"));
const statsNoPrice = Object.fromEntries(Object.entries(PACK_STATS).map(([id, s]) => [id, omit(s as object, "price")]));
const odds = Object.fromEntries(PACKS.map((p) => [p.id, packOddsFor(p, PACK_STATS[p.id] ?? null)]));
const prices = Object.fromEntries(PACKS.map((p) => [p.id, p.price]));
const statPrices = Object.fromEntries(Object.entries(PACK_STATS).map(([id, s]) => [id, (s as { price: number }).price]));
const blocks = { packsNoPrice, statsNoPrice, mainDistribution: MAIN_PACK_DISTRIBUTION, odds, starter: STARTER_GRANT, prices, statPrices };
const hashes = Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, sha(v)]));
writeFileSync(process.argv[2] ?? "f80-snapshot.json", JSON.stringify({ hashes, prices, statPrices, packs: PACKS.length }, null, 1) + "\n");
for (const [k, h] of Object.entries(hashes)) console.log(`${k.padEnd(18)} ${h}`);
