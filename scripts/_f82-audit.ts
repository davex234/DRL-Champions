/**
 * F82 · AUDITORÍA DEL CATÁLOGO REAL PARA COLLECTION SETS (instrumento, fuera de CI, solo lectura).
 *
 *   npx tsx scripts/_f82-audit.ts            → imprime JSON con equipos, ediciones y saltos
 *
 * Mide sobre el catálogo del código (las 331 cartas del manifiesto, iguales a `content_cards`): jugadores con carta,
 * equipo IMPRESO de cada carta, logos reales, obtenibilidad por sobre ACTIVO. No escribe nada.
 */
import { CARDS, getPlayer } from "../src/data/catalog";
import { PACKS } from "../src/data/packs";
import { CardRegistry } from "../src/collection/registry";
import { packsThatCanContain } from "../src/domain/collection/room";
import { canonicalCardTeam, TEAM_IDENTITIES } from "../src/data/teamIdentities";
import { hintTeamLogoSrc } from "../src/data/teamLogos";
import { packCardClass } from "../src/domain/packs/packClass";
import { generateTeamDrafts, generateEditionDrafts } from "../src/domain/collectionSets/generator";

const reg = new CardRegistry();
const obtainable = (id: string) => {
  const c = CARDS.find((x) => x.id === id)!;
  return packsThatCanContain(reg, PACKS, c).length > 0 && packCardClass(c) !== null;
};

const teams = new Map<string, { label: string; players: Map<string, string[]>; cards: number }>();
for (const c of CARDS) {
  const t = canonicalCardTeam(c, getPlayer(c.playerId));
  const e = teams.get(t.key) ?? { label: t.label, players: new Map(), cards: 0 };
  e.cards++;
  e.players.set(c.playerId, [...(e.players.get(c.playerId) ?? []), c.id]);
  teams.set(t.key, e);
}
const multiTeamPlayers = new Map<string, Set<string>>();
for (const c of CARDS) {
  const k = canonicalCardTeam(c, getPlayer(c.playerId)).key;
  multiTeamPlayers.set(c.playerId, (multiTeamPlayers.get(c.playerId) ?? new Set()).add(k));
}

const rows = [...teams.entries()].map(([key, e]) => ({
  key, label: e.label, cards: e.cards, players: e.players.size,
  logo: !!hintTeamLogoSrc(key),
  identity: TEAM_IDENTITIES.find((i) => i.canonicalId === key)?.status ?? "none",
  unobtainablePlayers: [...e.players.entries()].filter(([, ids]) => !ids.some(obtainable)).map(([p]) => p),
})).sort((a, b) => a.label.localeCompare(b.label));

const out = {
  cards: CARDS.length,
  playersWithCards: new Set(CARDS.map((c) => c.playerId)).size,
  unobtainableCards: CARDS.filter((c) => !obtainable(c.id)).map((c) => c.id),
  playersOnSeveralPrintedTeams: [...multiTeamPlayers.entries()].filter(([, s]) => s.size > 1).map(([p, s]) => `${p}:${[...s].join("/")}`),
  printedTeams: rows.length,
  teamsWithLogo: rows.filter((r) => r.logo).length,
  teams: rows,
  teamDrafts: generateTeamDrafts().map((d) => ("skip" in d ? { team: d.subjectId, skip: d.skip } : { team: d.subjectId, id: d.id, players: d.requirements.length })),
  editionDrafts: generateEditionDrafts().map((d) => ("skip" in d ? { edition: d.subjectId, skip: d.skip } : { edition: d.subjectId, id: d.id, cards: d.requirements.length })),
};
console.log(JSON.stringify(out, null, 1));
