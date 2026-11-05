/**
 * COLECCIONES POR EQUIPO · auditoría de datos (solo lectura, no toca ninguna base).
 *   npx tsx scripts/_team-collections-audit.ts
 * Qué equipos del registro (el que lee /admin/teams) tienen cartas, cuántas, de qué región, cuáles no tienen logo,
 * qué cartas no resuelven a un equipo y qué cartas no pueden salir hoy de ningún sobre.
 */
import { CARDS, getPlayer } from "@/data/catalog";
import { TEAM_IDENTITIES, canonicalCardTeam } from "@/data/teamIdentities";
import { hintTeamLogoSrc } from "@/data/teamLogos";
import { liveObtainable } from "@/domain/collectionSets/generator";

const byTeam = new Map<string, typeof CARDS>();
for (const c of CARDS) {
  const k = canonicalCardTeam(c, getPlayer(c.playerId)).key;
  byTeam.set(k, [...(byTeam.get(k) ?? []), c]);
}
const rows = TEAM_IDENTITIES.map((t) => {
  const cs = byTeam.get(t.canonicalId) ?? [];
  const players = new Set(cs.map((c) => c.playerId));
  const multi = [...players].filter((p) => cs.filter((c) => c.playerId === p).length > 1).length;
  return { id: t.canonicalId, name: t.displayName, region: t.region ?? null, status: t.status, cards: cs.length, players: players.size, multi, logo: !!hintTeamLogoSrc(t.canonicalId), noObt: cs.filter((c) => !liveObtainable(c)).length, variants: [...new Set(cs.map((c) => c.variantId))].join(",") };
});
console.log(`catálogo: ${CARDS.length} cartas · registro: ${TEAM_IDENTITIES.length} equipos`);
console.table(rows.filter((r) => r.cards > 0).sort((a, b) => String(a.region).localeCompare(String(b.region)) || a.name.localeCompare(b.name)));
console.log("equipos del registro SIN cartas:", rows.filter((r) => r.cards === 0).map((r) => `${r.name} (${r.region})`).join(", ") || "ninguno");
console.log("cartas sin equipo del registro:", [...byTeam.keys()].filter((k) => k.startsWith("raw:")).map((k) => `${k} ×${byTeam.get(k)!.length}`).join(", ") || "ninguna");
const reg: Record<string, { teams: number; cards: number }> = {};
for (const r of rows.filter((x) => x.cards > 0)) { const g = (reg[String(r.region)] ??= { teams: 0, cards: 0 }); g.teams++; g.cards += r.cards; }
console.log("por región:", JSON.stringify(reg));
console.log("total en equipos:", rows.reduce((a, r) => a + r.cards, 0), "· no obtenibles:", rows.reduce((a, r) => a + r.noObt, 0));
