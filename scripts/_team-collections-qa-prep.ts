/**
 * COLECCIONES POR EQUIPO · prepara la QA del stack aislado (no toca ninguna base: solo escribe dos ficheros).
 *
 *   npx tsx scripts/_team-collections-qa-prep.ts <carpeta de salida>
 *     → tc-seed.sql     inventarios de cuatro cuentas SINTÉTICAS (`coll-tc*@example.invalid`), para la base de QA
 *     → tc-expect.json  lo que el servidor debe responder para cada una, calculado aquí con el dominio
 *
 * Cuentas:
 *   tcempty   sin cartas
 *   tcfive    una carta de cada jugador de G2 (×4 copias cada una: con el criterio antiguo, «completo»), NAVI entero,
 *             15 de NRG y 3 de XLG
 *   tcchina   todas las cartas de los equipos de China + todo EMEA menos UNA carta
 *   tcall     el catálogo entero
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS, getPlayer } from "@/data/catalog";
import { buildTeamCollections, teamCollectionsView } from "@/domain/teamCollections/model";

const OUT = process.argv[2] ?? "logs/team-collections";
mkdirSync(OUT, { recursive: true });
const m = buildTeamCollections({ cards: CARDS, player: getPlayer });
const team = (id: string) => m.teams.find((t) => t.id === id)!;
const all = (pick: (t: (typeof m.teams)[number]) => boolean) => m.teams.filter(pick).flatMap((t) => t.cards.map((c) => c.id));
function onePerPlayer(id: string): string[] {
  const seen = new Set<string>();
  return team(id).cards.filter((c) => !seen.has(c.playerId) && !!seen.add(c.playerId)).map((c) => c.id);
}
const emea = all((t) => t.region === "EMEA");
const five = onePerPlayer("g2");
const ACCOUNTS: Record<string, string[]> = {
  tcempty: [],
  tcfive: [...five, ...five, ...five, ...five, ...all((t) => t.id === "navi"), ...team("nrg").cards.slice(0, 15).map((c) => c.id), ...team("xlg").cards.slice(0, 3).map((c) => c.id)],
  tcchina: [...all((t) => t.region === "China"), ...emea.slice(1)],
  tcall: CARDS.map((c) => c.id),
};

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sql: string[] = ["begin;"];
const expect: Record<string, unknown> = {};
for (const [label, ids] of Object.entries(ACCOUNTS)) {
  const email = `coll-${label}@example.invalid`;
  sql.push(`delete from public.user_cards where user_id = (select id from auth.users where email = ${q(email)});`);
  if (ids.length) sql.push(`insert into public.user_cards (user_id, card_id, serial, origin, locked, obtained_at) select u.id, c, null, 'pack', false, now() from (select id from auth.users where email = ${q(email)}) u, unnest(array[${ids.map(q).join(",")}]::text[]) c;`);
  const counts: Record<string, number> = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  expect[label] = { copies: ids.length, distinct: Object.keys(counts).length, view: teamCollectionsView(m, new Set(ids)) };
}
sql.push("commit;");
writeFileSync(join(OUT, "tc-seed.sql"), sql.join("\n") + "\n", "utf8");
writeFileSync(join(OUT, "tc-expect.json"), JSON.stringify({ catalog: CARDS.length, teams: m.teams.length, g2: { total: team("g2").cards.length, five: five.length, copiesEach: 4 }, missingEmea: emea[0], accounts: expect }), "utf8");
console.log(`cuentas ${Object.keys(ACCOUNTS).join(", ")} · ${m.teams.length} equipos · ${CARDS.length} cartas → ${OUT}`);
