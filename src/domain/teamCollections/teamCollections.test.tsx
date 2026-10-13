/**
 * COLECCIONES POR EQUIPO E INSIGNIAS REGIONALES — dominio, servidor y pantalla.
 *
 * Los doce casos del encargo, sobre el catálogo real y sobre catálogos de prueba (para lo que el real no trae: un
 * equipo recién dado de alta, una región vacía, un equipo sin región).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CARDS, getPlayer } from "@/data/catalog";
import { TEAM_IDENTITIES, canonicalCardTeam } from "@/data/teamIdentities";
import type { CardDef } from "@/domain/cards/types";
import {
  BADGE_REGIONS, FIRST_TEAMS, MORE_TEAMS, buildTeamCollections, legacySetTeamId, regionBadges, sortTeams, teamCollectionsView,
  teamDetail, teamProgress, teamState, teamTile, visibleTeamCount, type TeamCollectionsModel,
} from "./model";
import { visibleTeams } from "@/components/trophies/teamCollectionsModel";
import { TrophyRoomScreen } from "@/components/trophies/TrophyRoomScreen";
import { TeamDetailScreen } from "@/components/trophies/TeamDetailScreen";
import { MemorySupabase } from "@/server/services/testing/memorySupabase";
import { getTeamCollection, getTeamCollections, TEAM_ID_PATTERN } from "@/server/services/teamCollections";
import { resetServerCatalog } from "@/server/catalog";
import type { SupabaseClient } from "@supabase/supabase-js";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const live = (): TeamCollectionsModel => buildTeamCollections({ cards: CARDS, player: getPlayer });
const team = (m: TeamCollectionsModel, id: string) => m.teams.find((t) => t.id === id)!;
const idsOf = (m: TeamCollectionsModel, pick: (t: TeamCollectionsModel["teams"][number]) => boolean) => m.teams.filter(pick).flatMap((t) => t.cards.map((c) => c.id));
function onePerPlayer(m: TeamCollectionsModel, id: string): string[] {
  const seen = new Set<string>();
  return team(m, id).cards.filter((c) => !seen.has(c.playerId) && !!seen.add(c.playerId)).map((c) => c.id);
}

// ───────────────────────────── El modelo sale del catálogo ─────────────────────────────

test("MODELO · cada carta del catálogo está en exactamente una colección, la de su equipo impreso", () => {
  const m = live();
  const all = m.teams.flatMap((t) => t.cards.map((c) => c.id));
  assert.equal(all.length, CARDS.length);
  assert.equal(new Set(all).size, CARDS.length);
  assert.deepEqual(m.teamless, []);
  for (const t of m.teams) for (const c of t.cards) assert.equal(canonicalCardTeam(CARDS.find((x) => x.id === c.id)!, getPlayer(c.playerId)).key, t.id);
});

test("MODELO · sin cantidades fijas: el total de un equipo es el número de sus cartas en el catálogo", () => {
  const m = live();
  const sizes = new Set(m.teams.map((t) => t.cards.length));
  assert.ok(sizes.size > 3, "equipos de tamaños distintos");
  assert.ok(m.teams.some((t) => t.cards.length > 5), "hay equipos con más de cinco cartas");
  const src = read("src/domain/teamCollections/model.ts") + read("src/server/services/teamCollections.ts");
  assert.ok(!/TEAM_IDENTITIES|"g2"|"fnatic"|Heretics/.test(src), "ninguna lista de equipos escrita en el modelo ni en el servicio");
});

test("MODELO · la región sale de la identidad del equipo y todos los equipos del catálogo la tienen", () => {
  const m = live();
  assert.deepEqual(m.unassigned, []);
  for (const t of m.teams) assert.equal(t.region, TEAM_IDENTITIES.find((i) => i.canonicalId === t.id)!.region);
  for (const r of BADGE_REGIONS) assert.ok(m.teams.some((t) => t.region === r), `${r} tiene equipos`);
});

// ───────────────────────────── 1 · 2 · 3 ─────────────────────────────

test("1 · un equipo con una carta de cada jugador (el criterio antiguo) NO está completo si le quedan cartas", () => {
  const m = live();
  const g2 = team(m, "g2");
  const five = onePerPlayer(m, "g2");
  assert.equal(five.length, 5);
  assert.ok(g2.cards.length > 5);
  const p = teamProgress(g2, new Set(five));
  assert.deepEqual([p.owned, p.total, p.complete], [5, g2.cards.length, false]);
  assert.equal(teamState(p), "IN_PROGRESS");
  assert.ok(p.pct < 100);
});

test("2 · un jugador con varias ediciones: cada una es un requisito y se cuenta por separado", () => {
  const m = live();
  const g2 = team(m, "g2");
  const byPlayer = new Map<string, string[]>();
  for (const c of g2.cards) byPlayer.set(c.playerId, [...(byPlayer.get(c.playerId) ?? []), c.id]);
  const [player, editions] = [...byPlayer.entries()].find(([, ids]) => ids.length >= 3)!;
  assert.ok(player);
  // Todo el equipo menos UNA edición de ese jugador: falta exactamente una carta.
  const all = g2.cards.map((c) => c.id);
  const p = teamProgress(g2, new Set(all.filter((id) => id !== editions[1])));
  assert.deepEqual([p.missing, p.complete, p.pct], [1, false, Math.min(99, Math.floor(((all.length - 1) / all.length) * 100))]);
  assert.equal(teamProgress(g2, new Set(all)).complete, true);
  assert.equal(new Set(editions.map((id) => g2.cards.find((c) => c.id === id)!.variantId)).size, editions.length, "son ediciones distintas");
});

test("3 · las copias repetidas no completan ediciones distintas", () => {
  const m = live();
  const g2 = team(m, "g2");
  const counts: Record<string, number> = {};
  for (const id of onePerPlayer(m, "g2")) counts[id] = 40;
  const d = teamDetail(g2, counts);
  assert.equal(d.owned, 5);
  assert.equal(d.complete, false);
  assert.equal(d.cards.filter((c) => c.owned).every((c) => c.copies === 40), true);
  assert.equal(d.cards.filter((c) => !c.owned).every((c) => c.copies === 0), true);
  assert.equal(d.missing, g2.cards.length - 5);
});

// ───────────────────────────── 4 ─────────────────────────────

test("4 · un equipo dado de alta con sus cartas aparece solo, y una carta nueva mueve la meta", () => {
  const before = live();
  const extra: CardDef[] = CARDS.slice(0, 4).map((c, i) => ({ ...c, id: `nuevo-${i}`, team: "Equipo Nuevo" }));
  const m = buildTeamCollections({ cards: [...CARDS, ...extra], player: getPlayer });
  assert.equal(m.teams.length, before.teams.length + 1);
  const nuevo = m.teams.find((t) => t.title === "Equipo Nuevo")!;
  assert.deepEqual([nuevo.cards.length, nuevo.region, nuevo.logo, nuevo.id], [4, null, null, "raw:Equipo Nuevo"]);
  // Sin región en los datos: se detecta y no se adjudica a ninguna.
  assert.deepEqual(m.unassigned, [{ id: "raw:Equipo Nuevo", title: "Equipo Nuevo", cards: 4 }]);
  assert.deepEqual(regionBadges(m.teams, new Set()).map((r) => r.total), regionBadges(before.teams, new Set()).map((r) => r.total));
  // Una carta más de un equipo existente: su total sube y quien lo tenía completo deja de tenerlo.
  const kc = team(before, "karmine-corp");
  const owned = new Set(kc.cards.map((c) => c.id));
  assert.equal(teamProgress(kc, owned).complete, true);
  const source = CARDS.find((c) => c.id === kc.cards[0].id)!;
  const grown = buildTeamCollections({ cards: [...CARDS, { ...source, id: "kc-nueva" }], player: getPlayer });
  assert.deepEqual([team(grown, "karmine-corp").cards.length, teamProgress(team(grown, "karmine-corp"), owned).complete], [kc.cards.length + 1, false]);
});

test("4 · una carta sin equipo no forma colección y se avisa", () => {
  const m = buildTeamCollections({ cards: [{ ...CARDS[0], id: "huerfana", team: "" }], player: () => undefined });
  assert.deepEqual([m.teams.length, m.teamless], [0, ["huerfana"]]);
});

// ───────────────────────────── 5 · 6 · 7 ─────────────────────────────

test("5 · 6 · 7 · tres equipos al entrar, seis más por pulsación, y acaban saliendo todos", () => {
  assert.deepEqual([FIRST_TEAMS, MORE_TEAMS], [3, 6]);
  const total = live().teams.length;
  const steps: number[] = [];
  for (let clicks = 0; ; clicks++) { steps.push(visibleTeamCount(total, clicks)); if (steps[steps.length - 1] === total) break; }
  assert.equal(steps[0], 3);
  for (let i = 1; i < steps.length - 1; i++) assert.equal(steps[i] - steps[i - 1], 6);
  assert.ok(steps[steps.length - 1] - steps[steps.length - 2] <= 6);
  assert.equal(steps[steps.length - 1], total);
  assert.equal(visibleTeamCount(total, 999), total);
  assert.deepEqual([visibleTeamCount(0, 0), visibleTeamCount(2, 0), visibleTeamCount(3, 0), visibleTeamCount(4, 0), visibleTeamCount(4, 1)], [0, 2, 3, 3, 4]);
});

test("5 · la pantalla pinta 3 tarjetas al entrar, con el botón «Ver más equipos» y el recuento", () => {
  const m = live();
  const h = renderToStaticMarkup(<TrophyRoomScreen room={teamCollectionsView(m, new Set(onePerPlayer(m, "g2")))} />);
  assert.equal((h.match(/data-testid="set-tile"/g) ?? []).length, 3);
  assert.match(h, /data-testid="more-teams"[^>]*>Ver más equipos</);
  assert.match(h, new RegExp(`data-testid="teams-count">3 de ${m.teams.length}<`));
  // Lo que llevas empezado sale delante.
  assert.match(h, /data-testid="set-tile" data-set="g2" data-state="IN_PROGRESS"/);
  assert.match(h, new RegExp(`>5/${team(m, "g2").cards.length}<`));
});

test("7 · con tres equipos o menos no hay botón", () => {
  const few = buildTeamCollections({ cards: CARDS.filter((c) => ["g2", "fnatic", "t1"].includes(canonicalCardTeam(c, getPlayer(c.playerId)).key)), player: getPlayer });
  const h = renderToStaticMarkup(<TrophyRoomScreen room={teamCollectionsView(few, new Set())} />);
  assert.equal((h.match(/data-testid="set-tile"/g) ?? []).length, 3);
  assert.ok(!h.includes('data-testid="more-teams"'));
});

test("REJILLA · orden y filtros sobre la vista del servidor", () => {
  const m = live();
  const owned = new Set([...idsOf(m, (t) => t.id === "navi"), ...onePerPlayer(m, "g2"), ...team(m, "nrg").cards.slice(0, 15).map((c) => c.id)]);
  const tiles = m.teams.map((t) => teamTile(t, owned));
  const sorted = sortTeams(tiles);
  assert.deepEqual(sorted.slice(0, 2).map((t) => t.id), ["nrg", "g2"], "empezados delante, primero al que menos le falta");
  assert.equal(sorted[sorted.length - 1].id, "navi", "lo completado al final");
  assert.deepEqual(visibleTeams(tiles, { filter: "COMPLETED", query: "", sort: "closest" }).map((t) => t.id), ["navi"]);
  assert.deepEqual(visibleTeams(tiles, { filter: "IN_PROGRESS", query: "", sort: "alpha" }).map((t) => t.id), ["g2", "nrg"]);
  assert.equal(visibleTeams(tiles, { filter: "LOCKED", query: "", sort: "alpha" }).length, tiles.length - 3);
  assert.deepEqual(visibleTeams(tiles, { filter: "ALL", query: "heret", sort: "alpha" }).map((t) => t.id), ["team-heretics"]);
  const nick = team(m, "paper-rex").cards[0].nick;
  assert.ok(visibleTeams(tiles, { filter: "ALL", query: nick, sort: "alpha" }).some((t) => t.id === "paper-rex"), "se busca también por jugador");
});

// ───────────────────────────── 8 · 9 · 10 ─────────────────────────────

test("8 · insignia regional incompleta: bloqueada aunque falte una sola carta", () => {
  const m = live();
  const china = idsOf(m, (t) => t.region === "China");
  const b = regionBadges(m.teams, new Set(china.slice(1))).find((r) => r.region === "China")!;
  assert.deepEqual([b.unlocked, b.missing, b.owned, b.total, b.pct < 100], [false, 1, china.length - 1, china.length, true]);
  // Todos los equipos menos uno completos: sigue bloqueada.
  assert.equal(b.teamsCompleted, b.teams - 1);
  assert.equal(regionBadges(m.teams, new Set()).every((r) => !r.unlocked && r.owned === 0), true);
});

test("9 · insignia regional completa: desbloqueada, y solo la suya", () => {
  const m = live();
  const badges = regionBadges(m.teams, new Set(idsOf(m, (t) => t.region === "China")));
  assert.deepEqual(badges.map((r) => [r.region, r.unlocked]), [["Americas", false], ["EMEA", false], ["Pacific", false], ["China", true]]);
  const china = badges[3];
  assert.deepEqual([china.owned, china.total, china.pct, china.teamsCompleted], [china.total, china.total, 100, china.teams]);
});

test("10 · los cuatro grupos regionales funcionan, cada uno con sus equipos y sus cartas", () => {
  const m = live();
  assert.deepEqual(BADGE_REGIONS, ["Americas", "EMEA", "Pacific", "China"]);
  for (const region of BADGE_REGIONS) {
    const mine = m.teams.filter((t) => t.region === region);
    const ids = mine.flatMap((t) => t.cards.map((c) => c.id));
    const badges = regionBadges(m.teams, new Set(ids));
    for (const b of badges) assert.equal(b.unlocked, b.region === region, `${region} → ${b.region}`);
    const b = badges.find((x) => x.region === region)!;
    assert.deepEqual([b.teams, b.total, b.configured], [mine.length, ids.length, true]);
  }
  const all = regionBadges(m.teams, new Set(CARDS.map((c) => c.id)));
  assert.equal(all.every((b) => b.unlocked), true);
  assert.equal(all.reduce((n, b) => n + b.total, 0), CARDS.length, "las cuatro regiones cubren el catálogo entero, sin solaparse");
});

test("10 · una región sin equipos o sin cartas no concede insignia", () => {
  const sinChina = buildTeamCollections({ cards: CARDS.filter((c) => canonicalCardTeam(c, getPlayer(c.playerId)).identity?.region !== "China"), player: getPlayer });
  const b = regionBadges(sinChina.teams, new Set(CARDS.map((c) => c.id))).find((r) => r.region === "China")!;
  assert.deepEqual([b.configured, b.unlocked, b.teams, b.total, b.pct], [false, false, 0, 0, 0]);
  assert.deepEqual(regionBadges([], new Set(["x"])).map((r) => r.unlocked), [false, false, false, false]);
  const v = teamCollectionsView(sinChina, new Set(CARDS.map((c) => c.id)));
  assert.deepEqual([v.totals.badges, v.totals.badgesUnlocked], [3, 3]);
});

// ───────────────────────────── 11 · 12 y pantalla ─────────────────────────────

test("11 · el bloque antiguo de insignias ya no se pinta: ni insignias de set, ni Maestría, ni Prestigio, ni reclamos", () => {
  const m = live();
  const h = renderToStaticMarkup(<TrophyRoomScreen room={teamCollectionsView(m, new Set(CARDS.map((c) => c.id)))} />);
  assert.ok(!/badges-unlocked|badges-locked|badges-empty|recent-completions|claimable-banner|Maestría|Prestigio|Destaca hasta 3|Por desbloquear|Completadas recientemente|Reclamar/.test(h));
  const page = read("src/app/coleccion/trofeos/page.tsx");
  assert.ok(!/import[^\n]*(MasteryPanel|PrestigePanel|fetchMastery|fetchPrestige|fetchTrophyRoom)/.test(page));
  assert.match(page, /<TrophyRoomScreen room=\{room\} \/>/);
  const detail = read("src/app/coleccion/trofeos/[setId]/page.tsx");
  assert.ok(!/claimCollectionSet|CompletionMoment|saveFeaturedBadges/.test(detail));
  // Las cuatro regionales sí, y solo esas.
  assert.equal((h.match(/data-testid="region-badge"/g) ?? []).length, 4);
  assert.equal((h.match(/data-unlocked="1"/g) ?? []).length, 4);
  assert.deepEqual([...h.matchAll(/data-testid="region-badge" data-region="([^"]+)"/g)].map((x) => x[1]), ["Americas", "EMEA", "Pacific", "China"]);
});

test("PANTALLA · insignias bloqueadas y desbloqueadas se distinguen con texto, no solo con color", () => {
  const m = live();
  const h = renderToStaticMarkup(<TrophyRoomScreen room={teamCollectionsView(m, new Set(idsOf(m, (t) => t.region === "China")))} />);
  assert.equal((h.match(/data-testid="region-status">Bloqueada</g) ?? []).length, 3);
  assert.equal((h.match(/data-testid="region-status">Desbloqueada</g) ?? []).length, 1);
  const china = regionBadges(m.teams, new Set()).find((r) => r.region === "China")!;
  assert.match(h, new RegExp(`data-region="China" data-unlocked="1"[\\s\\S]*?data-testid="region-progress">${china.total}/${china.total}<`));
  assert.match(h, /data-testid="stat-badges"[\s\S]*?>1\/4</);
});

test("PANTALLA · región sin equipos: se dice, y no hay barra ni insignia concedida", () => {
  const sinChina = buildTeamCollections({ cards: CARDS.filter((c) => canonicalCardTeam(c, getPlayer(c.playerId)).identity?.region !== "China"), player: getPlayer });
  const h = renderToStaticMarkup(<TrophyRoomScreen room={teamCollectionsView(sinChina, new Set(CARDS.map((c) => c.id)))} />);
  assert.match(h, /data-region="China" data-unlocked="0" data-configured="0"[\s\S]*?data-testid="region-empty"/);
});

test("PANTALLA · detalle: todas las cartas del equipo, las que faltan delante y las copias anotadas", () => {
  const m = live();
  const g2 = team(m, "g2");
  const counts: Record<string, number> = {};
  for (const id of onePerPlayer(m, "g2")) counts[id] = 3;
  const h = renderToStaticMarkup(<TeamDetailScreen team={teamDetail(g2, counts)} />);
  assert.equal((h.match(/data-testid="requirement"/g) ?? []).length, g2.cards.length);
  assert.equal((h.match(/data-satisfied="1"/g) ?? []).length, 5);
  assert.match(h, new RegExp(`data-testid="set-progress">5/${g2.cards.length}<`));
  assert.ok(h.indexOf('data-testid="missing-list"') < h.indexOf('data-testid="have-list"'));
  assert.equal((h.match(/data-testid="copies"/g) ?? []).length, 5);
  assert.ok(!/Reclamar|claim-badge/.test(h));
  const done = renderToStaticMarkup(<TeamDetailScreen team={teamDetail(g2, Object.fromEntries(g2.cards.map((c) => [c.id, 1])))} />);
  assert.match(done, /data-state="COMPLETED"/);
  assert.ok(!done.includes('data-testid="missing-list"'));
});

test("PANTALLA · un equipo sin logo se pinta con su etiqueta, nunca con un logo inventado", () => {
  const m = live();
  const prx = team(m, "paper-rex");
  assert.equal(prx.logo, null);
  const h = renderToStaticMarkup(<TeamDetailScreen team={teamDetail(prx, {})} />);
  assert.ok(!/<img[^>]+alt="Escudo de/.test(h));
  assert.match(h, new RegExp(`>${prx.tag}</span>`));
  assert.match(renderToStaticMarkup(<TeamDetailScreen team={teamDetail(team(m, "g2"), {})} />), /<img[^>]+src="\/hints\/teams\/g2\.png"/);
});

test("ENLACES · un enlace antiguo a un set de F82 lleva al equipo", () => {
  assert.deepEqual(["team-g2-v1", "team-team-heretics-v2", "g2", "raw:Equipo Nuevo", "edition-champions-s-v1"].map(legacySetTeamId), ["g2", "team-heretics", "g2", "raw:Equipo Nuevo", "edition-champions-s-v1"]);
});

// ───────────────────────────── Servidor ─────────────────────────────

const U = "aaaaaaaa-0000-4000-8000-0000000000a1";
function db(cardIds: string[]): SupabaseClient {
  resetServerCatalog();
  const mem = new MemorySupabase();
  mem.tables.user_cards = cardIds.map((card_id, i) => ({ uid: `u${String(i).padStart(6, "0")}`, user_id: U, card_id, serial: null, minted_version: 1, obtained_at: "2026-10-01T00:00:00Z", origin: "pack", locked: false }));
  return mem as unknown as SupabaseClient;
}

test("SERVIDOR · progreso desde el inventario real: copias repetidas cuentan una vez y nada se escribe", async () => {
  const m = live();
  const five = onePerPlayer(m, "g2");
  const sb = db([...five, ...five, ...five, ...idsOf(m, (t) => t.id === "navi")]);
  // El doble crea vacía cualquier tabla que se le pregunta: lo que importa es que ninguna fila cambia ni aparece.
  const rows = () => JSON.stringify(Object.entries((sb as unknown as MemorySupabase).tables).filter(([, r]) => r.length > 0));
  const before = rows();
  const r = await getTeamCollections(sb, U);
  assert.equal(r.ok, true);
  const v = r.data!;
  assert.equal(v.teams.length, m.teams.length);
  const g2 = v.teams.find((t) => t.id === "g2")!;
  assert.deepEqual([g2.owned, g2.total, g2.state], [5, team(m, "g2").cards.length, "IN_PROGRESS"]);
  assert.equal(v.teams.find((t) => t.id === "navi")!.state, "COMPLETED");
  assert.deepEqual([v.totals.teamsCompleted, v.totals.badgesUnlocked, v.totals.cards], [1, 0, CARDS.length]);
  assert.ok(!("cards" in v.teams[0]), "la rejilla no lleva la lista de cartas");
  assert.ok(JSON.stringify(v).length < 20_000, "respuesta ligera");
  const d = await getTeamCollection(sb, U, "g2");
  assert.deepEqual([d.data!.owned, d.data!.cards.filter((c) => c.owned).every((c) => c.copies === 3)], [5, true]);
  assert.equal(rows(), before, "solo lectura");
});

test("SERVIDOR · región completa en la base → insignia desbloqueada; otra cuenta no ve nada de eso", async () => {
  const m = live();
  const sb = db(idsOf(m, (t) => t.region === "EMEA"));
  const mine = (await getTeamCollections(sb, U)).data!;
  assert.deepEqual(mine.regions.map((r) => r.unlocked), [false, true, false, false]);
  const other = (await getTeamCollections(sb, "bbbbbbbb-0000-4000-8000-0000000000b2")).data!;
  assert.deepEqual([other.totals.owned, other.regions.some((r) => r.unlocked)], [0, false]);
});

test("SERVIDOR · equipo inexistente o clave no válida", async () => {
  const sb = db([]);
  assert.deepEqual([(await getTeamCollection(sb, U, "no-existe")).status, (await getTeamCollection(sb, U, "../x")).status, (await getTeamCollection(sb, U, 7)).status, (await getTeamCollection(sb, U, "")).status], [404, 400, 400, 400]);
  for (const id of ["g2", "team-heretics", "100t", "raw:Equipo Nuevo"]) assert.ok(TEAM_ID_PATTERN.test(id), id);
});

test("SERVIDOR · la ruta es de solo lectura, exige sesión y solo acepta `team`", () => {
  const route = read("src/app/api/game/team-collections/route.ts");
  assert.ok(!/export async function (POST|PUT|PATCH|DELETE)/.test(route));
  assert.match(route, /if \(!session\) return bad\([^)]*401\)/);
  assert.match(route, /keys\.some\(\(k\) => k !== "team"\)/);
  assert.match(route, /takeRate\(session\.admin, session\.userId, "collection_read"\)/);
  const svc = read("src/server/services/teamCollections.ts");
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(svc), "el servicio no escribe ni llama a RPC propias");
  assert.match(svc, /loadCollectionSummary\(sb, userId\)/);
  assert.ok(!/readUserCards\(|from\("user_cards"\)/.test(svc), "no recorre el inventario: usa el resumen por carta");
});
