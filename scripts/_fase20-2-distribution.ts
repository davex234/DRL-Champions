/**
 * INSTRUMENTO DE MEDIDA — SESGO DE LOS TEAM PACKS CON EL MOTOR REAL (Fase 20.2).
 *
 *   npx tsx scripts/_fase20-2-distribution.ts
 *
 * Prefijado con `_` y FUERA de CI. No escribe nada y no toca la base de datos.
 *
 * Mide, para cada Team Pack vivo y para cada propuesta con identidad decidida, lo que entrega
 * `PackEngine.open` con y sin los pools que crearían `content-pools:migrate` (EXPLICIT, peso 1,
 * prioridad 100) y `content-pools:boost` (RULE, peso `TEAM_BOOST_WEIGHT`, prioridad 50),
 * compuestos con el `composeDistribution` real.
 *
 * ESTO NO ES QA. Es la medida del motor; la apertura de un sobre comprado en la tienda contra
 * la base de datos es otra prueba y no se sustituye con esta.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEAM_PACK_AUDIT, proposedTeamPack } from "../src/data/teamPackCatalog";
import { getPack } from "../src/data/packs";
import { CardRegistry } from "../src/collection/registry";
import { PackEngine } from "../src/pack";
import { buildPool } from "../src/domain/packs/pool";
import { freshPity } from "../src/domain/packs/pity";
import { composeDistribution, type PoolDef } from "../src/domain/packs/distribution";
import type { PackDef } from "../src/domain/packs/types";

const W = Number(readFileSync(join(process.cwd(), "scripts", "content-pools-boost.ts"), "utf8")
  .match(/TEAM_BOOST_WEIGHT\s*=\s*(\d+)/)?.[1]);
const N = 2000;
const NOW = 1_700_000_000_000;
const registry = new CardRegistry();

const casos: { pack: PackDef; vivo: boolean }[] = [];
for (const e of TEAM_PACK_AUDIT) {
  const vivo = getPack(e.packId);
  if (vivo) casos.push({ pack: vivo, vivo: true });
  else if (e.status === "PARTIAL" && e.packTeam) casos.push({ pack: proposedTeamPack(e)!, vivo: false });
}
const navi = getPack("team-navi");
if (navi) casos.push({ pack: navi, vivo: true });

console.log(`\n═══ SESGO DE TEAM PACKS · motor real · ${N} aperturas por sobre y configuración · peso ${W} ═══\n`);
console.log("  sobre            estado     equipo/pool   cuota sin → con     cartas/sobre   P(≥1) sin → con    sobres sin ninguna");

for (const { pack, vivo } of casos) {
  const flat = buildPool(registry, pack).flat;
  const suyas = new Set(flat.filter((c) => registry.player(c.playerId)?.team === pack.team).map((c) => c.id));
  const base: PoolDef = { id: `pack-${pack.id}`, mode: "EXPLICIT", rules: {}, entries: flat.map((c) => ({ cardId: c.id, weight: 1, mode: "INCLUDE" })) };
  const boost: PoolDef = { id: `boost-${pack.id}`, mode: "RULE", rules: {}, entries: [...suyas].map((cardId) => ({ cardId, weight: W, mode: "INCLUDE" })) };
  const dist = composeDistribution([{ pool: base, priority: 100 }, { pool: boost, priority: 50 }], NOW)!;

  const medir = (motor: PackEngine) => {
    let del = 0, total = 0, conAlguna = 0;
    for (let i = 0; i < N; i++) {
      const r = motor.open(pack, { seed: (0x9e3779b9 + i * 7919) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: NOW });
      let n = 0;
      for (const ins of r.instances) { total++; if (suyas.has(ins.cardId)) { del++; n++; } }
      if (n > 0) conAlguna++;
    }
    return { cuota: del / total, porSobre: del / N, p: conAlguna / N, ninguna: N - conAlguna };
  };
  const sin = medir(new PackEngine(registry));
  const con = medir(new PackEngine(registry, (id) => (id === pack.id ? dist : null)));

  const pct = (x: number) => `${(x * 100).toFixed(1)} %`.padStart(7);
  console.log(
    `  ${pack.id.padEnd(16)} ${(vivo ? "vivo" : "propuesta").padEnd(10)} ${`${suyas.size}/${flat.length}`.padEnd(13)} `
    + `${pct(sin.cuota)} → ${pct(con.cuota)}   ${sin.porSobre.toFixed(2)} → ${con.porSobre.toFixed(2)}   `
    + `${pct(sin.p)} → ${pct(con.p)}   ${con.ninguna} de ${N}`,
  );
}
console.log("");
