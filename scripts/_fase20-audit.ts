/** Auditoría Fase 20: qué equipos y qué cartas reales hay, por equipo y por rareza. */
import { PLAYERS } from "@/data/players";
import { CARDS } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import { TEAMS } from "@/data/teams";

console.log(`jugadores: ${PLAYERS.length} · cartas: ${CARDS.length} · equipos declarados: ${TEAMS.length}`);

const porEquipo = new Map<string, { jugadores: Set<string>; cartas: number; buckets: Record<string, number>; region: Set<string> }>();
for (const c of CARDS) {
  const p = PLAYERS.find((x) => x.id === c.playerId);
  if (!p) continue;
  const e = porEquipo.get(p.team) ?? { jugadores: new Set(), cartas: 0, buckets: {}, region: new Set() };
  e.jugadores.add(p.id);
  e.cartas += 1;
  const b = bucketForRank(getVariant(c.variantId).rank);
  e.buckets[b] = (e.buckets[b] ?? 0) + 1;
  e.region.add(p.region);
  porEquipo.set(p.team, e);
}

const filas = [...porEquipo.entries()]
  .map(([team, e]) => ({
    team,
    jugadores: e.jugadores.size,
    cartas: e.cartas,
    region: [...e.region].join("/"),
    common: e.buckets.common ?? 0,
    uncommon: e.buckets.uncommon ?? 0,
    rare: e.buckets.rare ?? 0,
    epic: e.buckets.epic ?? 0,
    legendary: e.buckets.legendary ?? 0,
  }))
  .sort((a, b) => b.cartas - a.cartas);

console.log("\nequipo".padEnd(22) + "jug  cartas  reg        com unc rar epi leg");
for (const f of filas) {
  console.log(
    f.team.padEnd(22) +
      String(f.jugadores).padStart(3) +
      String(f.cartas).padStart(8) +
      "  " + f.region.padEnd(10) +
      String(f.common).padStart(4) + String(f.uncommon).padStart(4) +
      String(f.rare).padStart(4) + String(f.epic).padStart(4) + String(f.legendary).padStart(4),
  );
}

console.log("\n=== EQUIPOS CANDIDATOS A TEAM PACK (>=5 jugadores y >=2 buckets con carta) ===");
for (const f of filas) {
  const buckets = [f.common, f.uncommon, f.rare, f.epic, f.legendary].filter((n) => n > 0).length;
  if (f.jugadores >= 5 && buckets >= 2) {
    console.log(`  ${f.team.padEnd(22)} ${f.jugadores} jug · ${f.cartas} cartas · ${buckets} buckets`);
  }
}

console.log("\n=== LOS CUATRO QUE PIDE EL BRIEF ===");
for (const busca of ["Heretics", "Fnatic", "G2", "NAVI", "Natus"]) {
  const hit = filas.filter((f) => f.team.toLowerCase().includes(busca.toLowerCase()));
  if (hit.length === 0) console.log(`  ${busca}: NO EXISTE en el catálogo`);
  else for (const h of hit) console.log(`  ${busca} → «${h.team}»: ${h.jugadores} jug · ${h.cartas} cartas · com ${h.common} unc ${h.uncommon} rar ${h.rare} epi ${h.epic} leg ${h.legendary}`);
}
