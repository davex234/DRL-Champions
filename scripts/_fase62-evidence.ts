/**
 * FASE 62 · EVIDENCIA (instrumento `_`, fuera de CI). Compone los JSON de `docs/product/qa/fase62-progression/` a partir de
 * lo medido (baseline, QA real `live/*.json`, BD `live/db-verify.txt`, capturas) y del CONTENIDO real (mapa de progresión,
 * tipos de recompensa). No lee ni escribe la BD.
 *
 *   npx tsx scripts/_fase62-evidence.ts
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CURRENT_SEASON } from "@/data/season";
import { ACHIEVEMENTS } from "@/domain/progression/achievements";
import { BATCH_SIZE } from "@/domain/progression/rotation";
import { totalXpForLevel } from "@/domain/progression/levels";
import { SERVER_METRICS } from "@/domain/progression/health";
import { CARDS } from "@/data/catalog";

/* eslint-disable @typescript-eslint/no-explicit-any */
const Q = join(process.cwd(), "docs/product/qa/fase62-progression");
const rd = (f: string): any => JSON.parse(readFileSync(join(Q, f), "utf8"));
const w = (f: string, o: unknown) => writeFileSync(join(Q, f), JSON.stringify(o, null, 2) + "\n");
const play1 = rd("live/play-run1.json");
const play2 = rd("live/play.json");
const probe = rd("live/probe.json");

w("baseline.json", {
  measuredAt: "2026-09-25T10:20Z (antes de editar)",
  git: { branch: "arch/stabilization", head: "48dac2a", statusLines: 1300 },
  tests: { total: 5180, pass: 5180, fail: 0 },
  build: "build de F61 sirviendo en :3005 (PID verificado); no se recompiló antes de editar",
  migrationHead: "0057_admin_cms.sql", cards: 331, agents: 29,
  flags: { GLOBAL_MARKET_ENABLED: false, PAYMENTS_ENABLED: false },
  f61: "intacta (suite F61 en verde; el resultado solo gana el hueco `progress`)",
  cms: "F60 intacta; /admin/system gana una comprobación de progresión",
  rewardInfrastructure: "services/rewards.award → RPC app_grant_reward (única vía), clave `ref` única en credit_transactions",
  seasonInfrastructure: "SEASON_CALENDAR (nexus-s1 2026-09-07 → 2026-11-30) + pase CURRENT_SEASON (30 niveles × 1.000 XP)",
  challengeInfrastructure: "misiones del pase (diaria ×3, semanal ×2, temporada, hitos) con rotación pura por ventana UTC; reclamo manual",
  qaAccountBefore: { id: probe.account, meta: { level: probe["/api/game/meta"].body.level, season: probe["/api/game/meta"].body.season, claimable: probe["/api/game/daily-loop"].body.objectives.claimable } },
});

w("progression-map.json", {
  xp: {
    account: { name: "XP de cuenta", store: "profiles.xp", curve: "totalXpForLevel(L) = round(100·(L−1)^1.6), sin tope", sources: ["duelo PvE (duelRewards, tope diario 20 pagos)", "apertura de sobres (XP por carta)", "escalones de Pick'ems"], levelReward: "ninguna (decisión F27/F62)" },
    season: { name: "XP de temporada", store: "user_pass.state.xp", curve: `lineal ${CURRENT_SEASON.xpPerLevel}/nivel, tope ${CURRENT_SEASON.maxLevel}`, sources: ["reclamar misiones (xp de la misión)"], levelReward: "carril libre (créditos cada nivel; sobre cada 5)" },
  },
  map: [
    { action: "Jugar un duelo PvE", progress: "XP de cuenta + créditos (+ puntos de rango si gana) · métricas duels_played/duels_won", reward: "auto (award con ref duel:<match>)", next: "objetivo de duelos · nivel de cuenta" },
    { action: "Completar un objetivo", progress: "misión complete (servidor)", reward: "RECLAMAR (hub, post-partida o /logros) → créditos/sobres + XP de temporada", next: "nivel de temporada" },
    { action: "Subir de nivel de temporada", progress: "user_pass.state.xp", reward: "RECLAMAR nivel del carril libre (y competitivo en Oro)", next: "siguiente nivel del carril" },
    { action: "Coleccionar", progress: "cartas únicas / 331 (distinct_cards)", reward: "logros de colección (RECLAMAR) + hitos del pase 50/150", next: "siguiente marca 10/50/100/150/250/331" },
    { action: "Abrir sobres", progress: "packs_opened + XP de cuenta por carta", reward: "misiones de sobres, logros sobres-100/1000", next: "objetivo de sobres" },
    { action: "Ranked PvP", progress: "rating Elo + escalera (aparte del nivel)", reward: "sin economía (F28); el carril competitivo se abre por PUNTOS de rango (Oro)", next: "siguiente puesto" },
    { action: "Predicciones (Pick'ems)", progress: "picks_made + puntos", reward: "escalones del torneo (auto, ref pickem:*)", next: "objetivo de predicción" },
    { action: "Campaña / Draft / Coach", progress: "sus propios estados (nodos, runs, partidas)", reward: "campaña: créditos de primera victoria del nodo (auto); draft y coach: sin recompensa (v1)", next: "no alimentan XP de temporada" },
  ],
  objectives: { batch: BATCH_SIZE, pool: CURRENT_SEASON.missionPool.map((m) => ({ id: m.id, kind: m.kind, metric: m.metric, goal: m.goal, reward: m.reward, seasonXp: m.xp })), metricsMeasurable: SERVER_METRICS, resetTimezone: "UTC (ventanas del servidor, domain/progression/periods)" },
  achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, goal: a.goal, reward: a.reward })),
  collection: { unit: "carta del catálogo (card_id único)", total: CARDS.length, instances: "filas de user_cards (repetidas incluidas)" },
  levelSamples: [2, 5, 8, 10, 20].map((l) => ({ level: l, totalXp: totalXpForLevel(l) })),
});

w("reward-types.json", {
  deliverable: [
    { kind: "credits", route: "app_grant_reward p_credits", visual: "DrlCoin (moneda real)" },
    { kind: "accountXp", route: "app_grant_reward p_xp", visual: "chip «XP de cuenta» (cian)" },
    { kind: "pack", route: "app_grant_reward p_pack_id/p_pack_count → user_packs", visual: "arte real packArtwork; «Abrir sobre» → /abrir/<id> (F57)" },
    { kind: "card", route: "app_grant_reward p_card_ids → user_cards", visual: "CardArt con la imagen del catálogo" },
    { kind: "cosmetic", route: "app_grant_reward p_cosmetics → user_cosmetics", visual: "texto (sin asset propio)" },
    { kind: "points", route: "app_grant_reward p_points", visual: "«puntos de rango»" },
    { kind: "seasonXp", route: "PassEngine al reclamar misión (no es asiento del libro mayor)", visual: "chip «XP de temporada» (oro)" },
  ],
  notDeliverable: [{ kind: "materials", reason: "sin tabla ni RPC en servidor: `unsupportedFields` lo registra; validateReward lo marca NO_DELIVERY" }],
  duplicateCards: "una carta concreta se concede como ejemplar nuevo (serial propio); no hay auto-salvage (no existe) — F62 no lo inventa",
  tiers: { minor: "XP, créditos < 500, puntos", standard: "1 sobre, ≥ 500 créditos, cosmético", major: "carta, ≥ 2 sobres, ≥ 2.000 créditos" },
  component: "src/components/rewards/RewardDisplay.tsx (+ domain/rewards/display.ts)",
});

w("idempotence.json", {
  server: ["claimMission ref mission:<temporada>:<id>:<tanda>:<baseline>", "claimPassLevel ref pass:<temporada>:<carril>:<nivel>", "claimAchievement ref achievement:<id> + PK user_achievements", "duelo ref duel:<matchId> (una partida terminada rechaza jugadas con 409 antes de pagar)"],
  tests: ["F62 IDEMPOT 01 (mismo reclamo ×10 → 1 pago, XP de temporada una vez)", "F62 IDEMPOT 02 (partida pagada ×10 → 1 concesión)", "F62 IDEMPOT 03 (5 lecturas → 0 escrituras)", "F41 ráfaga ×5 misma misión → 1 pago"],
  realQa: {
    run1DoubleClickClaimAll: play1.hubClaimAll, run1SecondClaimAll: play1.hubLevels,
    run2: play2.hubClaimAll, refreshCounts: play2.refreshCounts,
    dbDuplicateRefs: 0, db: "live/db-verify.txt",
  },
});

w("concurrency.json", {
  foundInRealQa: "Doble clic en «Reclamar todo» lanzó dos tandas: conflictos optimistas del pase (409); los pagos de w-victorias y s-mazo quedaron hechos (idempotentes) pero su XP de temporada no se guardó hasta reclamar de nuevo. Nunca se pagó dos veces (BD: 0 refs duplicadas).",
  fixes: ["servidor: withPassRetry (hasta 3 reintentos del reclamo entero; misma clave de pago)", "cliente: una tanda a la vez (useClaims.running) y botón bloqueado durante la tanda encadenada"],
  tests: ["F62 CONCURR 01 (dos pestañas «Reclamar todo» a la vez → todo reclamado en una ronda, XP de temporada exacta, 0 claves repetidas)", "F62 CONCURR 02 (dos concesiones distintas a la vez suman ambas; SQL `xp = xp + p_xp`)", "F41 misiones distintas simultáneas / nivel del pase ×2"],
  afterFix: { realQa: play2.hubClaimAll, consoleConflicts: (play2.consoleErrors ?? []).filter((e: string) => e.includes("409")).length },
});

w("security.json", {
  clientSends: "solo ids (missionId / level+track / achievementId); nunca cantidades, XP ni «completado»",
  serverChecks: ["misión completa con métricas del servidor (loadFacts)", "nivel alcanzado y carril abierto (PassEngine.claimReward)", "logro completo con serverProgressFor", "nivel fuera de 1..30 → 400"],
  tests: ["F62 SEGURIDAD 01 (id inventado, nivel no alcanzado/999/premium, logro incompleto/inventado → 0 créditos, 0 asientos, 0 XP)", "F62 SEGURIDAD 02 (la ruta no lee credits/xp/reward/complete/amount/userId)", "F62 · /progresion no concede XP y reclama solo por los reclamos existentes"],
  admin: "sin rutas nuevas de concesión; /admin/system solo LEE la salud de progresión",
});

w("runtime.json", {
  server: ":3005 next start (build final F62), HTTP 200; túnel SSH 54521/54522 abierto",
  qaAccount: play2.account,
  runs: { run1: { at: play1.at, match: play1.match, claimAll: play1.hubClaimAll, levels: play1.hubLevels }, run2: { at: play2.at, match: play2.match, claimAll: play2.hubClaimAll, home: play2.home, after: play2.after } },
  consoleErrors: { run2: play2.consoleErrors, note: "3 × 404 = vídeo de fondo de la portada (F46 «BACKGROUND VIDEO ASSET PENDING»), previo a F62" },
  dbVerify: existsSync(join(Q, "live/db-verify.txt")) ? readFileSync(join(Q, "live/db-verify.txt"), "utf8") : null,
});

const shotRows = (dir: string) => existsSync(join(Q, "screenshots", dir, "shots.json")) ? rd(join("screenshots", dir, "shots.json")).rows : [];
// La última medición de cada captura manda (las tandas se ordenan por nombre: f62 → f62b → f62c).
const harness = [...new Map(readdirSync(join(Q, "screenshots", "harness")).filter((f) => f.startsWith("shots-")).sort()
  .flatMap((f) => rd(join("screenshots", "harness", f)).rows).map((r: any) => [r.file, r] as const)).values()];
const real = [...shotRows("after"), ...shotRows("after-profile")];
w("visual-qa.json", {
  real: real.map((r: any) => ({ name: r.name, overflow: r.measure.over, broken: r.measure.broken.length, errors: r.errors.length })),
  harness: harness.map((r: any) => ({ file: r.file, overflow: r.measure?.overflowCount ?? null, broken: r.measure?.broken?.length ?? null, errors: r.errors.length })),
  before: shotRows("before").map((r: any) => ({ name: r.name, overflow: r.measure.over, errors: r.errors.length })),
  notes: [
    "portada: 3 × 404 del vídeo de fondo (F46), previo",
    "perfil 390: desbordaba 9 px en BEFORE (rejilla sin min-w-0) → 0 en AFTER",
    "un 429 aislado al navegar 15 páginas seguidas (instrumento): la captura sola da 0 errores (after-profile)",
    "reveal-minor 390 medía 6 desbordes por el aviso descentrado (framer-motion pisaba translate-x) → corregido, 0",
  ],
});
console.log("evidencia escrita");
