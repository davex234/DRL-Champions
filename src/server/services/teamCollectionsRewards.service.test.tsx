/**
 * COLECCIONES POR EQUIPO — recompensa de la primera compleción (300 XP de temporada), insignias regionales
 * permanentes, perfil e interfaz retirada.
 *
 * `app_team_collections_settle` se emula con la MISMA regla que el SQL de 0075 (comprobación contra user_cards + PK
 * (usuario, equipo) + XP con `app_season_apply` + insignia en user_region_badges y user_cosmetics). La atomicidad REAL,
 * las carreras entre transacciones y el rollback se prueban aparte contra Postgres, en el stack de QA
 * (`scripts/ops/i18n-qa-stack/team-collections-0075.sh`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemorySupabase, type Row } from "./testing/memorySupabase";
import { getTeamCollection, getTeamCollections, settleTeamCollections, unlockedRegions } from "./teamCollections";
import { invalidateSeasonCache } from "./seasonTrack";
import { profileBadges } from "./playerIdentity";
import { resetServerCatalog } from "@/server/catalog";
import { CARDS, getPlayer } from "@/data/catalog";
import { t2Draft } from "@/domain/seasonTrack/template";
import {
  BADGE_REGIONS, NOTHING_PERSISTED, TEAM_COLLECTION_XP, buildTeamCollections, regionBadgeId, regionBadges, regionOfBadgeId, settlePlan,
  teamCollectionsView, type Persisted, type TeamCollectionsModel,
} from "@/domain/teamCollections/model";
import { badgeFact } from "@/domain/collectionSets/badges";
import { TrophyRoomScreen } from "@/components/trophies/TrophyRoomScreen";
import { TeamDetailScreen } from "@/components/trophies/TeamDetailScreen";
import { TrophyBadge } from "@/components/trophies/TrophyBadge";
import { ProfileIdentityCard } from "@/components/player/ProfileIdentityCard";
import { teamDetail } from "@/domain/teamCollections/model";
import { profile } from "@/app/design-system/fase82/fixtures";
import type { SupabaseClient } from "@supabase/supabase-js";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const T2 = t2Draft();
const M: TeamCollectionsModel = buildTeamCollections({ cards: CARDS, player: getPlayer });
const team = (id: string) => M.teams.find((t) => t.id === id)!;
const cardsOf = (pick: (t: TeamCollectionsModel["teams"][number]) => boolean) => M.teams.filter(pick).flatMap((t) => t.cards.map((c) => c.id));

function seasonRow(startsAt: number, id = T2.id): Row {
  return {
    id, number: T2.number, name: T2.name, description: T2.description, status: "PUBLISHED", starts_at: iso(startsAt), ends_at: iso(startsAt + 80 * DAY),
    claim_until: iso(startsAt + 90 * DAY), max_level: T2.maxLevel, config: T2.config, config_version: 1, checksum: "qa", published_at: iso(startsAt - DAY), row_version: 1,
  };
}

/** Base en memoria con la emulación de 0064 · app_season_apply (solo XP base) y de 0075 · app_team_collections_settle. */
function fresh(opts: { season?: "active" | "none"; migrated?: boolean } = {}): { db: MemorySupabase; sb: SupabaseClient; give: (user: string, ids: string[]) => void; drop: (user: string, ids: string[]) => void; calls: () => number } {
  resetServerCatalog();
  const db = new MemorySupabase();
  let uid = 0, calls = 0;
  db.tables.profiles = [A, B].map((id) => ({ id, username: id.slice(0, 4) }));
  db.tables.user_cards = [];
  db.tables.user_cosmetics = [];
  db.tables.game_seasons = opts.season === "none" ? [] : [seasonRow(Date.now() - DAY)];
  for (const t of ["season_events", "season_xp_ledger", "season_progress", "player_profile_customization"]) db.tables[t] = [];
  db.rpcHandlers.app_season_apply = (a) => {
    const s = db.tables.game_seasons.find((r) => r.id === a.p_season);
    const now = Date.now();
    if (!s || s.status !== "PUBLISHED" || now < Date.parse(s.starts_at as string) || now >= Date.parse(s.ends_at as string)) return { data: { code: "INACTIVE" }, error: null };
    if (db.tables.season_events.some((e) => e.user_id === a.p_user && e.season_id === a.p_season && e.event_key === a.p_event_key)) return { data: { code: "REPEATED" }, error: null };
    db.tables.season_events.push({ user_id: a.p_user, season_id: a.p_season, event_key: a.p_event_key, source: a.p_source });
    db.tables.season_xp_ledger.push({ user_id: a.p_user, season_id: a.p_season, source: a.p_source, event_key: a.p_event_key, amount: a.p_amount, meta: a.p_meta });
    let prog = db.tables.season_progress.find((r) => r.user_id === a.p_user && r.season_id === a.p_season);
    if (!prog) { prog = { user_id: a.p_user, season_id: a.p_season, xp: 0 }; db.tables.season_progress.push(prog); }
    prog.xp = (prog.xp as number) + (a.p_amount as number);
    return { data: { code: "APPLIED", xpGained: a.p_amount, baseGranted: a.p_amount, xp: prog.xp, completed: [] }, error: null };
  };
  if (opts.migrated === false) { db.missing.add("user_team_completions"); db.missing.add("user_region_badges"); }
  if (opts.migrated !== false) {
    db.tables.user_team_completions = [];
    db.tables.user_region_badges = [];
    db.rpcHandlers.app_team_collections_settle = (a) => {
      calls++;
      const mine = new Set(db.tables.user_cards.filter((c) => c.user_id === a.p_user).map((c) => c.card_id as string));
      const hasAll = (ids: string[]) => ids.length > 0 && ids.every((id) => mine.has(id));
      let total = 0;
      const teams: { id: string; code: string; xp: number }[] = [];
      for (const t of a.p_teams as { id: string; cards: string[] }[]) {
        let row = db.tables.user_team_completions.find((r) => r.user_id === a.p_user && r.team_id === t.id);
        let code = "ALREADY", xp = 0;
        if (!row) {
          if (!hasAll(t.cards)) { teams.push({ id: t.id, code: "INCOMPLETE", xp: 0 }); continue; }
          row = { user_id: a.p_user, team_id: t.id, completed_at: iso(Date.now()), cards: t.cards.length, xp_amount: null, xp_season_id: null, xp_granted_at: null };
          db.tables.user_team_completions.push(row); code = "COMPLETED";
        }
        if (row.xp_granted_at === null && a.p_season !== null && (a.p_xp as number) > 0) {
          const r = db.rpcHandlers.app_season_apply!({ p_user: a.p_user, p_season: a.p_season, p_event_key: `team-collection:${t.id}`, p_source: "COLLECTION", p_amount: a.p_xp, p_daily_cap: null, p_ops: [], p_meta: {} }).data as { code: string; baseGranted?: number };
          if (r.code === "APPLIED") { xp = r.baseGranted ?? 0; Object.assign(row, { xp_amount: xp, xp_season_id: a.p_season, xp_granted_at: iso(Date.now()) }); total += xp; if (code === "ALREADY") code = "XP_GRANTED"; }
          else if (r.code === "REPEATED") Object.assign(row, { xp_amount: 0, xp_season_id: a.p_season, xp_granted_at: iso(Date.now()) });
        }
        teams.push({ id: t.id, code, xp });
      }
      const regions: { region: string; code: string }[] = [];
      for (const g of a.p_regions as { region: string; teams: number; cards: string[] }[]) {
        if (db.tables.user_region_badges.some((r) => r.user_id === a.p_user && r.region === g.region)) { regions.push({ region: g.region, code: "ALREADY" }); continue; }
        if (g.teams < 1 || g.cards.length < 1) { regions.push({ region: g.region, code: "EMPTY" }); continue; }
        if (!hasAll(g.cards)) { regions.push({ region: g.region, code: "INCOMPLETE" }); continue; }
        db.tables.user_region_badges.push({ user_id: a.p_user, region: g.region, unlocked_at: iso(Date.now()), teams: g.teams, cards: g.cards.length });
        const cosmetic = `insignia:regional:${g.region.toLowerCase()}`;
        if (!db.tables.user_cosmetics.some((c) => c.user_id === a.p_user && c.cosmetic_id === cosmetic)) db.tables.user_cosmetics.push({ user_id: a.p_user, cosmetic_id: cosmetic, source: `team-collections:region:${g.region}` });
        regions.push({ region: g.region, code: "UNLOCKED" });
      }
      return { data: { code: "OK", teams, regions, xpGained: total }, error: null };
    };
  }
  const give = (user: string, ids: string[]) => { for (const card_id of ids) db.tables.user_cards.push({ uid: `u${String(uid++).padStart(7, "0")}`, user_id: user, card_id, serial: null, minted_version: 1, obtained_at: "2026-10-01T00:00:00Z", origin: "pack", locked: false }); };
  const drop = (user: string, ids: string[]) => { db.tables.user_cards = db.tables.user_cards.filter((c) => !(c.user_id === user && ids.includes(c.card_id as string))); };
  return { db, sb: db as unknown as SupabaseClient, give, drop, calls: () => calls };
}
const xpOf = (db: MemorySupabase, user: string) => db.tables.season_xp_ledger.filter((l) => l.user_id === user).reduce((n, l) => n + (l.amount as number), 0);

// ───────────────────────────── 300 XP por primera compleción ─────────────────────────────

test("XP · completar un equipo por primera vez da 300 XP de temporada, desde el servidor y con registro", async () => {
  const { db, sb, give } = fresh();
  give(A, cardsOf((t) => t.id === "navi"));
  const before = (await getTeamCollections(sb, A)).data!;
  assert.equal(before.pending, true, "leer no concede nada: solo avisa de que hay algo que guardar");
  assert.equal(db.tables.season_xp_ledger.length, 0);
  assert.equal(db.tables.user_team_completions.length, 0);
  const r = (await settleTeamCollections(sb, A)).data!;
  assert.deepEqual(r.teams, [{ id: "navi", title: "NAVI", xp: 300, first: true }]);
  assert.deepEqual([r.xpGained, TEAM_COLLECTION_XP, xpOf(db, A)], [300, 300, 300]);
  assert.deepEqual(db.tables.user_team_completions.map((x) => [x.user_id, x.team_id, x.xp_amount, x.xp_season_id]), [[A, "navi", 300, T2.id]]);
  assert.deepEqual(db.tables.season_xp_ledger.map((l) => [l.source, l.event_key, l.amount]), [["COLLECTION", "team-collection:navi", 300]]);
  assert.equal(r.view.pending, false);
  const tile = r.view.teams.find((t) => t.id === "navi")!;
  assert.ok(tile.firstCompletedAt && tile.xpAwarded === 300);
});

test("XP · una cuenta y un equipo, una sola vez: recargar, reintentar y dos peticiones a la vez no duplican", async () => {
  const { db, sb, give, calls } = fresh();
  give(A, cardsOf((t) => t.id === "navi"));
  const results = await Promise.all([settleTeamCollections(sb, A), settleTeamCollections(sb, A), settleTeamCollections(sb, A)]);
  for (let i = 0; i < 5; i++) { await getTeamCollections(sb, A); await settleTeamCollections(sb, A); }
  assert.equal(results.reduce((n, r) => n + r.data!.xpGained, 0), 300);
  assert.equal(xpOf(db, A), 300);
  assert.equal(db.tables.user_team_completions.length, 1);
  assert.equal(db.tables.season_events.length, 1);
  // Sin nada pendiente, la liquidación ni siquiera llega a la base.
  const n = calls(); await settleTeamCollections(sb, A); assert.equal(calls(), n);
});

test("XP · una colección incompleta no da nada, ni siquiera con una carta por jugador o con copias repetidas", async () => {
  const { db, sb, give } = fresh();
  const g2 = team("g2");
  const seen = new Set<string>();
  const five = g2.cards.filter((c) => !seen.has(c.playerId) && !!seen.add(c.playerId)).map((c) => c.id);
  give(A, [...five, ...five, ...five]);
  give(A, g2.cards.slice(0, g2.cards.length - 1).map((c) => c.id));
  assert.equal((await getTeamCollections(sb, A)).data!.pending, false);
  const r = (await settleTeamCollections(sb, A)).data!;
  assert.deepEqual([r.teams.length, r.xpGained, xpOf(db, A), db.tables.user_team_completions.length], [0, 0, 0, 0]);
});

test("XP · la base vuelve a comprobar las cartas: si el plan llega y ya no se cumple, no concede", async () => {
  const { db, sb, give } = fresh();
  give(A, cardsOf((t) => t.id === "navi"));
  // Entre la lectura y la liquidación desaparece una carta (un desguace en otra pestaña).
  const original = db.rpcHandlers.app_team_collections_settle!;
  db.rpcHandlers.app_team_collections_settle = (a) => { db.tables.user_cards.pop(); return original(a); };
  const r = (await settleTeamCollections(sb, A)).data!;
  assert.deepEqual([r.teams.length, r.xpGained, xpOf(db, A), db.tables.user_team_completions.length], [0, 0, 0, 0]);
});

test("XP · se concede una vez aunque después se pierdan cartas y se vuelva a completar, y aunque cambie la temporada", async () => {
  const { db, sb, give, drop } = fresh();
  const navi = cardsOf((t) => t.id === "navi");
  give(A, navi); await settleTeamCollections(sb, A);
  drop(A, [navi[0]]);
  assert.equal((await getTeamCollections(sb, A)).data!.teams.find((t) => t.id === "navi")!.state, "IN_PROGRESS", "el progreso es el del inventario");
  give(A, [navi[0]]);
  // Otra temporada: el libro de XP es por temporada, la compleción no.
  db.tables.game_seasons = [seasonRow(Date.now() - DAY, "temporada-3")]; invalidateSeasonCache(sb);
  assert.equal((await getTeamCollections(sb, A)).data!.pending, false);
  assert.equal((await settleTeamCollections(sb, A)).data!.xpGained, 0);
  assert.equal(xpOf(db, A), 300);
});

test("XP · sin temporada activa la compleción queda guardada y sus XP pendientes; se cobran una vez cuando hay temporada", async () => {
  const { db, sb, give, drop } = fresh({ season: "none" });
  const navi = cardsOf((t) => t.id === "navi");
  give(A, navi);
  const r = (await settleTeamCollections(sb, A)).data!;
  assert.deepEqual(r.teams, [{ id: "navi", title: "NAVI", xp: 0, first: true }]);
  assert.deepEqual(db.tables.user_team_completions.map((x) => [x.team_id, x.xp_amount, x.xp_granted_at]), [["navi", null, null]]);
  assert.equal(xpOf(db, A), 0);
  assert.equal(r.view.pending, false, "sin temporada no hay nada más que hacer: no se llama en bucle");
  assert.equal(r.view.teams.find((t) => t.id === "navi")!.xpAwarded, null);
  // La cuenta pierde una carta antes de que empiece la temporada: la primera compleción ya era suya.
  drop(A, [navi[0]]);
  db.tables.game_seasons = [seasonRow(Date.now() - DAY)]; invalidateSeasonCache(sb);
  assert.equal((await getTeamCollections(sb, A)).data!.pending, true);
  const later = (await settleTeamCollections(sb, A)).data!;
  assert.deepEqual(later.teams, [{ id: "navi", title: "NAVI", xp: 300, first: false }]);
  await settleTeamCollections(sb, A); await settleTeamCollections(sb, A);
  assert.equal(xpOf(db, A), 300);
});

test("XP · cada cuenta cobra lo suyo: completar con una no da nada a otra ni depende de otra", async () => {
  const { db, sb, give } = fresh();
  give(A, cardsOf((t) => t.id === "navi" || t.id === "karmine-corp"));
  give(B, cardsOf((t) => t.id === "navi").slice(1));
  assert.equal((await settleTeamCollections(sb, A)).data!.xpGained, 600);
  assert.equal((await settleTeamCollections(sb, B)).data!.xpGained, 0);
  assert.deepEqual([xpOf(db, A), xpOf(db, B)], [600, 0]);
  assert.ok(db.tables.user_team_completions.every((x) => x.user_id === A));
  assert.equal((await getTeamCollection(sb, B, "navi")).data!.firstCompletedAt, null);
});

test("XP · no toca otros sistemas: ni créditos, ni cartas, ni otras fuentes de XP", async () => {
  const { db, sb, give } = fresh();
  give(A, cardsOf((t) => t.id === "navi"));
  db.tables.season_xp_ledger.push({ user_id: A, season_id: T2.id, source: "MATCH", event_key: "m:1", amount: 70, meta: {} });
  const cards = JSON.stringify(db.tables.user_cards), profiles = JSON.stringify(db.tables.profiles);
  await settleTeamCollections(sb, A);
  assert.equal(JSON.stringify(db.tables.user_cards), cards);
  assert.equal(JSON.stringify(db.tables.profiles), profiles);
  assert.deepEqual(db.tables.season_xp_ledger.map((l) => [l.source, l.amount]), [["MATCH", 70], ["COLLECTION", 300]]);
  const svc = read("src/server/services/teamCollections.ts");
  assert.ok(!/from\("(profiles|user_cards|user_packs|credit_transactions)"\)|\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(svc), "el servicio solo escribe a través de la función de liquidación");
  assert.equal((svc.match(/\.rpc\(/g) ?? []).length, 1);
});

// ───────────────────────────── Insignias regionales permanentes ─────────────────────────────

test("INSIGNIA · al completar una región se guarda, se concede una vez y no se pierde al desguazar cartas", async () => {
  const { db, sb, give, drop } = fresh();
  const china = cardsOf((t) => t.region === "China");
  give(A, china);
  const r = (await settleTeamCollections(sb, A)).data!;
  assert.deepEqual(r.regions, ["China"]);
  assert.equal(r.xpGained, 300 * M.teams.filter((t) => t.region === "China").length);
  assert.deepEqual(db.tables.user_region_badges.map((x) => [x.user_id, x.region, x.cards]), [[A, "China", china.length]]);
  assert.deepEqual(db.tables.user_cosmetics.map((x) => x.cosmetic_id), ["insignia:regional:china"]);
  await settleTeamCollections(sb, A); await settleTeamCollections(sb, A);
  assert.equal(db.tables.user_region_badges.length, 1);
  assert.equal(db.tables.user_cosmetics.length, 1);
  // Desguaza media región: el progreso baja, la insignia no.
  drop(A, china.slice(0, 20));
  const v = (await getTeamCollections(sb, A)).data!;
  const b = v.regions.find((x) => x.region === "China")!;
  assert.deepEqual([b.unlocked, b.permanent, b.completeNow, b.owned, b.total], [true, true, false, china.length - 20, china.length]);
  assert.ok(b.unlockedAt);
  assert.equal(v.totals.badgesUnlocked, 1);
  assert.equal(v.pending, false);
  assert.deepEqual(await unlockedRegions(sb, A), ["China"]);
  assert.deepEqual(await unlockedRegions(sb, B), []);
});

test("INSIGNIA · con una carta de menos no se desbloquea ni se guarda nada", async () => {
  const { db, sb, give } = fresh();
  give(A, cardsOf((t) => t.region === "EMEA").slice(1));
  const r = (await settleTeamCollections(sb, A)).data!;
  assert.deepEqual(r.regions, []);
  assert.equal(db.tables.user_region_badges.length, 0);
  assert.equal(db.tables.user_cosmetics.length, 0);
  assert.deepEqual(r.view.regions.map((x) => x.unlocked), [false, false, false, false]);
});

test("INSIGNIA · una región sin equipos configurados no se concede ni entra en el plan", () => {
  const sinChina = buildTeamCollections({ cards: CARDS.filter((c) => M.teams.find((t) => t.cards.some((x) => x.id === c.id))!.region !== "China"), player: getPlayer });
  const all = new Set(CARDS.map((c) => c.id));
  const plan = settlePlan(sinChina, all, NOTHING_PERSISTED, true);
  assert.deepEqual(plan.regions.map((r) => r.region), ["Americas", "EMEA", "Pacific"]);
  assert.ok(plan.regions.every((r) => r.teams > 0 && r.cards.length > 0));
  assert.equal(regionBadges(sinChina.teams, all).find((r) => r.region === "China")!.unlocked, false);
  // Una insignia YA guardada sigue siendo del jugador aunque su región se quede sin equipos.
  const kept: Persisted = { teams: new Map(), regions: new Map([["China", "2026-10-13T00:00:00Z"]]) };
  const b = regionBadges(sinChina.teams, new Set(), kept).find((r) => r.region === "China")!;
  assert.deepEqual([b.unlocked, b.permanent, b.configured], [true, true, false]);
});

test("INSIGNIA · no altera el inventario ni concede cartas", async () => {
  const { db, sb, give } = fresh();
  give(A, CARDS.map((c) => c.id));
  const cards = JSON.stringify(db.tables.user_cards);
  const r = (await settleTeamCollections(sb, A)).data!;
  assert.deepEqual(r.regions, [...BADGE_REGIONS]);
  assert.equal(JSON.stringify(db.tables.user_cards), cards);
  assert.equal(r.view.totals.badgesUnlocked, 4);
  assert.equal(r.xpGained, 300 * M.teams.length);
});

test("PLAN · solo entra lo que HOY se cumple y aún no consta", () => {
  const navi = cardsOf((t) => t.id === "navi");
  const owned = new Set([...navi, ...team("g2").cards.slice(1).map((c) => c.id)]);
  assert.deepEqual(settlePlan(M, owned, NOTHING_PERSISTED, true).teams.map((t) => t.id), ["navi"]);
  assert.deepEqual(settlePlan(M, owned, NOTHING_PERSISTED, false).teams.map((t) => t.id), ["navi"], "sin temporada también se guarda la compleción");
  const done: Persisted = { teams: new Map([["navi", { completedAt: "x", xpGranted: true, xpAmount: 300 }]]), regions: new Map() };
  assert.deepEqual(settlePlan(M, owned, done, true), { teams: [], regions: [] });
  const owed: Persisted = { teams: new Map([["navi", { completedAt: "x", xpGranted: false, xpAmount: 0 }]]), regions: new Map() };
  assert.deepEqual(settlePlan(M, new Set(), owed, true).teams.map((t) => t.id), ["navi"]);
  assert.deepEqual(settlePlan(M, new Set(), owed, false).teams, []);
  assert.deepEqual(settlePlan(M, new Set(navi), NOTHING_PERSISTED, true).teams[0].cards.sort(), [...navi].sort(), "el plan lleva TODAS las cartas del equipo");
});

// ───────────────────────────── Sin la migración ─────────────────────────────

test("SIN 0075 · todo lo derivado funciona y no se concede nada (el orden de despliegue no rompe el juego)", async () => {
  const { db, sb, give } = fresh({ migrated: false });
  give(A, cardsOf((t) => t.region === "China"));
  const v = (await getTeamCollections(sb, A)).data!;
  assert.equal(v.pending, false);
  assert.equal(v.regions.find((r) => r.region === "China")!.unlocked, true, "se pinta por el inventario, como antes de 0075");
  assert.equal(v.regions.find((r) => r.region === "China")!.permanent, false);
  const r = await settleTeamCollections(sb, A);
  assert.deepEqual([r.ok, r.status, r.code], [false, 503, "NOT_READY"]);
  assert.equal(db.tables.season_xp_ledger.length, 0);
});

test("0075 · migración aditiva, solo para el servidor, con rollback que no pierde datos; la cabeza obligatoria no cambia", () => {
  const sql = read("supabase/migrations/0075_team_collections.sql");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/drop\s+(table|column|function|index)|truncate|delete\s+from|alter\s+table\s+public\.(profiles|user_cards|user_packs|credit_transactions|season_)/i.test(code));
  assert.ok(!/update\s+public\.(?!user_team_completions)/i.test(code), "solo actualiza su propia tabla");
  assert.ok(!/insert\s+into\s+public\.(profiles|user_cards|user_packs|credit_transactions)/i.test(code), "no concede cartas, sobres ni créditos");
  for (const t of ["user_team_completions", "user_region_badges"]) {
    assert.match(code, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(code, new RegExp(`revoke all on public\\.${t} from public, anon, authenticated`));
  }
  assert.match(code, /primary key \(user_id, team_id\)/);
  assert.match(code, /primary key \(user_id, region\)/);
  assert.match(code, /security definer set search_path = public/);
  assert.match(code, /pg_advisory_xact_lock/);
  assert.match(code, /revoke all on function public\.app_team_collections_settle\(uuid, jsonb, jsonb, text, int\) from public, anon, authenticated/);
  assert.match(code, /grant execute on function public\.app_team_collections_settle\(uuid, jsonb, jsonb, text, int\) to service_role/);
  const rb = read("docs/operations/rollback/0075_team_collections.ROLLBACK.sql");
  assert.match(rb, /create table public\.ops_rollback_0075_user_team_completions as select/);
  assert.match(rb, /create table public\.ops_rollback_0075_user_region_badges as select/);
  assert.ok(!/delete\s+from|user_cosmetics\s+where|season_xp_ledger\s+where/i.test(rb.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")));
});

// ───────────────────────────── Perfil e insignias destacadas ─────────────────────────────

test("PERFIL · las cuatro insignias regionales son insignias de pleno derecho: nombre, emblema y color propios", () => {
  for (const region of BADGE_REGIONS) {
    const id = regionBadgeId(region);
    assert.equal(regionOfBadgeId(id), region);
    const f = badgeFact(id, new Map())!;
    assert.deepEqual([f.id, f.label, f.kind, f.logo], [id, region, "REGION", null]);
    assert.match(id, /^insignia:[a-z0-9:-]{1,80}$/, "encaja en el patrón de insignias destacables de 0062");
    const h = renderToStaticMarkup(<TrophyBadge badge={f} size="md" showLabel />);
    assert.ok(h.includes("<svg") && h.includes(`>${region}<`));
  }
  assert.equal(badgeFact("insignia:regional:antartida", new Map()), null);
  assert.equal(regionOfBadgeId("insignia:region:emea"), null, "no se confunde con la insignia de maestría de región");
});

test("PERFIL · solo se pueden destacar las desbloqueadas; las antiguas seleccionadas se conservan", async () => {
  const { db, sb, give } = fresh();
  give(A, cardsOf((t) => t.region === "China"));
  await settleTeamCollections(sb, A);
  // Una insignia antigua (maestría) que la cuenta ya tenía y había destacado, más la regional nueva y una que NO tiene.
  db.tables.user_cosmetics.push({ user_id: A, cosmetic_id: "insignia:equipo:giantx-medio", source: "mastery:equipo:giantx:50" });
  db.tables.player_profile_customization.push({ user_id: A, featured_badge_ids: ["insignia:equipo:giantx-medio", "insignia:regional:china", "insignia:regional:emea"], version: 3 });
  const self = (await profileBadges(sb, A, true))!;
  assert.deepEqual(self.featured.map((b) => b.id), ["insignia:equipo:giantx-medio", "insignia:regional:china"], "EMEA está bloqueada: no se enseña");
  assert.deepEqual(self.owned.map((b) => b.id).sort(), ["insignia:equipo:giantx-medio", "insignia:regional:china"]);
  assert.equal(self.owned.find((b) => b.id === "insignia:regional:china")!.kind, "REGION");
  // Lo que ve otro jugador: solo las destacadas que el dueño POSEE.
  const pub = (await profileBadges(sb, A, false))!;
  assert.deepEqual([pub.featured.map((b) => b.id), pub.owned.length], [["insignia:equipo:giantx-medio", "insignia:regional:china"], 0]);
  // La preferencia guardada no se toca: sigue con sus tres ids.
  assert.equal((db.tables.player_profile_customization[0].featured_badge_ids as string[]).length, 3);
  // Quien no tiene ninguna no ve nada.
  assert.deepEqual((await profileBadges(sb, B, true))!.owned, []);
});

test("PERFIL · la tarjeta pinta las insignias destacadas (propias y ajenas) y el acceso se llama «Colecciones»", () => {
  const regional = badgeFact("insignia:regional:pacific", new Map())!;
  const own = profile("own");
  const withBadges = { ...own, badges: [regional, ...own.badges].slice(0, 3) };
  const h = renderToStaticMarkup(<ProfileIdentityCard snap={withBadges} owner={{ onEdit: () => {}, onSignOut: () => {} }} />);
  assert.match(h, /data-testid="profile-badges"/);
  assert.match(h, /data-badge="insignia:regional:pacific"/);
  assert.equal((h.match(/data-testid="trophy-badge"/g) ?? []).length, withBadges.badges.length);
  assert.match(h, /data-action="trophy-room"[^>]*>Colecciones</);
  assert.ok(!h.includes("Sala de Trofeos"));
  const pub = renderToStaticMarkup(<ProfileIdentityCard snap={{ ...profile("public"), badges: [regional] }} />);
  assert.match(pub, /data-badge="insignia:regional:pacific"/);
  assert.ok(!renderToStaticMarkup(<ProfileIdentityCard snap={{ ...profile("own-empty"), badges: [] }} />).includes('data-testid="profile-badges"'));
});

// ───────────────────────────── Interfaz ─────────────────────────────

test("PANTALLA · título «Colecciones», insignia permanente con su fecha y enlace para destacarla", () => {
  const kept: Persisted = { teams: new Map(), regions: new Map([["China", "2026-10-13T10:00:00Z"]]) };
  const h = renderToStaticMarkup(<TrophyRoomScreen room={teamCollectionsView(M, new Set(), kept)} />);
  assert.match(h, /<h1[^>]*>Colecciones<\/h1>/);
  assert.ok(!h.includes("Sala de Trofeos"));
  assert.match(h, /data-region="China" data-unlocked="1" data-configured="1" data-permanent="1"/);
  assert.match(h, /data-testid="region-since"/);
  assert.match(h, /data-testid="feature-badges-link"/);
  assert.equal((h.match(/data-testid="set-tile"/g) ?? []).length, 3, "tres equipos al entrar");
  assert.match(h, /300 XP de temporada/);
  assert.ok(!renderToStaticMarkup(<TrophyRoomScreen room={teamCollectionsView(M, new Set())} />).includes('data-testid="feature-badges-link"'));
});

test("PANTALLA · detalle: recompensa anunciada, cobrada o pendiente", () => {
  const navi = team("navi");
  const all = Object.fromEntries(navi.cards.map((c) => [c.id, 1]));
  assert.match(renderToStaticMarkup(<TeamDetailScreen team={teamDetail(navi, {})} />), /data-testid="first-completion-reward"/);
  const paid: Persisted = { teams: new Map([["navi", { completedAt: "2026-10-13T10:00:00Z", xpGranted: true, xpAmount: 300 }]]), regions: new Map() };
  assert.match(renderToStaticMarkup(<TeamDetailScreen team={teamDetail(navi, all, paid)} />), /data-testid="first-completion" data-xp="300"/);
  const owed: Persisted = { teams: new Map([["navi", { completedAt: "2026-10-13T10:00:00Z", xpGranted: false, xpAmount: 0 }]]), regions: new Map() };
  assert.match(renderToStaticMarkup(<TeamDetailScreen team={teamDetail(navi, all, owed)} />), /data-testid="first-completion" data-xp="pending"/);
});

test("PRESTIGIO · retirado de la interfaz: sin panel, sin vitrina en la cuenta y sin cliente de compra; servidor intacto", () => {
  assert.ok(!existsSync(join(process.cwd(), "src/components/collection/PrestigePanel.tsx")));
  assert.ok(!existsSync(join(process.cwd(), "src/lib/game/prestige.ts")));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const p of ["src/app/cuenta/page.tsx", "src/app/coleccion/trofeos/page.tsx", "src/app/coleccion/page.tsx", "src/components/trophies/TrophyRoomScreen.tsx", "src/components/player/ProfileIdentityCard.tsx", "src/design/nav.ts"]) {
    assert.ok(!/prestig|buyPrestige|fetchPrestige|api\/game\/prestige/i.test(strip(read(p))), p);
  }
  // Lo que no se toca: la ruta, el servicio, la economía y los datos.
  for (const p of ["src/app/api/game/prestige/route.ts", "src/server/services/prestige.ts", "src/domain/collection/prestige.ts"]) assert.ok(existsSync(join(process.cwd(), p)), p);
});
