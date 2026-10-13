/**
 * COLECCIONES POR EQUIPO · prepara la QA del stack aislado (no toca ninguna base: solo escribe dos ficheros).
 *
 *   npx tsx scripts/_team-collections-qa-prep.ts <carpeta de salida>
 *     → tc-seed.sql     inventarios de cuatro cuentas SINTÉTICAS (`coll-tc*@example.invalid`), para la base de QA
 *     → tc-expect.json  lo que el servidor debe responder para cada una, calculado aquí con el dominio
 *     → tc-0075-vars.sql  planes de liquidación y temporada de QA para el ensayo de la migración 0075
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
import { t2Draft } from "@/domain/seasonTrack/template";

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
// Ensayo de 0075 contra Postgres: los planes que el servidor le pasaría a `app_team_collections_settle`, como variables de psql,
// y una temporada SOLO de QA (publicada y activa) para poder cobrar XP en una base que no tiene ninguna.
const teamPlan = (ids: string[]) => JSON.stringify(m.teams.filter((t) => ids.includes(t.id)).map((t) => ({ id: t.id, cards: t.cards.map((c) => c.id) })));
const regionPlan = (regions: string[]) => JSON.stringify(regions.map((region) => { const mine = m.teams.filter((t) => t.region === region); return { region, teams: mine.length, cards: mine.flatMap((t) => t.cards.map((c) => c.id)) }; }));
const firstChina = m.teams.find((t) => t.region === "China")!.id;
const season = t2Draft();
const vars: Record<string, string> = {
  plan_navi: teamPlan(["navi"]), plan_g2: teamPlan(["g2"]), plan_all_teams: teamPlan(m.teams.map((t) => t.id)), plan_china_team: teamPlan([firstChina]),
  plan_all_regions: regionPlan(["Americas", "EMEA", "Pacific", "China"]), plan_china: regionPlan(["China"]), plan_emea: regionPlan(["EMEA"]),
  china_cards: JSON.stringify(m.teams.filter((t) => t.region === "China").flatMap((t) => t.cards.map((c) => c.id))),
  season_config: JSON.stringify(season.config), season_levels: String(season.maxLevel),
  n_teams: String(m.teams.length), n_china_teams: String(m.teams.filter((t) => t.region === "China").length),
};
const NL = String.fromCharCode(10), BS = String.fromCharCode(92);
writeFileSync(join(OUT, "tc-0075-vars.sql"), Object.entries(vars).map(([k, v]) => `${BS}set ${k} ${q(v)}`).join(NL) + NL, "utf8");
console.log(`cuentas ${Object.keys(ACCOUNTS).join(", ")} · ${m.teams.length} equipos · ${CARDS.length} cartas → ${OUT}`);
