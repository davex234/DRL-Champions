/**
 * FASE 62 · PROGRESSION & REWARDS 5.0 — modelo, recompensas, salud, UI y SERVICIOS REALES sobre `MemSupabase`.
 *
 *   UNIT      niveles (N-1 → umbral → N, varios de golpe, sin tope), temporada (tope 30, completa), objetivos (renovación
 *             del servidor, caducados), reclamables, colección (únicas ≠ ejemplares), secciones post-partida, recompensas.
 *   SECURITY  reclamos falsificados (id inventado, nivel no alcanzado/fuera de rango, logro incompleto) → rechazados sin pago;
 *             el cliente no manda cantidades; la ruta solo acepta ids.
 *   IDEMPOT.  el MISMO reclamo 1, 2 y 10 veces (secuencial) y una partida pagada 10 veces → mismo estado final.
 *   CONCURR.  «reclamar todo» en dos pestañas a la vez → cada recompensa una vez; XP de fuentes distintas a la vez → suma.
 *   POST MATCH  partida → XP de cuenta → objetivo completado → reclamo → XP de temporada → nivel del pase, coherente.
 *   NEW / EXISTING  cuenta nueva sin NaN ni recompensas fantasma; cuenta con progreso previo sin pérdidas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemSupabase } from "@/server/services/testing/memSupabase";
import { getMetaSnapshot, type MetaSnapshot } from "@/server/services/meta";
import { claimAchievement, claimMission, claimPassLevel, getProgression } from "@/server/services/progression";
import { award } from "@/server/services/rewards";
import { levelFromXp, totalXpForLevel } from "./levels";
import { levelsGained } from "./meta";
import { levelProgress } from "@/battlepass/xp";
import { CURRENT_SEASON } from "@/data/season";
import { CARDS, getCard } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { ACHIEVEMENTS } from "./achievements";
import {
  claimables, claimOrder, collectionProgress, meter, metricCta, objectiveGroups, postMatchSections, resetLabel, trackWindow,
  type MissionIn, type TrackLevelIn,
} from "./hub";
import { progressionHealth, SERVER_METRICS } from "./health";
import { rewardItems, rewardTier, validateReward, cosmeticLabel, XP_NAMES } from "@/domain/rewards/display";
import { RewardDisplay } from "@/components/rewards/RewardDisplay";
import { ProgressionHub } from "@/components/progression/hub/ProgressionHub";
import { PostMatchProgress } from "@/components/progression/PostMatchProgress";
import { ProgressDock } from "@/components/home/ProgressDock";
import { diffSnapshots } from "@/lib/progression/meta";
import { packArtwork } from "@/data/packArtwork";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const A = "aaaaaaaa-0000-4000-8000-000000000062";

function fresh() { const db = new MemSupabase(); db.seedUser(A); return db; }
const ledger = (db: MemSupabase, reason?: string) => db.table("credit_transactions").filter((t) => t.user_id === A && (!reason || t.reason === reason));
const profile = (db: MemSupabase) => db.table("profiles").find((p) => p.id === A)!;
const passState = (db: MemSupabase) => db.table("user_pass").find((r) => r.user_id === A)!.state as { xp: number; claimedFree: number[]; missions: { id: string; metric: string; goal: number; kind: string }[] };
const play = (db: MemSupabase, n: number, win = true) => { for (let i = 0; i < n; i++) db.table("duel_matches").push({ id: `m${db.table("duel_matches").length}`, user_id: A, status: "COMPLETED", winner: win ? "A" : "B", mode: "PVE" }); };
async function snap(db: MemSupabase): Promise<MetaSnapshot> { const r = await getMetaSnapshot(db.client, A); assert.ok(r.ok && r.data, r.error); return r.data!; }

/** Reclama por el SERVICIO todo lo reclamable de la foto, en el orden del hub. Devuelve cuántos aceptó. */
async function claimAllServer(db: MemSupabase, s: MetaSnapshot): Promise<number> {
  let ok = 0;
  for (const c of claimOrder(claimables(s.pass, s.serverNow))) {
    const r = c.kind === "mission" ? await claimMission(db.client, A, c.id)
      : c.kind === "level" ? await claimPassLevel(db.client, A, c.level!, c.track ?? "free")
        : await claimAchievement(db.client, A, c.id);
    if (r.ok) ok++;
  }
  return ok;
}

/* ═══════════════════════ UNIT · niveles ═══════════════════════ */

test("F62 NIVEL 01 · cruzar el umbral: N-1 XP → nivel N-1; umbral → N; varios niveles de golpe", () => {
  for (const n of [2, 5, 8, 20]) {
    assert.equal(levelFromXp(totalXpForLevel(n) - 1).level, n - 1, `nivel ${n} - 1`);
    assert.equal(levelFromXp(totalXpForLevel(n)).level, n, `nivel ${n}`);
  }
  assert.deepEqual(levelsGained(totalXpForLevel(3) - 1, totalXpForLevel(6)), [3, 4, 5, 6], "cuatro niveles en una concesión");
  assert.deepEqual(levelsGained(500, 500), []);
});

test("F62 NIVEL 02 · la cuenta NO tiene tope (curva creciente) y la barra nunca es NaN, negativa ni > 1", () => {
  const big = levelFromXp(10_000_000);
  assert.ok(big.level > 100 && big.progress >= 0 && big.progress < 1);
  for (const [into, next] of [[0, 0], [-5, 100], [NaN, 100], [200, 100], [50, 100]] as const) {
    const m = meter(into, next);
    assert.ok(Number.isFinite(m.ratio) && m.ratio >= 0 && m.ratio <= 1, `${into}/${next}`);
  }
});

test("F62 TEMPORADA 01 · el pase tiene tope 30: al máximo la barra está llena y no hay «siguiente recompensa»", () => {
  const max = levelProgress(CURRENT_SEASON.maxLevel * CURRENT_SEASON.xpPerLevel + 5000, CURRENT_SEASON);
  assert.equal(max.level, 30); assert.equal(max.max, true); assert.equal(max.progress, 1);
  const levels: TrackLevelIn[] = Array.from({ length: 30 }, (_, i) => ({ level: i + 1, reward: { credits: 100 }, claimed: true, claimable: false }));
  const w = trackWindow(levels, 30, 30);
  assert.equal(w.complete, true); assert.equal(w.next, null);
});

test("F62 TEMPORADA 02 · ventana del carril: pasado/reclamable/siguiente/bloqueado, sin pintar los 30", () => {
  const levels: TrackLevelIn[] = Array.from({ length: 30 }, (_, i) => ({ level: i + 1, reward: { credits: 250 + i }, claimed: i < 2, claimable: i === 2 }));
  const w = trackWindow(levels, 3, 30, 7);
  assert.equal(w.nodes.length, 7);
  assert.ok(w.nodes.some((n) => n.state === "CLAIMABLE" && n.level === 3));
  assert.ok(w.nodes.some((n) => n.state === "NEXT" && n.level === 4));
  assert.ok(w.nodes.some((n) => n.state === "LOCKED"));
  assert.equal(w.next?.level, 4);
  assert.ok(w.hiddenAfter > 0);
});

/* ═══════════════════════ UNIT · objetivos y reclamables ═══════════════════════ */

const NOW = 1_790_000_000_000;
const mission = (o: Partial<MissionIn>): MissionIn => ({
  id: "d-duelo-1", label: "Juega un duelo", kind: "daily", current: 0, goal: 1, complete: false, claimed: false,
  rewardCredits: 250, xp: 200, metric: "duels_played", packId: null, packCount: 0, assignedAt: NOW - 1000, expiresAt: NOW + 3_600_000, ...o,
});

test("F62 OBJETIVOS 01 · progreso/meta, estado, recompensa real y acceso a la pantalla que lo mueve", () => {
  const groups = objectiveGroups([
    mission({ current: 1, complete: true }),
    mission({ id: "w-duelos-5", kind: "weekly", current: 3, goal: 5, rewardCredits: 1200, xp: 800, expiresAt: NOW + 5 * 86_400_000 }),
    mission({ id: "d-pickem-1", metric: "picks_made", rewardCredits: 200, xp: 150 }),
  ], NOW);
  const today = groups.find((g) => g.id === "daily")!;
  assert.equal(today.items[0].state, "CLAIMABLE", "lo reclamable arriba");
  assert.deepEqual(today.items.find((i) => i.id === "d-pickem-1")!.cta, { href: "/pickems", label: "Predecir" });
  assert.equal(groups.find((g) => g.id === "weekly")!.items[0].cta?.href, "/jugar", "«Juega 5 duelos» → JUGAR");
  assert.equal(metricCta("inventada"), null, "sin métrica real no hay deep link");
});

test("F62 OBJETIVOS 02 · «Renueva en» sale del reloj del SERVIDOR; el reloj local no lo mueve", () => {
  assert.equal(resetLabel(NOW + 3_600_000 + 12 * 60_000, NOW), "Renueva en 1 h 12 min");
  assert.equal(resetLabel(NOW + 2 * 86_400_000 + 3 * 3_600_000, NOW), "Renueva en 2 d 3 h");
  assert.equal(resetLabel(NOW - 1, NOW), "Renovando…");
  assert.equal(resetLabel(null, NOW), null);
  const hub = code(read("src", "components", "progression", "hub", "ProgressionHub.tsx"));
  assert.ok(hub.includes("snap.serverNow + Math.max(0, now - receivedAt)"), "estimación anclada al servidor");
});

test("F62 OBJETIVOS 03 · caducado (EXPIRED): no se ofrece reclamar una tanda vencida", () => {
  const expired = mission({ current: 1, complete: true, expiresAt: NOW - 1 });
  const pass = { level: 0, xp: 0, xpIntoLevel: 0, xpForNext: 1000, progress: 0, season: { id: "s", name: "S", maxLevel: 30 }, competitiveUnlocked: false, competitiveMinPoints: 400, points: 0, tracks: { free: [], competitive: [], premium: [] }, missions: [expired], achievements: [] };
  assert.equal(claimables(pass, NOW).length, 0);
  assert.equal(objectiveGroups([expired], NOW)[0].items[0].state, "EXPIRED");
});

test("F62 RECLAMAR 01 · orden de «Reclamar todo»: misiones → niveles → logros; el carril de pago nunca se ofrece", () => {
  const pass = {
    level: 1, xp: 1000, xpIntoLevel: 0, xpForNext: 1000, progress: 0, season: { id: "s", name: "S", maxLevel: 30 },
    competitiveUnlocked: false, competitiveMinPoints: 400, points: 0,
    tracks: { free: [{ level: 1, reward: { credits: 260 }, claimed: false, claimable: true }], competitive: [{ level: 1, reward: { credits: 9 }, claimed: false, claimable: true }], premium: [{ level: 1, reward: { cosmetics: ["avatar:x"] }, claimed: false, claimable: true }] },
    missions: [mission({ current: 1, complete: true })],
    achievements: [{ id: "coleccionista", name: "Coleccionista", description: "", icon: "", reward: 4000, goal: 40, current: 40, complete: true, claimed: false, claimedAt: null }],
  };
  const order = claimOrder(claimables(pass, NOW)).map((c) => c.kind);
  assert.deepEqual(order, ["mission", "level", "achievement"]);
  assert.ok(!claimables(pass, NOW).some((c) => c.track === "competitive"), "competitivo cerrado: no se ofrece");
});

/* ═══════════════════════ UNIT · colección, post-partida, recompensas ═══════════════════════ */

test("F62 COLECCIÓN · únicas del catálogo ≠ ejemplares; ids fuera del catálogo no cuentan", () => {
  const ids = CARDS.slice(0, 3).map((c) => c.id);
  const c = collectionProgress([...ids, ids[0], "carta-borrada"], CARDS.map((x) => x.id), 7);
  assert.equal(c.unique, 3); assert.equal(c.total, CARDS.length); assert.equal(c.total, 331); assert.equal(c.instances, 7);
  assert.ok(c.milestones.every((m) => m.at <= 331));
  assert.equal(collectionProgress([], CARDS.map((x) => x.id), 0).progress, 0);
});

test("F62 POST-PARTIDA 01 · solo las secciones que cambiaron (nada de paneles con +0)", () => {
  assert.deepEqual(postMatchSections({ xpBefore: 100, xpAfter: 100, levelsGained: [], objectives: [], achievementsReady: 0, seasonXpBefore: 0, seasonXpAfter: 0, rewardGranted: false }), []);
  assert.deepEqual(postMatchSections({ xpBefore: 100, xpAfter: 140, levelsGained: [], objectives: [{ completed: true }], achievementsReady: 0, seasonXpBefore: 0, seasonXpAfter: 200, rewardGranted: true }), ["REWARDS", "ACCOUNT", "SEASON", "OBJECTIVES"]);
});

test("F62 RECOMPENSAS 01 · una representación: sobre, carta, créditos, las DOS XP con su nombre, cosméticos, puntos", () => {
  const items = rewardItems({ packId: "estandar", packCount: 2, credits: 600, xp: 50, cardId: CARDS[0].id, cosmetics: ["titulo:leyenda-s1"] }, { seasonXp: 300, points: 14, packName: (id) => getPack(id)?.name ?? null });
  assert.deepEqual(items.map((i) => i.kind), ["card", "pack", "credits", "seasonXp", "accountXp", "cosmetic", "points"]);
  assert.ok(items.find((i) => i.kind === "seasonXp")!.label.includes(XP_NAMES.season));
  assert.ok(items.find((i) => i.kind === "accountXp")!.label.includes(XP_NAMES.account));
  assert.equal(cosmeticLabel("titulo:leyenda-s1"), "Título · Leyenda S1");
  assert.deepEqual(rewardItems({ credits: -50, xp: 0 }), [], "ni negativos ni ceros");
});

test("F62 RECOMPENSAS 02 · niveles de revelación: minor / standard / major (no toda recompensa es una cinemática)", () => {
  assert.equal(rewardTier(rewardItems({ credits: 250 }, { seasonXp: 200 })), "minor");
  assert.equal(rewardTier(rewardItems({ packId: "estandar", credits: 600 })), "standard");
  assert.equal(rewardTier(rewardItems({ packId: "premium", packCount: 2 })), "major");
  assert.equal(rewardTier(rewardItems({ cardId: CARDS[0].id })), "major");
});

test("F62 RECOMPENSAS 03 · arte REAL: sobre con su arte del catálogo, créditos con la moneda del producto", () => {
  const h = html(<RewardDisplay reward={{ packId: "estandar", credits: 600 }} seasonXp={300} />);
  const art = packArtwork("estandar");
  if (art) assert.ok(h.includes(art), "arte real del sobre");
  assert.match(h, /data-reward-item="credits"/);
  assert.match(h, /XP de temporada/);
  assert.match(html(<RewardDisplay reward={null} />), /Sin recompensa/);
});

test("F62 VALIDACIÓN · contenido publicable: tipo desconocido, sobre/carta inexistentes, negativos, decimales, sin entrega", () => {
  const known = { packExists: (id: string) => Boolean(getPack(id)), cardExists: (id: string) => Boolean(getCard(id)) };
  const codes = (r: Record<string, unknown>) => validateReward(r, known).map((i) => i.code);
  assert.deepEqual(codes({ credits: 250 }), []);
  assert.ok(codes({ credits: -1 }).includes("NEGATIVE"));
  assert.ok(codes({ credits: 1.5 }).includes("NOT_INTEGER"));
  assert.ok(codes({ packId: "sobre-inventado" }).includes("UNKNOWN_PACK"));
  assert.ok(codes({ cardId: "carta-inventada" }).includes("UNKNOWN_CARD"));
  assert.ok(codes({ gems: 10 }).includes("UNKNOWN_FIELD"));
  assert.ok(codes({ materials: { rare: 5 } }).includes("NO_DELIVERY"));
  assert.ok(codes({}).includes("EMPTY"));
});

test("F62 SALUD · el contenido ACTUAL está sano y la comprobación detecta contenido roto", () => {
  const base = {
    season: CURRENT_SEASON as unknown as Parameters<typeof progressionHealth>[0]["season"],
    calendarSeasonIds: [CURRENT_SEASON.id], activeCalendarSeasonId: CURRENT_SEASON.id,
    achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, goal: a.goal, reward: a.reward })),
    packExists: (id: string) => Boolean(getPack(id)), cardExists: (id: string) => Boolean(getCard(id)),
  };
  const ok = progressionHealth(base);
  assert.equal(ok.level, "HEALTHY", JSON.stringify(ok.issues));
  for (const m of CURRENT_SEASON.missionPool) assert.ok((SERVER_METRICS as readonly string[]).includes(m.metric), m.metric);
  const broken = progressionHealth({
    ...base,
    season: { ...base.season, free: { ...base.season.free, 31: { credits: 10 }, 2: { packId: "no-existe" } }, missionPool: [...base.season.missionPool, { id: "x", metric: "inventada", goal: 0, reward: { credits: -5 } }] },
    activeCalendarSeasonId: "otra",
  });
  assert.equal(broken.level, "CRITICAL");
  for (const c of ["LEVEL_OUT_OF_RANGE", "UNKNOWN_PACK:packId", "UNKNOWN_METRIC", "BAD_GOAL", "NEGATIVE:credits", "ACTIVE_SEASON_MISMATCH"]) assert.ok(broken.issues.some((i) => i.code === c), c);
  assert.ok(read("src", "server", "admin", "overview.ts").includes('id: "progression", label: "Progresión y recompensas"'));
});

/* ═══════════════════════ SEGURIDAD ═══════════════════════ */

test("F62 SEGURIDAD 01 · reclamos falsificados: id inventado, nivel no alcanzado/fuera de rango, logro incompleto → sin pago", async () => {
  const db = fresh();
  await getProgression(db.client, A);
  const credits0 = Number(profile(db).credits);
  const rows0 = ledger(db).length;
  const r1 = await claimMission(db.client, A, "mision-inventada");
  const r2 = await claimPassLevel(db.client, A, 5, "free");
  const r3 = await claimPassLevel(db.client, A, 999, "free");
  const r4 = await claimPassLevel(db.client, A, 1, "premium");
  const r5 = await claimAchievement(db.client, A, "coleccionista");
  const r6 = await claimAchievement(db.client, A, "logro-inventado");
  for (const r of [r1, r2, r3, r4, r5, r6]) assert.equal(r.ok, false);
  assert.equal(Number(profile(db).credits), credits0, "ni un crédito");
  assert.equal(ledger(db).length, rows0, "ni un asiento nuevo");
  assert.equal(passState(db).xp, 0, "ni XP de temporada");
});

test("F62 SEGURIDAD 02 · el cliente solo manda ids: la ruta no lee cantidades, XP ni «completado»", () => {
  const route = code(read("src", "app", "api", "game", "progression", "route.ts"));
  for (const f of ["body.credits", "body.xp", "body.reward", "body.complete", "body.amount", "body.userId"]) assert.ok(!route.includes(f), f);
  const claims = code(read("src", "lib", "progression", "claims.ts"));
  assert.ok(!/credits|amount|xp\s*:/.test(claims));
  // El delta post-partida son DOS lecturas del servidor (antes/después), no una suma del cliente.
  assert.ok(read("src", "lib", "progression", "meta.ts").includes("xpAfter: after.account.xp"));
});

/* ═══════════════════════ IDEMPOTENCIA ═══════════════════════ */

test("F62 IDEMPOT 01 · el MISMO reclamo 1, 2 y 10 veces: un pago, la misma XP de temporada", async () => {
  const db = fresh();
  await getProgression(db.client, A);
  db.table("duel_decks").push({ id: "d1", user_id: A }); // completa «Guarda tu primer mazo» (s-mazo)
  const results = [];
  for (let i = 0; i < 10; i++) results.push((await claimMission(db.client, A, "s-mazo")).ok);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(ledger(db, "mission_reward").length, 1);
  assert.equal(passState(db).xp, 800);
});

test("F62 IDEMPOT 02 · una misma partida pagada 1, 2 y 10 veces (reintento, respuesta repetida): una concesión", async () => {
  const db = fresh();
  const xp0 = Number(profile(db).xp ?? 0); const c0 = Number(profile(db).credits);
  for (let i = 0; i < 10; i++) await award(db.client, { userId: A, ref: "duel:match-f62", reason: "duel_win", reward: { credits: 220, xp: 110 }, points: 14 });
  assert.equal(ledger(db).filter((t) => t.ref === "duel:match-f62").length, 1);
  assert.equal(Number(profile(db).xp) - xp0, 110);
  assert.equal(Number(profile(db).credits) - c0, 220);
});

test("F62 IDEMPOT 03 · recargar la foto no concede nada (la lectura del hub son cero escrituras)", async () => {
  const db = fresh();
  await getProgression(db.client, A);
  const w = db.writes;
  for (let i = 0; i < 5; i++) await snap(db);
  assert.equal(db.writes, w);
});

/* ═══════════════════════ CONCURRENCIA ═══════════════════════ */

test("F62 CONCURR 01 · «Reclamar todo» en dos pestañas a la vez: cada recompensa una sola vez", async () => {
  const db = fresh();
  await getProgression(db.client, A);
  db.table("duel_decks").push({ id: "d1", user_id: A });
  profile(db).region = "EMEA";
  play(db, 30);
  const s = await snap(db);
  const before = claimables(s.pass, s.serverNow).length;
  assert.ok(before >= 2, `hay varias recompensas (${before})`);
  const missions = claimables(s.pass, s.serverNow).filter((c) => c.kind === "mission");
  const xp0 = passState(db).xp;
  await Promise.all([claimAllServer(db, s), claimAllServer(db, s)]);
  const refs = ledger(db).map((t) => t.ref);
  assert.equal(new Set(refs).size, refs.length, "ninguna clave pagada dos veces");
  // F62 · el servicio reintenta ante el conflicto optimista: tras UNA ronda concurrente no queda nada a medias.
  const after = await snap(db);
  assert.equal(claimables(after.pass, after.serverNow).filter((c) => c.kind === "mission").length, 0, "ninguna misión pagada sin marcar");
  assert.equal(passState(db).xp - xp0, missions.reduce((a, c) => a + c.seasonXp, 0), "XP de temporada exacta: ni de más ni de menos");
});

test("F62 CONCURR 02 · dos concesiones DISTINTAS a la vez suman las dos (sin «leer 10, +1, escribir 11»)", async () => {
  const db = fresh();
  const xp0 = Number(profile(db).xp ?? 0);
  await Promise.all([
    award(db.client, { userId: A, ref: "duel:c1", reason: "duel_win", reward: { xp: 100 } }),
    award(db.client, { userId: A, ref: "duel:c2", reason: "duel_win", reward: { xp: 100 } }),
  ]);
  assert.equal(Number(profile(db).xp) - xp0, 200);
  // En la BD real la suma es atómica dentro de la RPC (`xp = xp + p_xp`), no un leer-y-escribir desde el cliente.
  assert.match(read("supabase", "migrations", "0026_retire_event_tokens_rpc.sql"), /xp\s*=\s*(coalesce\()?\s*xp/i);
});

/* ═══════════════════════ POST-PARTIDA · de punta a punta ═══════════════════════ */

test("F62 POST-PARTIDA 02 · partida → XP de cuenta → objetivo → reclamo → XP de temporada → nivel del pase", async () => {
  const db = fresh();
  await getProgression(db.client, A);
  const before = await snap(db);
  play(db, 1);
  await award(db.client, { userId: A, ref: "duel:e2e", reason: "duel_win", reward: { credits: 220, xp: 110 }, points: 14 });
  const after = await snap(db);
  const d = diffSnapshots(before, after);
  assert.equal(d.xpAfter - d.xpBefore, 110, "XP de cuenta de la partida");
  const played = d.objectives.find((o) => o.id === "d-duelo-1" || o.id === "w-duelos-5");
  if (played) assert.ok(played.to > played.from, "un objetivo de duelos avanzó");
  const ready = claimables(after.pass, after.serverNow).filter((c) => c.kind === "mission");
  const passXp0 = passState(db).xp;
  for (const c of ready) assert.ok((await claimMission(db.client, A, c.id)).ok, c.id);
  const gained = ready.reduce((s, c) => s + c.seasonXp, 0);
  assert.equal(passState(db).xp - passXp0, gained, "la XP de temporada es exactamente la de los objetivos reclamados");
  const final = await snap(db);
  assert.equal(final.season.level, levelProgress(passState(db).xp, CURRENT_SEASON).level);
  // La UI de post-partida enseña solo lo que cambió y ofrece reclamar lo completado.
  const h = html(<PostMatchProgress delta={d} />);
  assert.match(h, /data-sections="[^"]*ACCOUNT/);
  if (d.objectives.some((o) => o.completed)) assert.match(h, /Objetivo completado/);
});

/* ═══════════════════════ CUENTA NUEVA / EXISTENTE ═══════════════════════ */

test("F62 NUEVA · cuenta recién creada: foto válida, sin NaN, barras en [0,1], colección 0/331, nada que reclamar", async () => {
  const db = fresh();
  const s = await snap(db);
  const json = JSON.stringify(s);
  assert.ok(!json.includes("NaN") && !json.includes("null,null"), "sin NaN");
  assert.ok(s.level.progress >= 0 && s.level.progress <= 1);
  assert.ok(s.season.progress >= 0 && s.season.progress <= 1);
  assert.equal(s.season.level, 0);
  assert.deepEqual(s.collection && { u: s.collection.unique, t: s.collection.total }, { u: 0, t: 331 });
  assert.equal(claimables(s.pass, s.serverNow).length, 0, "ninguna recompensa fantasma");
  const h = html(<ProgressionHub snap={s} receivedAt={0} reload={async () => {}} />);
  assert.match(h, /data-count="0"/);
  assert.match(h, /Nivel de cuenta/); assert.match(h, /XP de temporada/);
});

test("F62 EXISTENTE · una cuenta con progreso previo se interpreta sin pérdidas (misma XP, mismos reclamos)", async () => {
  const db = fresh();
  await getProgression(db.client, A);
  profile(db).xp = 2039;
  passState(db).xp = 2500; passState(db).claimedFree = [1];
  const s = await snap(db);
  assert.equal(s.level.level, levelFromXp(2039).level);
  assert.equal(s.season.level, 2);
  const free = claimables(s.pass, s.serverNow).filter((c) => c.kind === "level").map((c) => c.level);
  assert.deepEqual(free, [2], "el 1 ya reclamado no reaparece; el 2 sí");
});

/* ═══════════════════════ UI · hub, portada, pins de alcance ═══════════════════════ */

test("F62 UI 01 · hub: cuenta y temporada separadas, reclamar con botón, objetivos con renovación, carril, logros, colección, competitivo, historial", async () => {
  const db = fresh();
  await getProgression(db.client, A);
  db.table("duel_decks").push({ id: "d1", user_id: A });
  const s = await snap(db);
  const h = html(<ProgressionHub snap={s} receivedAt={Date.now()} reload={async () => {}} />);
  for (const id of ["hub-hero", "claim-center", "hub-achievements", "hub-collection", "hub-competitive", "hub-recent"]) assert.match(h, new RegExp(`data-testid="${id}"`), id);
  assert.match(h, /data-kind="account"[\s\S]*data-kind="season"/);
  assert.match(h, /Reclamar todo/);
  assert.match(h, /id="objetivos"/);
  assert.match(h, /role="progressbar"/);
  assert.match(h, /Renueva en/);
});

test("F62 UI 02 · portada: bloque de progreso con la foto del vestíbulo (sin petición nueva) y CTA real", () => {
  const snapLoop = {
    signedIn: true,
    objectives: { daily: { done: 1, total: 3 }, weekly: { done: 0, total: 2 }, near: { id: "s-duelos-25", label: "Juega 25 duelos en la temporada", kind: "seasonal", current: 14, goal: 25, complete: false, claimed: false, rewardCredits: 0, xp: 2500, metric: "duels_played", packId: "estandar", packCount: 2, assignedAt: 1, expiresAt: null }, claimable: 0, rotationPending: false },
    season: { current: null, next: null, pass: { level: 3, maxLevel: 30, xp: 3000, xpIntoLevel: 0, xpForNext: 1000, progress: 0, nextReward: { level: 4, track: "free", label: "290 créditos" } } },
  } as unknown as Parameters<typeof ProgressDock>[0]["snap"];
  const h = html(<ProgressDock snap={snapLoop} />);
  assert.match(h, /data-testid="home-progress"/);
  assert.match(h, /14 \/ 25/);
  assert.match(h, /href="\/jugar"/);
  assert.match(h, /Temporada · nivel 3\/30/);
  const menu = code(read("src", "components", "home", "MainMenu.tsx"));
  assert.ok(menu.includes("<ProgressDock snap={snap} />") && !/fetch\(|fetchMetaSnapshot/.test(menu), "sin peticiones nuevas en la portada");
});

test("F62 ALCANCE · sin grifos nuevos: logros, carriles, misiones y la curva de cuenta intactos; sin recompensa por nivel de cuenta", () => {
  assert.equal(ACHIEVEMENTS.length, 7);
  assert.equal(CURRENT_SEASON.maxLevel, 30); assert.equal(CURRENT_SEASON.xpPerLevel, 1000);
  assert.equal(CURRENT_SEASON.missionPool.length, 14);
  assert.equal(totalXpForLevel(8), Math.round(100 * Math.pow(7, 1.6)));
  for (const f of ["src/domain/progression/hub.ts", "src/domain/rewards/display.ts", "src/components/progression/hub/ProgressionHub.tsx"]) {
    assert.ok(!/LEVEL_REWARDS|levelReward|recompensa por nivel de cuenta/i.test(code(read(f))), f);
  }
  const eco = read("src", "domain", "economy", "pricing.ts");
  assert.ok(eco.length > 0, "la economía no se toca aquí (economyFinal.test la congela)");
});
