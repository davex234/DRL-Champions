/**
 * POST-REEMPLAZO · AUDITORÍA DE EQUIPOS Y RIVALES (instrumento `_`, fuera de CI, SOLO LECTURA).
 *   npx tsx scripts/_postreplace-audit.ts
 */
import { CARDS, getPlayer } from "../src/data/catalog";
import { CardRegistry } from "../src/collection/registry";
import { TEAM_IDENTITIES, resolveTeamIdentity, currentTeamIdentity } from "../src/data/teamIdentities";
import { buildOpponentPlan } from "../src/domain/campaign/opponent";

const reg = new CardRegistry();
const teams = new Map<string, { players: Set<string>; cards: number; region: string }>();
for (const c of CARDS) {
  const p = getPlayer(c.playerId)!;
  const t = teams.get(p.team) ?? { players: new Set(), cards: 0, region: p.region };
  t.players.add(p.id); t.cards++; teams.set(p.team, t);
}
console.log("== Player.team en el catálogo (jugadores/cartas · región · identidad resuelta · actual)");
for (const [name, t] of [...teams].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`${JSON.stringify(name).padEnd(20)} ${String(t.players.size).padStart(2)}/${String(t.cards).padStart(2)} ${t.region.padEnd(9)} ${resolveTeamIdentity(name)?.canonicalId ?? "-"} ${currentTeamIdentity(name)?.canonicalId ?? "-"}`);
}
console.log("\n== Rival por identidad (núcleo/10 por escalón)");
for (const id of TEAM_IDENTITIES) {
  const r = (["BASE", "MID", "TOP"] as const).map((tier) => { const p = buildOpponentPlan(reg as never, id.canonicalId, tier); return p.ok ? `${p.coreCount}` : p.reason; });
  console.log(`${id.canonicalId.padEnd(14)} ${id.status.padEnd(10)} ${id.region.padEnd(9)} ${r.join(" / ")}`);
}

// ── Team Packs: cartas por identificador, bloqueos derivados, pertenencia cruda vs roster actual ──
import { TEAM_PACK_AUDIT, cardsForTeamValue, derivedBlockers, deriveStatus, rosterDiscrepancies } from "../src/data/teamPackCatalog";
import { PACKS } from "../src/data/packs";
import { PLAYERS } from "../src/data/players";
console.log("\n== Auditoría Team Packs (declarado → derivado)");
for (const e of TEAM_PACK_AUDIT) {
  const exists = PACKS.some((p) => p.id === e.packId);
  const d = derivedBlockers(e);
  const per = e.identifiers.map((i) => `${i}:${cardsForTeamValue(i)}`).join(",");
  console.log(`${e.requested.padEnd(18)} ${per.padEnd(26)} decl=${e.status}[${e.blockers.join(",")}] deriv=${deriveStatus(d, exists)}[${d.join(",")}]`);
}
console.log("\n== Discrepancias semilla↔VLR con cartas");
for (const x of rosterDiscrepancies()) console.log(`${x.playerId} catálogo=${x.catalogTeam} vlr=${x.vlrTeam} cartas=${x.cards}`);
console.log("\n== Jugadores con cartas por valor de team de los Team Packs vivos");
for (const t of ["Team Heretics", "TH", "Fnatic", "FNC", "NAVI", "G2"]) {
  const ids = PLAYERS.filter((p) => p.team === t).map((p) => p.id).filter((id) => CARDS.some((c) => c.playerId === id));
  console.log(t.padEnd(14), ids.join(" "));
}
