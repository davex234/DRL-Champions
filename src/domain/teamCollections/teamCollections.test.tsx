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
import { packCardClass } from "@/domain/packs/packClass";
import {
  BADGE_REGIONS, FIRST_TEAMS, MORE_TEAMS, NOTHING_PERSISTED, buildTeamCollections, legacySetTeamId, regionBadges, settlePlan, sortTeams, teamCollectionsView,
  teamDetail, teamProgress, teamResolver, teamState, teamTile, visibleTeamCount, type ManagedTeamIdentity, type TeamCollectionsModel,
} from "./model";
import { visibleTeams } from "@/components/trophies/teamCollectionsModel";
import { TrophyRoomScreen } from "@/components/trophies/TrophyRoomScreen";
import { TeamDetailScreen } from "@/components/trophies/TeamDetailScreen";
import { MemorySupabase } from "@/server/services/testing/memorySupabase";
import { getTeamCollection, getTeamCollections, TEAM_ID_PATTERN } from "@/server/services/teamCollections";
import { resetServerCatalog } from "@/server/catalog";
import { toCardRow, toPlayerRow } from "@/server/catalog/rows";
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

test("2 · la normal no sustituye a la especial ni la especial a la normal (tampoco una ICON), con copias o sin ellas", () => {
  const m = live();
  // Un jugador con su carta base y una edición especial en el mismo equipo.
  const pairs = m.teams.flatMap((t) => {
    const base = t.cards.find((c) => c.variantId === "base" && t.cards.some((x) => x.playerId === c.playerId && x.variantId !== "base"));
    return base ? [{ t, base, special: t.cards.find((x) => x.playerId === base.playerId && x.variantId !== "base")! }] : [];
  });
  assert.ok(pairs.length > 5, "el catálogo tiene jugadores con normal y especial");
  for (const { t, base, special } of pairs) {
    const all = t.cards.map((c) => c.id);
    for (const [have, lack] of [[base, special], [special, base]]) {
      const owned = new Set(all.filter((id) => id !== lack.id));
      assert.ok(owned.has(have.id));
      const p = teamProgress(t, owned);
      assert.deepEqual([p.missing, p.complete], [1, false], `${t.id}: ${have.variantId} no sustituye a ${lack.variantId}`);
    }
  }
  // La carta de clase ICON de un equipo es un requisito más: sin ella, por muchas copias del resto, no se completa.
  const iconTeam = m.teams.find((t) => t.cards.some((c) => packCardClass({ variantId: c.variantId as CardDef["variantId"], ovr: c.ovr }) === "icon"));
  if (iconTeam) {
    const icon = iconTeam.cards.find((c) => packCardClass({ variantId: c.variantId as CardDef["variantId"], ovr: c.ovr }) === "icon")!;
    const counts: Record<string, number> = {};
    for (const c of iconTeam.cards) if (c.id !== icon.id) counts[c.id] = 9;
    const d = teamDetail(iconTeam, counts);
    assert.deepEqual([d.complete, d.missing, d.cards.find((c) => c.id === icon.id)!.owned], [false, 1, false]);
  }
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

test("4 · un equipo nuevo SIN región no es una colección del jugador: queda bloqueado y listado para el panel", () => {
  const before = live();
  const extra: CardDef[] = CARDS.slice(0, 4).map((c, i) => ({ ...c, id: `nuevo-${i}`, team: "Equipo Nuevo" }));
  const m = buildTeamCollections({ cards: [...CARDS, ...extra], player: getPlayer });
  assert.equal(m.teams.length, before.teams.length, "no se enseña");
  assert.ok(!m.teams.some((t) => t.title === "Equipo Nuevo"));
  // Se detecta, con el texto impreso que hay que dar de alta, y no se adjudica a ninguna región.
  assert.deepEqual(m.unassigned, [{ id: "raw:Equipo Nuevo", title: "Equipo Nuevo", cards: 4, printed: "Equipo Nuevo" }]);
  assert.deepEqual(regionBadges(m.teams, new Set()).map((r) => r.total), regionBadges(before.teams, new Set()).map((r) => r.total));
  // Ni XP ni insignia: aunque se tengan todas sus cartas, no entra en lo que se liquida.
  const all = new Set([...CARDS, ...extra].map((c) => c.id));
  assert.ok(!settlePlan(m, all, NOTHING_PERSISTED, true).teams.some((t) => t.id.startsWith("raw:")));
  // Una carta más de un equipo existente: su total sube y quien lo tenía completo deja de tenerlo.
  const kc = team(before, "karmine-corp");
  const owned = new Set(kc.cards.map((c) => c.id));
  assert.equal(teamProgress(kc, owned).complete, true);
  const source = CARDS.find((c) => c.id === kc.cards[0].id)!;
  const grown = buildTeamCollections({ cards: [...CARDS, { ...source, id: "kc-nueva" }], player: getPlayer });
  assert.deepEqual([team(grown, "karmine-corp").cards.length, teamProgress(team(grown, "karmine-corp"), owned).complete], [kc.cards.length + 1, false]);
});

const NUEVO: ManagedTeamIdentity = { printedTeam: "Equipo Nuevo", teamId: "equipo-nuevo", name: "Equipo Nuevo", tag: "EN", region: "EMEA", rev: 1 };

test("4 · con identidad del panel (0076) el equipo nuevo aparece, con su región, y mueve la meta de esa insignia", () => {
  const before = live();
  const extra: CardDef[] = CARDS.slice(0, 4).map((c, i) => ({ ...c, id: `nuevo-${i}`, team: "Equipo Nuevo" }));
  const m = buildTeamCollections({ cards: [...CARDS, ...extra], player: getPlayer, teamOf: teamResolver([NUEVO]) });
  assert.equal(m.teams.length, before.teams.length + 1);
  assert.deepEqual(m.unassigned, []);
  const nuevo = team(m, "equipo-nuevo");
  assert.deepEqual([nuevo.cards.length, nuevo.region, nuevo.tag, nuevo.title, nuevo.logo], [4, "EMEA", "EN", "Equipo Nuevo", null], "sin logo inventado");
  const emea = (x: TeamCollectionsModel) => regionBadges(x.teams, new Set()).find((r) => r.region === "EMEA")!;
  assert.deepEqual([emea(m).teams, emea(m).total], [emea(before).teams + 1, emea(before).total + 4]);
  // Las demás regiones no cambian.
  for (const r of ["Americas", "Pacific", "China"] as const) assert.equal(regionBadges(m.teams, new Set()).find((x) => x.region === r)!.total, regionBadges(before.teams, new Set()).find((x) => x.region === r)!.total);
  // Completo → entra en lo que se liquida con su clave estable, no con el texto impreso.
  assert.deepEqual(settlePlan(m, new Set(extra.map((c) => c.id)), NOTHING_PERSISTED, true).teams.map((t) => t.id), ["equipo-nuevo"]);
});

test("4 · el registro de código manda: una fila del panel no cambia un equipo conocido ni toma una clave suya, y una fila inválida se ignora", () => {
  const before = live();
  const extra: CardDef[] = CARDS.slice(0, 2).map((c, i) => ({ ...c, id: `nuevo-${i}`, team: "Equipo Nuevo" }));
  const rows: ManagedTeamIdentity[] = [
    { ...NUEVO, printedTeam: "NAVI", teamId: "otra-navi", region: "China" }, // NAVI ya lo resuelve el código
    { ...NUEVO, teamId: "g2" }, // clave de un equipo del código
  ];
  const m = buildTeamCollections({ cards: [...CARDS, ...extra], player: getPlayer, teamOf: teamResolver(rows) });
  assert.deepEqual(team(m, "navi").cards.map((c) => c.id), team(before, "navi").cards.map((c) => c.id));
  assert.equal(team(m, "navi").region, team(before, "navi").region);
  assert.ok(!m.teams.some((t) => t.id === "otra-navi"));
  assert.equal(team(m, "g2").cards.length, team(before, "g2").cards.length, "G2 no recibe cartas ajenas");
  assert.deepEqual(m.unassigned.map((u) => u.id), ["raw:Equipo Nuevo"], "la fila con clave reservada se ignora: sigue sin identidad");
  for (const bad of [{ ...NUEVO, region: "Marte" }, { ...NUEVO, teamId: "raw-x" }, { ...NUEVO, teamId: "team-g2-v1" }, { ...NUEVO, teamId: "X" }]) {
    const x = buildTeamCollections({ cards: [...CARDS, ...extra], player: getPlayer, teamOf: teamResolver([bad]) });
    assert.deepEqual(x.unassigned.map((u) => u.id), ["raw:Equipo Nuevo"], JSON.stringify(bad));
  }
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
  // Las 41 identidades de las cartas tienen logo desde el 2026-10-15; el caso «sin logo» (un equipo dado de alta en el
  // panel sin logo todavía) se fuerza sobre uno real.
  assert.equal(team(m, "paper-rex").logo, "/hints/teams/paper-rex.png");
  const prx = { ...team(m, "paper-rex"), logo: null };
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

test("4 · SERVIDOR · una carta publicada desde el panel con un equipo nuevo aparece sola; una retirada deja de exigirse", async () => {
  // El catálogo sale de la BASE (`content_cards`), como en producción: lo que el panel publica es lo que se colecciona.
  resetServerCatalog();
  const mem = new MemorySupabase();
  const m = live();
  const navi = team(m, "navi");
  const model = CARDS.find((c) => c.id === navi.cards[0].id)!;
  const rows: Record<string, unknown>[] = CARDS.map((c, i) => ({ ...toCardRow(c, i), presentation: null }));
  // Carta del panel (F60): su equipo impreso va en la presentación. Publicada → cuenta. En borrador → no existe.
  const panel = (id: string, lifecycle: string, teamTag: string) => ({ ...toCardRow({ ...model, id }, rows.length + 1), card_id: id, lifecycle, presentation: { role: "Duelista", printed: { ovr: 80, stats: {} }, team: teamTag } });
  rows.push(panel("panel-nueva", "PUBLISHED", "Equipo Del Panel"), panel("panel-borrador", "DRAFT", "Equipo En Borrador"), panel("panel-navi", "PUBLISHED", "NAVI"));
  rows.find((r) => r.card_id === navi.cards[1].id)!.lifecycle = "RETIRED";
  mem.tables.content_catalog_version = [{ id: true, version: 3 }];
  mem.tables.content_cards = rows as never;
  mem.tables.content_players = [...new Set(CARDS.map((c) => c.playerId))].map((id) => toPlayerRow(getPlayer(id)!)) as never;
  mem.tables.content_card_versions = [];
  mem.tables.user_cards = [...navi.cards.filter((c) => c.id !== navi.cards[1].id).map((c) => c.id), "panel-navi"].map((card_id, i) => ({ uid: `u${i}`, user_id: U, card_id, serial: null, minted_version: 1, obtained_at: "2026-10-01T00:00:00Z", origin: "pack", locked: false }));
  const sb = mem as unknown as SupabaseClient;
  const v = (await getTeamCollections(sb, U)).data!;
  assert.equal(v.teams.length, m.teams.length, "sin identidad, el equipo del panel aún no es una colección (y el borrador tampoco)");
  assert.ok(!v.teams.some((t) => t.title === "Equipo Del Panel" || t.title === "Equipo En Borrador"));
  // El admin le da identidad (0076): aparece con su clave y su región. El borrador sigue sin existir.
  mem.tables.content_team_identities = [{ printed_team: "Equipo Del Panel", team_id: "equipo-del-panel", name: "Equipo Del Panel", tag: "EDP", region: "Pacific", rev: 1 }] as never;
  const w = (await getTeamCollections(sb, U)).data!;
  resetServerCatalog();
  assert.equal(w.teams.length, m.teams.length + 1, "un equipo más: el del panel (el borrador no)");
  const nuevo = w.teams.find((t) => t.title === "Equipo Del Panel")!;
  assert.deepEqual([nuevo.id, nuevo.total, nuevo.region, nuevo.tag, nuevo.state], ["equipo-del-panel", 1, "Pacific", "EDP", "LOCKED"]);
  assert.ok(!w.teams.some((t) => t.title === "Equipo En Borrador"));
  assert.equal(w.regions.find((r) => r.region === "Pacific")!.total, v.regions.find((r) => r.region === "Pacific")!.total + 1, "cuenta para Pacific");
  // NAVI: +1 por la carta del panel con su etiqueta, −1 por la retirada. Con las demás y la nueva, está completo.
  const n = v.teams.find((t) => t.id === "navi")!;
  assert.deepEqual([n.total, n.owned, n.state], [navi.cards.length, navi.cards.length, "COMPLETED"]);
  // El equipo sin región no cuenta para ninguna insignia.
  assert.equal(v.regions.reduce((x, r) => x + r.total, 0), CARDS.length, "331 − 1 retirada + 1 de NAVI; la del equipo sin región, fuera");
});

test("SERVIDOR · equipo inexistente o clave no válida", async () => {
  const sb = db([]);
  assert.deepEqual([(await getTeamCollection(sb, U, "no-existe")).status, (await getTeamCollection(sb, U, "../x")).status, (await getTeamCollection(sb, U, 7)).status, (await getTeamCollection(sb, U, "")).status], [404, 400, 400, 400]);
  for (const id of ["g2", "team-heretics", "100t", "raw:Equipo Nuevo"]) assert.ok(TEAM_ID_PATTERN.test(id), id);
});

test("SERVIDOR · la ruta: lectura pura en GET, una sola acción cerrada en POST, siempre con sesión", () => {
  const route = read("src/app/api/game/team-collections/route.ts");
  assert.ok(!/export async function (PUT|PATCH|DELETE)/.test(route));
  assert.equal((route.match(/if \(!session\) return bad\([^)]*401\)/g) ?? []).length, 2);
  assert.match(route, /keys\.some\(\(k\) => k !== "team"\)/);
  assert.match(route, /takeRate\(session\.admin, session\.userId, "collection_read"\)/);
  // POST: solo `{ action: "settle" }`, sin más campos; el cliente no dice qué equipo ni qué cartas.
  assert.match(route, /if \(body\.action !== "settle"\) return bad\(/);
  assert.match(route, /Object\.keys\(body\)\.some\(\(k\) => k !== "action"\)/);
  assert.match(route, /takeRate\(session\.admin, session\.userId, "collection_write"\)/);
  assert.match(route, /settleTeamCollections\(session\.admin, session\.userId\)/);
  const svc = read("src/server/services/teamCollections.ts");
  const get = svc.slice(svc.indexOf("export async function getTeamCollections"), svc.indexOf("// ───────────────────────────── Liquidación"));
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(get), "leer no escribe ni liquida");
  assert.match(svc, /loadCollectionSummary\(sb, userId\)/);
  assert.ok(!/readUserCards\(|from\("user_cards"\)/.test(svc), "no recorre el inventario: usa el resumen por carta");
});

test("7 · EQUIPOS SIN CARTAS · un equipo del registro sin cartas no es una colección; con su primera carta aparece con su región", () => {
  const m = live();
  // BLG está en el registro (China) y hoy no tiene ninguna carta.
  const blg = TEAM_IDENTITIES.find((t) => t.displayName === "BLG")!;
  assert.equal(blg.region, "China");
  assert.ok(!m.teams.some((t) => t.id === blg.canonicalId));
  assert.ok(m.teams.every((t) => t.cards.length > 0), "ninguna colección vacía");
  const china = regionBadges(m.teams, new Set()).find((r) => r.region === "China")!;
  // Se publica su primera carta (etiqueta impresa «BLG», la de su identidad).
  const grown = buildTeamCollections({ cards: [...CARDS, { ...CARDS[0], id: "blg-primera", team: blg.displayName }], player: getPlayer });
  const t = grown.teams.find((x) => x.id === blg.canonicalId)!;
  assert.deepEqual([t.cards.length, t.region, t.title], [1, "China", blg.displayName]);
  assert.equal(grown.teams.length, m.teams.length + 1);
  const after = regionBadges(grown.teams, new Set(idsOf(m, (x) => x.region === "China"))).find((r) => r.region === "China")!;
  assert.deepEqual([after.teams, after.total, after.unlocked], [china.teams + 1, china.total + 1, false], "la región crece y quien la tenía completa hoy ya no la completa");
  assert.deepEqual(grown.unassigned, []);
});
