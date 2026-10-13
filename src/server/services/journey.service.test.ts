/**
 * FASE 40 · PLAYER JOURNEY en el SERVICIO del Daily Loop (Supabase en memoria que registra escrituras y RPC).
 *
 * Cuenta nueva real (lo que crea el trigger `handle_new_user`: 3 × inicial + 1 × estándar, 0 cartas), vuelta tras abrir,
 * equipo legal, primera partida, legado, partidas abiertas (PvE, PvP, privada, Draft) que ganan al recorrido, aislamiento
 * de subsistemas y CERO escrituras. RLS / PostgREST reales: NO EJECUTADO aquí (E2E real en el VPS, `_fase40-real-e2e`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import { CardRegistry } from "@/collection/registry";
import { DUEL_ROLES } from "@/domain/cardgame/types";
import type { RoleId } from "@/domain/cards/types";
import { FakeSupabase } from "./testing/fakeSupabase";
import { getDailyLoop } from "./dailyLoop";
import type { SupabaseClient } from "@supabase/supabase-js";

const U = "aaaaaaaa-0000-4000-8000-0000000000f1";
const OTHER = "cccccccc-0000-4000-8000-0000000000f3";
const D = 86_400_000;
const NOW = Date.parse(SEASON_CALENDAR[0].startsAt) + 9 * D;
// COLECCIONES ILIMITADAS · `app_collection_summary` es una función SQL `stable` de solo lectura (resumen por carta).
const READ_ONLY_RPC = new Set(["app_content_distribution_snapshot", "app_collection_summary"]);

/** Dos jugadores DISTINTOS por rol, cartas reales del catálogo con combate y la misma versión de datos. */
function legalCardIds(): string[] {
  const reg = new CardRegistry();
  const out: string[] = [];
  const usados = new Set<string>(); // un jugador puede tener cartas de roles distintos: nunca dos veces en el mazo
  for (const role of DUEL_ROLES) {
    const players = new Set<string>();
    for (const c of reg.cards) {
      const p = reg.player(c.playerId);
      if (!c.combat || !p || (c.role ?? p.role) !== (role as RoleId) || (c.dataVersion ?? "") !== "VCT-2026" || usados.has(c.playerId)) continue;
      players.add(c.playerId); usados.add(c.playerId); out.push(c.id);
      if (players.size === 2) break;
    }
  }
  return out;
}
const LEGAL = legalCardIds();

function seed(o: { cards?: string[]; packs?: { pack_id: string; qty: number }[]; deck?: "legal" | "partial"; matches?: number; openPve?: boolean; openPvp?: "PVP" | "PVP_PRIVATE"; draft?: "IN_MATCH" | "DRAFTING"; packsOpened?: number } = {}) {
  const db = new FakeSupabase();
  const cards = (o.cards ?? []).map((cardId, i) => ({ uid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, user_id: U, card_id: cardId, origin: "pack", obtained_at: new Date(NOW - D).toISOString() }));
  db.tables = {
    profiles: [{ id: U, username: "Nuevo", xp: 0, credits: 6_000, points: 0, packs_opened: 0, region: null }, { id: OTHER, username: "Otro", xp: 9, credits: 1, points: 0 }],
    user_game: [{ user_id: U, packs_opened: o.packsOpened ?? 0 }],
    user_pass: [],
    user_cards: [...cards, { uid: "ffffffff-0000-4000-8000-000000000999", user_id: OTHER, card_id: LEGAL[0], origin: "pack" }],
    user_achievements: [], user_cosmetics: [],
    user_packs: [...(o.packs ?? [{ pack_id: "inicial", qty: 3 }, { pack_id: "estandar", qty: 1 }]).map((p) => ({ user_id: U, ...p })), { user_id: OTHER, pack_id: "premium", qty: 9 }],
    duel_decks: o.deck ? [{ id: "deck-1", user_id: U, name: "Equipo 1", card_uids: cards.slice(0, o.deck === "legal" ? 10 : 7).map((c) => c.uid), created_at: new Date(NOW - 3600_000).toISOString(), updated_at: new Date(NOW - 3600_000).toISOString() }] : [],
    duel_active_deck: [],
    duel_matches: [
      ...Array.from({ length: o.matches ?? 0 }, (_, i) => ({ id: `done-${i}`, user_id: U, mode: "PVE", status: i % 3 === 0 ? "COMPLETED" : i % 3 === 1 ? "DRAW" : "COMPLETED", winner: i % 2 ? "B" : "A", difficulty: "EASY" })),
      ...(o.openPve ? [{ id: "pve-open", user_id: U, mode: "PVE", status: "IN_PROGRESS", difficulty: "EASY", updated_at: new Date(NOW).toISOString() }] : []),
      ...(o.openPvp ? [{ id: "pvp-open", user_id: U, player_b_id: OTHER, mode: o.openPvp, status: "IN_PROGRESS", closed_reason: null, updated_at: new Date(NOW).toISOString() }] : []),
    ],
    draft_runs: o.draft ? [{ id: "run-1", user_id: U, status: o.draft }] : [],
    campaign_attempts: [], campaign_progress: [], duel_challenges: [], duel_pvp_ratings: [], duel_pvp_rating_events: [],
    events: [], matches: [], stages: [], pickem_events: [], pickem_questions: [], pickem_submissions: [], pickem_answers: [],
  };
  return db;
}

const run = async (db: FakeSupabase) => {
  const r = await getDailyLoop(db as unknown as SupabaseClient, U, { now: NOW });
  assert.ok(r.ok, r.error);
  return r.data!;
};
const noWrites = (db: FakeSupabase) => {
  assert.deepEqual(db.writes, [], `escrituras: ${db.writes.join(", ")}`);
  assert.deepEqual(db.rpcs.filter((x) => !READ_ONLY_RPC.has(x)), [], `RPC: ${db.rpcs.join(", ")}`);
};

test("JS01 · cuenta recién creada (3 inicial + 1 estándar, 0 cartas): bienvenida y ABRE su Sobre Inicial real", async () => {
  const db = seed();
  const s = await run(db);
  assert.equal(s.primaryAction.id, "journey-open");
  assert.equal(s.primaryAction.href, "/abrir/inicial");
  assert.ok(s.journey && s.journey.welcome && s.journey.status === "ACTIVE");
  assert.equal(s.journey!.context.unopenedPacks, 4);
  noWrites(db);
});

test("JS02 · GET del recorrido: CERO escrituras y cero RPC de escritura, también en lecturas concurrentes (dos pestañas)", async () => {
  const db = seed({ cards: LEGAL.slice(0, 6), packsOpened: 1, packs: [{ pack_id: "inicial", qty: 2 }] });
  const before = JSON.stringify(db.tables);
  const [a, b] = await Promise.all([run(db), run(db)]);
  assert.deepEqual(a.journey, b.journey);
  assert.equal(JSON.stringify(db.tables), before, "ninguna tabla cambia");
  noWrites(db);
});

test("JS03 · tras abrir un sobre (hechos reales: packs_opened + cartas), vuelve a COLECCIONA sin repetir la bienvenida", async () => {
  const s = await run(seed({ cards: LEGAL.slice(0, 5), packsOpened: 1, packs: [{ pack_id: "inicial", qty: 2 }, { pack_id: "estandar", qty: 1 }] }));
  assert.equal(s.journey!.currentStep, "collect");
  assert.equal(s.journey!.welcome, false);
  assert.equal(s.primaryAction.id, "journey-collect");
  assert.equal(s.primaryAction.href, "/abrir/inicial");
  assert.ok(s.journey!.context.shortages.length > 0);
});

test("JS04 · sin sobres y sin colección suficiente: Sobre Inicial GRATIS; nada se concede al leer", async () => {
  const db = seed({ cards: LEGAL.slice(0, 7), packsOpened: 4, packs: [] });
  const s = await run(db);
  assert.equal(s.primaryAction.id, "journey-collect");
  assert.equal(s.primaryAction.href, "/packs/inicial");
  assert.equal(db.tables.user_packs.filter((p) => p.user_id === U).length, 0);
  noWrites(db);
});

test("JS05 · colección que YA forma un equipo legal (catálogo del servidor) → CONSTRUYE, al constructor real", async () => {
  const s = await run(seed({ cards: LEGAL, packsOpened: 4, packs: [] }));
  assert.equal(s.journey!.currentStep, "build");
  assert.equal(s.journey!.context.shortages.length, 0);
  assert.equal(s.primaryAction.href, "/duelos/mazos?nuevo=1");
});

test("JS06 · equipo guardado a medias → termina ESE equipo; no cuenta como construido", async () => {
  const s = await run(seed({ cards: LEGAL, packsOpened: 4, packs: [], deck: "partial" }));
  assert.equal(s.journey!.currentStep, "build");
  assert.equal(s.primaryAction.href, "/duelos/mazos?deck=deck-1");
});

test("JS07 · equipo guardado y LEGAL (validador canónico del servidor) → JUEGA, con la plantilla real de 10 cartas", async () => {
  const s = await run(seed({ cards: LEGAL, packsOpened: 4, packs: [], deck: "legal" }));
  assert.equal(s.journey!.currentStep, "play");
  assert.equal(s.primaryAction.id, "journey-play");
  assert.equal(s.primaryAction.href, "/duelos/jugar?dificultad=EASY&primera=1");
  assert.deepEqual([...s.journey!.context.readyDeck!.cardIds].sort(), [...LEGAL].sort());
});

test("JS08 · una partida terminada (gane, pierda o empate) → COMPLETA con «primera sesión»; la acción principal es la normal", async () => {
  const s = await run(seed({ cards: LEGAL, packsOpened: 4, packs: [], deck: "legal", matches: 1 }));
  assert.ok(s.journey!.isComplete && s.journey!.justCompleted);
  assert.ok(!s.primaryAction.id.startsWith("journey-"));
});

test("JS09 · cuenta veterana (cartas, equipo, partidas): sin recorrido, vestíbulo normal", async () => {
  const s = await run(seed({ cards: LEGAL, packsOpened: 12, packs: [], deck: "legal", matches: 7 }));
  assert.equal(s.journey, null);
  assert.ok(!s.primaryAction.id.startsWith("journey-") && !s.secondaryActions.some((a) => a.id.startsWith("journey-")));
});

test("JS10 · partidas históricas SIN equipo ni cartas (legacy) → COMPLETA, sin FTUE retroactivo", async () => {
  const s = await run(seed({ cards: [], packs: [], matches: 3 }));
  assert.equal(s.journey, null);
});

test("JS11 · PvE a medias GANA al recorrido: CONTINUAR PARTIDA (nunca mandar a abrir un sobre)", async () => {
  const s = await run(seed({ openPve: true }));
  assert.equal(s.primaryAction.id, "resume-pve");
  assert.equal(s.secondaryActions[0]?.id, "journey-open", "el recorrido sigue ahí, detrás");
});

test("JS12 · PvP ranked y duelo privado a medias ganan al recorrido", async () => {
  assert.equal((await run(seed({ openPvp: "PVP" }))).primaryAction.id, "resume-ranked");
  assert.equal((await run(seed({ openPvp: "PVP_PRIVATE" }))).primaryAction.id, "resume-private");
});

test("JS13 · combate de Draft Gauntlet en curso gana al recorrido; un draft solo DRAFTING no se toca ni se propone", async () => {
  const inMatch = await run(seed({ draft: "IN_MATCH" }));
  assert.equal(inMatch.primaryAction.id, "resume-draft");
  assert.equal(inMatch.primaryAction.href, "/duelos/jugar?draft=1");
  const db = seed({ draft: "DRAFTING" });
  const drafting = await run(db);
  assert.equal(drafting.primaryAction.id, "journey-open");
  assert.equal(db.tables.draft_runs[0].status, "DRAFTING");
  noWrites(db);
});

test("JS14 · sin la tabla de Draft (0053 ausente) el vestíbulo y el recorrido siguen funcionando", async () => {
  const db = seed();
  delete (db.tables as Record<string, unknown>).draft_runs;
  db.failTables.add("draft_runs");
  const s = await run(db);
  assert.equal(s.primaryAction.id, "journey-open");
  assert.ok(!s.unavailable.includes("match"));
});

test("JS15 · eventos / temporada / social caídos: el núcleo de la primera sesión sigue funcionando", async () => {
  for (const t of ["events", "pickem_events", "duel_challenges"]) {
    const db = seed();
    db.failTables.add(t);
    const s = await run(db);
    assert.equal(s.primaryAction.id, "journey-open", t);
    assert.ok(s.journey, t);
  }
});

test("JS16 · núcleo caído (sobres o equipos): no se adivina el paso", async () => {
  for (const t of ["user_packs", "duel_decks"]) {
    const db = seed();
    db.failTables.add(t);
    const s = await run(db);
    assert.equal(s.journey, null, t);
    assert.ok(!s.primaryAction.id.startsWith("journey-"), t);
  }
});

test("JS17 · privacidad: solo SUS cartas, sobres y equipos (lo del otro usuario no cuenta)", async () => {
  const s = await run(seed({ packs: [] }));
  assert.equal(s.journey!.context.unopenedPacks, 0);
  assert.equal(s.journey!.context.firstPackId, null, "el premium del otro usuario no es suyo");
  assert.equal(s.journey!.steps[0].done, false, "la carta del otro usuario no cuenta");
});

test("JS18 · lecturas acotadas: el recorrido no añade consultas por carta (sin N+1) y solo una lectura nueva (draft_runs)", async () => {
  const small = seed({ cards: LEGAL.slice(0, 2) });
  const big = seed({ cards: [...LEGAL, ...LEGAL, ...LEGAL, ...LEGAL] });
  let a = 0; let b = 0;
  const count = (db: FakeSupabase, bump: () => void) => new Proxy(db, { get(t, k, r) { if (k === "from") return (name: string) => { bump(); return t.from(name); }; return Reflect.get(t, k, r); } });
  await getDailyLoop(count(small, () => a++) as unknown as SupabaseClient, U, { now: NOW });
  await getDailyLoop(count(big, () => b++) as unknown as SupabaseClient, U, { now: NOW });
  assert.equal(a, b, `consultas: ${a} vs ${b}`);
  const src = readFileSync(join(process.cwd(), "src/server/services/dailyLoop.ts"), "utf8");
  assert.ok(!/\.(insert|update|upsert|delete)\(|\.rpc\(|ensureRating|getProgression\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
});
