/**
 * INSTRUMENTO — AUDITORÍA DE CANDIDATOS A TEAM PACK (Fase 20.5A). Solo lectura, fuera de CI.
 *
 *   npx tsx scripts/_fase20-5a-audit.ts
 *
 * Cruza tres capas ya testeadas — `teamPackCatalog` (20.2), `teamIdentities` (20.3) y el motor de
 * pools (`buildPool`) — para producir, por candidato, todo lo que la fase pide. No escribe nada,
 * no toca la BD (la confirmación de PUBLISHED / content_players / boost se hace aparte por SSH).
 */
import { TEAM_PACK_AUDIT, proposedTeamPack, cardsForTeamValue } from "../src/data/teamPackCatalog";
import {
  resolveTeamIdentity, currentTeamIdentity, historicalTeamContext, type TeamIdentity,
} from "../src/data/teamIdentities";
import { PLAYERS } from "../src/data/players";
import { getPack, PACKS } from "../src/data/packs";
import { PACK_ART_AVAILABLE } from "../src/data/packArtwork";
import { CardRegistry } from "../src/collection/registry";
import { buildPool } from "../src/domain/packs/pool";
import { bucketForRank } from "../src/domain/packs/types";
import { getVariant } from "../src/domain/cards/variants";
import VLR from "../src/data/vlr/players-vct-2026.json";

const registry = new CardRegistry();
const vlrByNick = new Map((VLR as { nick: string; team: string }[]).map((r) => [r.nick.trim().toLowerCase(), r.team]));

/** ¿El jugador está HOY en esta identidad, por VLR 2026? (undefined si VLR no lo tiene) */
function playerCurrentMatches(playerId: string, identity: TeamIdentity): boolean | undefined {
  const p = PLAYERS.find((x) => x.id === playerId);
  if (!p) return undefined;
  const vlrTeam = vlrByNick.get(p.nick.trim().toLowerCase());
  if (vlrTeam === undefined) return undefined;
  const norm = (s: string) => s.trim().toLowerCase();
  return identity.currentAliases.some((a) => norm(a) === norm(vlrTeam)) || norm(vlrTeam) === norm(p.team) && identity.currentAliases.map(norm).includes(norm(p.team));
}

console.log("\n═══ FASE 20.5A · AUDITORÍA DE CANDIDATOS A TEAM PACK ═══\n");
console.log(`  catálogo de código: ${registry.cards.length} cartas · ${PLAYERS.length} jugadores · sobres de equipo vivos: ${PACKS.filter((p) => p.team).length}\n`);

const header = "equipo|región|identity|status|elegibles|hist.NO|pack|pool|boost|boost✓actual|ambiguo|conflicto|DRAFT|bloqueo";
console.log(header);
console.log("-".repeat(header.length + 40));

const rows: Record<string, string>[] = [];

for (const e of TEAM_PACK_AUDIT) {
  const identity = resolveTeamIdentity(e.canonical) ?? resolveTeamIdentity(e.identifiers[0]);
  const packTeam = e.packTeam;
  const pack = getPack(e.packId);
  const proposed = pack ?? (packTeam ? proposedTeamPack(e) : null);

  // Cartas elegibles del equipo en SU sobre (buildPool), y de ellas cuáles son "históricas"
  // (jugador cuya identidad ACTUAL, por VLR 2026, no es esta) — las que NO deberían entrar.
  let eligibles = 0, historicalNotToEnter = 0, buckets: Record<string, number> = {};
  const histPlayers: string[] = [];
  if (proposed && packTeam) {
    const flat = buildPool(registry, proposed).flat;
    const suyas = flat.filter((c) => registry.player(c.playerId)?.team === packTeam);
    eligibles = suyas.length;
    for (const c of suyas) {
      const b = bucketForRank(getVariant(c.variantId).rank);
      buckets[b] = (buckets[b] ?? 0) + 1;
      // "Histórica que no debe entrar": el jugador figura en OTRO equipo en VLR 2026.
      const p = registry.player(c.playerId);
      const vlrTeam = p ? vlrByNick.get(p.nick.trim().toLowerCase()) : undefined;
      if (identity && vlrTeam !== undefined) {
        const norm = (s: string) => s.trim().toLowerCase();
        const isCurrent = identity.currentAliases.some((a) => norm(a) === norm(vlrTeam));
        if (!isCurrent) { historicalNotToEnter++; if (!histPlayers.includes(c.playerId)) histPlayers.push(c.playerId); }
      }
    }
  }

  const hasPack = !!pack;
  const hasBoost = ["team-heretics", "team-fnatic", "team-g2", "team-navi"].includes(e.packId); // boosts vivos (Fase 20)
  // ¿El boost apunta a identidad ACTUAL? Sí solo si NINGUNA carta elegible es de un jugador que
  // hoy juega en otro equipo. (El boost vivo sesga el string semilla, no la identidad actual.)
  const boostPointsCurrent = hasBoost ? (historicalNotToEnter === 0) : null;

  const ambiguous = identity ? (identity.currentAliases.length > 0 && identity.historicalAliases.length > 0) : e.identifiers.filter((i) => cardsForTeamValue(i) > 0).length >= 2;
  const conflict = historicalNotToEnter > 0 || e.blockers.includes("LEGACY_ROSTER");

  // Puede DRAFT: identidad resoluble + packTeam decidible + cartas elegibles > 0 + no bloqueada por
  // identidad no probada/dividida. Un DRAFT no es público, pero su pool debe poder construirse bien.
  const canDraft = !!identity && !!packTeam && eligibles > 0 && e.status !== "BLOCKED";

  const blocker =
    hasPack ? (boostPointsCurrent === false ? "boost sesga plantilla editorial, no actual" : "ninguno (vivo)")
    : e.status === "BLOCKED" ? `identidad (${e.blockers.filter((b) => ["IDENTITY_SPLIT", "LEGACY_ROSTER", "IDENTITY_UNPROVEN"].includes(b)).join("+")})`
    : "artwork + boost + precio";

  const detalle = Object.entries(buckets).map(([k, n]) => `${k[0]}${n}`).join("");
  rows.push({
    equipo: e.requested, region: e.region, identity: identity?.canonicalId ?? "—", status: e.status,
    elegibles: `${eligibles}${detalle ? `(${detalle})` : ""}`,
    hist: historicalNotToEnter ? `${historicalNotToEnter} [${histPlayers.join(",")}]` : "0",
    pack: hasPack ? "sí" : "no", pool: hasPack ? "sí" : "no", boost: hasBoost ? "sí" : "no",
    boostOk: boostPointsCurrent === null ? "—" : boostPointsCurrent ? "sí" : "NO",
    ambiguo: ambiguous ? "sí" : "no", conflicto: conflict ? "sí" : "no",
    draft: canDraft ? "sí" : "no", blocker,
  });

  console.log(
    `${e.requested.padEnd(18)}|${e.region.padEnd(8)}|${(identity?.canonicalId ?? "—").padEnd(13)}|${e.status.padEnd(8)}|`
    + `${(`${eligibles}${detalle ? `(${detalle})` : ""}`).padEnd(14)}|${String(historicalNotToEnter).padEnd(6)}|`
    + `${hasPack ? "sí" : "no"}|${hasPack ? "sí" : "no"}|${hasBoost ? "sí" : "no"}|`
    + `${(boostPointsCurrent === null ? "—" : boostPointsCurrent ? "sí" : "NO").padEnd(10)}|`
    + `${ambiguous ? "sí" : "no"}|${conflict ? "sí" : "no"}|${canDraft ? "sí" : "no"}|${blocker}`,
  );
}

// ── Resúmenes ──
const READY_DRAFT = rows.filter((r) => r.pack === "no" && r.draft === "sí").map((r) => r.equipo);
const NEED_IDENTITY = rows.filter((r) => r.pack === "no" && r.status === "BLOCKED").map((r) => r.equipo);
const EXISTING = rows.filter((r) => r.pack === "sí").map((r) => `${r.equipo}${r.boostOk === "NO" ? " (boost editorial)" : ""}`);

console.log("\nA · READY para DRAFT:", READY_DRAFT.join(", ") || "—");
console.log("B · Necesitan resolver identidad:", NEED_IDENTITY.join(", ") || "—");
console.log("D · Ya existen (pack vivo):", EXISTING.join(", ") || "—");
console.log(`\n  READY-DRAFT ${READY_DRAFT.length} · BLOCKED-identidad ${NEED_IDENTITY.length} · vivos ${EXISTING.length}`);
console.log(`  artwork disponible para: ${[...PACK_ART_AVAILABLE].filter((id) => id.startsWith("team-")).join(", ")}\n`);
