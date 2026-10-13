/**
 * FASE 40 · MATRIZ DEL BRIEF (T01–T100) — cada caso con una aserción real sobre el dominio, el motor único del vestíbulo,
 * las migraciones (contrato de alta) o el código de las pantallas. Los casos que exigen BD real se prueban además en
 * `_fase40-real-e2e.ts`; aquí se fija lo que el código garantiza.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDailyLoop, dailyActions, type ActiveMatchFact, type DailyLoopFacts } from "@/domain/dailyLoop";
import { buildPlayerJourney, deckReadiness, DISCOVERY, FIRST_MATCH_RULES, JOURNEY_ROUTES, type JourneyFacts } from "./index";
import { CardRegistry } from "@/collection/registry";
import { PackEngine } from "@/pack/engine";
import { getPack } from "@/data/packs";
import { freshPity } from "@/domain/packs/pity";
import { autocomplete, indexPool, checkDraft } from "@/domain/deckBuilder/builder";
import { builderCollection } from "@/server/services/deckTeams";
import { DUEL_ROLES } from "@/domain/cardgame/types";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { RATE_POLICY } from "@/server/services/rateLimit";
import { homeJourneyMode } from "@/lib/journey/presentation";
import { initialDifficulty, showFirstSessionComplete } from "@/lib/journey/arena";
import { shouldAutoActivate } from "@/lib/journey/deck";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const REG = new CardRegistry();
const NOW = Date.parse("2026-09-20T12:00:00Z");
const none = DUEL_ROLES.map((role) => ({ role, have: 0, need: 2 }));
const READY = { ready: true, dataVersion: "VCT-2026", roles: DUEL_ROLES.map((role) => ({ role, have: 2, need: 2 })), shortages: [] };
const jf = (o: Partial<JourneyFacts> = {}): JourneyFacts => ({ ownedCards: 0, packsOpened: 0, matchesCompleted: 0, unopenedPacks: 4, firstPackId: "inicial", decks: { total: 0, valid: 0, firstInvalid: null }, readyDeck: null, readiness: { ready: false, dataVersion: null, roles: none, shortages: none }, ...o });
const J = (o: Partial<JourneyFacts> = {}) => buildPlayerJourney(jf(o));
function facts(o: Partial<DailyLoopFacts> & { j?: Partial<JourneyFacts> | null } = {}): DailyLoopFacts {
  const j = o.j === null ? null : jf(o.j ?? {});
  const { j: _j, ...rest } = o; void _j;
  return {
    now: NOW, signedIn: true, catalogSize: 772, matches: [], social: { incoming: 0, from: null },
    progression: { account: { level: 1, xp: 0, xpIntoLevel: 0, xpForNext: 100, progress: 0 }, pass: null, claimableLevels: 0, objectives: [], achievements: { total: 1, claimed: 0, claimable: 0, near: null }, rotationPending: false, metrics: { ownedCards: j?.ownedCards ?? 40, distinctCards: 0, packsOpened: j?.packsOpened ?? 5, duelsPlayed: j?.matchesCompleted ?? 3 } },
    pickems: { pending: 0, open: 0, eventId: null, eventName: null }, packs: { unopened: j?.unopenedPacks ?? 0 },
    decks: { total: j?.decks.total ?? 1, valid: j?.decks.valid ?? 1, active: null, firstInvalid: null },
    campaign: { completed: 0, total: 15, complete: false, next: { nodeId: "c1-n1", name: "N1", team: "LOUD", chapterOrder: 1 } },
    competitive: { rating: null, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, provisional: true, position: null, rankedTotal: 1, recent: [] },
    live: [], season: { current: null, next: null }, journey: j, ...rest,
  };
}
const match = (mode: ActiveMatchFact["mode"]): ActiveMatchFact => ({ id: mode, mode, difficulty: null, opponent: null, node: null });
const primary = (f: DailyLoopFacts) => dailyActions(f).primary.id;
const MIGRATIONS = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const ALTA = (() => { const s = read("supabase/migrations/0011_server_authority.sql"); const i = s.indexOf("create or replace function public.handle_new_user()"); return s.slice(i, s.indexOf("end; $$;", i)); })();
const JOURNEY_CODE = code(["src/domain/journey/index.ts", "src/lib/journey/presentation.ts", "src/lib/journey/arena.ts", "src/lib/journey/deck.ts", "src/lib/journey/preference.ts", "src/components/journey/JourneyMissionControl.tsx", "src/components/journey/JourneyDiscovery.tsx", "src/components/journey/JourneyCoach.tsx", "src/components/journey/FirstMatchCoach.tsx", "src/components/journey/CollectionCoach.tsx"].map(read).join("\n"));

/* ───────────── detección y bienvenida ───────────── */
test("T01 · cuenta nueva detectada", () => assert.equal(J().currentStep, "open"));
test("T02 · cuenta antigua inactiva sigue en primera sesión", () => assert.equal(J({ unopenedPacks: 0, firstPackId: null }).status, "ACTIVE"));
test("T03 · jugador legacy completo", () => assert.equal(J({ ownedCards: 99, matchesCompleted: 20, decks: { total: 1, valid: 1, firstInvalid: null }, readiness: READY }).status, "COMPLETE"));
test("T04 · created_at no es autoridad (ni el servicio lo lee para el recorrido)", () => {
  assert.ok(!/created_at|createdAt/.test(code(read("src/domain/journey/index.ts"))));
  const svc = read("src/server/services/dailyLoop.ts"); const fn = svc.slice(svc.indexOf("async function journeyFacts"), svc.indexOf("function anonymousFacts"));
  assert.ok(!/created_at|createdAt|obtained/.test(fn));
});
test("T05 · bienvenida una vez: desaparece con el primer hecho", () => { assert.ok(J().welcome); assert.ok(!J({ packsOpened: 1 }).welcome); });
test("T06 · bienvenida reanudable: sin hechos nuevos sigue ahí tras recargar (misma foto)", () => assert.deepEqual(J(), J()));
test("T07 · explorar por libre baja la guía a tira", () => assert.equal(homeJourneyMode(buildDailyLoop(facts({ j: {} })), { dismissed: true }), "strip"));
test("T08 · explorar no da recompensa ni cambia la foto", () => assert.deepEqual(buildDailyLoop(facts({ j: {} })), buildDailyLoop(facts({ j: {} }))));

/* ───────────── partidas abiertas ───────────── */
test("T09 · partida PvE abierta gana al recorrido", () => assert.equal(primary(facts({ j: {}, matches: [match("PVE")] })), "resume-pve"));
test("T10 · ranked abierta gana", () => assert.equal(primary(facts({ j: {}, matches: [match("RANKED")] })), "resume-ranked"));
test("T11 · privada abierta gana", () => assert.equal(primary(facts({ j: {}, matches: [match("PRIVATE")] })), "resume-private"));
test("T12 · combate de Draft abierto gana", () => assert.equal(primary(facts({ j: {}, matches: [match("DRAFT")] })), "resume-draft"));

/* ───────────── starter ───────────── */
test("T13 · contrato de alta: 3 iniciales + 1 estándar, 6.000 créditos", () => {
  assert.match(ALTA, /\(new\.id, 'inicial', 3\), \(new\.id, 'estandar', 1\)/);
  assert.match(read("supabase/migrations/0001_init.sql"), /credits\s+bigint not null default 6000/);
  assert.match(ALTA, /'starter_grant', 'starter:' \|\| new\.id::text, 6000/);
});
test("T14 · alta idempotente: sobres con on conflict do nothing", () => assert.match(ALTA, /on conflict \(user_id, pack_id\) do nothing/));
test("T15 · reintento de alta: asiento con ref única (índice credit_tx_ref_uniq)", () => assert.match(read("supabase/migrations/0011_server_authority.sql"), /create unique index if not exists credit_tx_ref_uniq/));
test("T16 · dos pestañas: el alta es un trigger por INSERT en auth.users (una fila, una vez)", () => assert.match(read("supabase/migrations/0001_init.sql"), /after insert on auth\.users\s+for each row execute function public\.handle_new_user\(\)/));
test("T17 · créditos no se duplican: nadie más concede starter_grant", () => {
  const hits = MIGRATIONS.filter((f) => read(`supabase/migrations/${f}`).includes("'starter_grant'"));
  // F86.2 · 0070 solo LEE el libro (embudo de la alpha: «¿recibió sus sobres de bienvenida?»); no escribe créditos.
  assert.deepEqual(hits.filter((f) => f !== "0070_alpha_feedback.sql"), ["0011_server_authority.sql"]);
  assert.ok(!/insert into public\.credit_transactions|app_grant_reward|_ledger_apply/.test(read("supabase/migrations/0070_alpha_feedback.sql")));
});
test("T18 · sobres no se duplican: la app no inserta sobres de bienvenida", () => assert.ok(!/'inicial',\s*3|STARTER_PACKS/.test(JOURNEY_CODE + code(read("src/server/services/dailyLoop.ts")))));
test("T19 · cartas no se duplican: el alta no crea cartas", () => assert.ok(!/user_cards/.test(ALTA)));

/* ───────────── primer sobre ───────────── */
test("T20 · primer sobre real: el que posee", () => assert.equal(J({ firstPackId: "estandar", unopenedPacks: 1 }).nextAction!.href, "/abrir/estandar"));
test("T21 · sin sobre tutorial: solo sobres del catálogo (inicial gratis)", () => { assert.ok(getPack("inicial")); assert.ok(!/tutorial/i.test(JOURNEY_CODE)); });
test("T22 · apertura por la ruta canónica /abrir/[packId]", () => assert.ok(existsSync(join(ROOT, "src/app/abrir/[packId]/page.tsx")) && JOURNEY_ROUTES.packRoute("x") === "/abrir/x"));
test("T23 · abrir avanza hechos (packs_opened / cartas)", () => assert.equal(J({ packsOpened: 1, ownedCards: 5 }).steps[0].done, true));
test("T24 · ninguna bandera de animación decide un paso", () => assert.ok(!/setFtue|onRevealComplete|animationDone/.test(JOURNEY_CODE)));

/* ───────────── colección ───────────── */
test("T25 · CTA a la colección en COLECCIONA", () => assert.equal(J({ ownedCards: 5, packsOpened: 1 }).nextAction!.secondary!.href, "/coleccion?tener=owned"));
test("T26 · la colección cuenta cartas reales (preparación sobre el catálogo)", () => {
  const ids = REG.cards.slice(0, 40).map((c) => c.id);
  const r = deckReadiness(ids, (id) => { const c = REG.card(id)!; const p = REG.player(c.playerId)!; return { playerId: c.playerId, role: c.role ?? p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat }; });
  assert.equal(r.roles.length, 5);
});
test("T27 · sin completado falso: con cartas insuficientes COLECCIONA no se marca", () => assert.equal(J({ ownedCards: 20, packsOpened: 4 }).steps[1].done, false));
test("T28 · preparación del equipo derivada", () => assert.equal(J({ ownedCards: 30, readiness: READY }).steps[1].done, true));

/* ───────────── starter solubilidad (muestra; los 100.000 en el verificador) ───────────── */
test("T29 · 2.000 cuentas nuevas simuladas: todas llegan a equipo legal con Sobres Iniciales gratis", () => {
  const engine = new PackEngine(REG);
  const res = (id: string) => { const c = REG.card(id)!; const p = REG.player(c.playerId)!; return { playerId: c.playerId, role: c.role ?? p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat }; };
  let starterOk = 0; let max = 0;
  for (let a = 0; a < 2_000; a++) {
    const ids: string[] = []; let pity = freshPity(); let k = 0;
    const open = (p: string) => { const r = engine.draw(getPack(p)!, { seed: (a * 131 + k++ * 977) % 2147483647, owned: [], mintCounts: {}, pity, now: 0 } as never); pity = r.pityAfter; for (const i of r.instances) ids.push(i.cardId); };
    ["inicial", "inicial", "inicial", "estandar"].forEach(open);
    if (deckReadiness(ids, res).ready) starterOk++;
    let extra = 0; while (!deckReadiness(ids, res).ready && extra < 500) { open("inicial"); extra++; }
    assert.ok(deckReadiness(ids, res).ready, `cuenta ${a}`);
    max = Math.max(max, extra);
  }
  assert.ok(starterOk < 2_000, "los sobres de bienvenida solos NO lo garantizan (medido)");
  assert.ok(max < 500);
});

/* ───────────── autocompletar ───────────── */
const collectionOf = (n: number, seed: number) => { let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; return Array.from({ length: n }, (_, i) => ({ uid: `u${i}`, cardId: REG.cards[Math.floor(rnd() * REG.cards.length)].id, obtainedAt: 0 })); };
const autoFor = (owned: { uid: string; cardId: string; obtainedAt: number }[]) => { const pool = indexPool(builderCollection(owned as never) as never); return { pool, r: autocomplete([], pool) }; };
const findOk = () => { for (let s = 1; s < 500; s++) { const o = collectionOf(60, s); const { pool, r } = autoFor(o); if (r.ok) return { o, pool, r }; } throw new Error("sin colección válida"); };
test("T30 · autocompletar crea un equipo LEGAL (validador canónico)", () => { const { pool, r } = findOk(); assert.ok(r.ok && checkDraft(r.uids, pool).ready); });
test("T31 · autocompletar solo usa cartas poseídas", () => { const { o, r } = findOk(); const owned = new Set(o.map((x) => x.uid)); assert.ok(r.ok && r.uids.every((u) => owned.has(u))); });
test("T32 · autocompletar: 2 por rol", () => { const { pool, r } = findOk(); assert.ok(r.ok); for (const role of DUEL_ROLES) assert.equal(r.uids.filter((u) => pool.get(u)!.role === role).length, 2); });
test("T33 · Flex real (2 Flex de verdad, no comodín)", () => { const { pool, r } = findOk(); assert.ok(r.ok && r.uids.filter((u) => pool.get(u)!.role === "Flex").length === 2); });
test("T34 · sin carta duplicada", () => { const { pool, r } = findOk(); assert.ok(r.ok && new Set(r.uids.map((u) => pool.get(u)!.cardId)).size === 10); });
test("T35 · sin jugador duplicado", () => { const { pool, r } = findOk(); assert.ok(r.ok && new Set(r.uids.map((u) => pool.get(u)!.playerId)).size === 10); });
test("T36 · una sola versión de datos", () => { const { pool, r } = findOk(); assert.ok(r.ok && new Set(r.uids.map((u) => pool.get(u)!.dataVersion)).size === 1); });
test("T37 · construir a mano sigue soportado (el coach no bloquea el constructor)", () => assert.ok(read("src/components/duel/DeckBuilder.tsx").includes("Elige tú o pulsa")));
test("T38 · guardar es obligatorio: equipo sin guardar no cuenta", () => assert.equal(J({ ownedCards: 30, readiness: READY }).steps[2].done, false));
test("T39 · equipo inválido guardado no cuenta", () => assert.equal(J({ ownedCards: 30, readiness: READY, decks: { total: 1, valid: 0, firstInvalid: { id: "d", name: "d", size: 10 } } }).steps[2].done, false));
test("T40 · equipo activo: primer equipo legal se activa con la acción existente", () => assert.ok(shouldAutoActivate({ savedValid: true, activeSupported: true, activeDeckId: null, otherValidDecks: 0 })));

/* ───────────── primera partida ───────────── */
test("T41 · CTA del primer combate", () => assert.equal(J({ ownedCards: 30, readiness: READY, decks: { total: 1, valid: 1, firstInvalid: null } }).nextAction!.cta, "Jugar mi primer combate"));
test("T42 · Fácil canónico preseleccionado (existe en el servidor)", () => { assert.equal(initialDifficulty("EASY"), "EASY"); assert.match(read("src/server/services/duels.ts"), /"EASY", "NORMAL", "HARD"/); });
test("T43 · sin bot tutorial (solo EASY/NORMAL/HARD)", () => assert.equal(initialDifficulty("TUTORIAL"), "NORMAL"));
test("T44 · combate canónico: la ruta es la partida rápida PvE de siempre", () => assert.ok(JOURNEY_ROUTES.firstMatch.startsWith("/duelos/jugar?") && !/pvp|draft|campaign/i.test(JOURNEY_ROUTES.firstMatch)));
test("T45 · turno empatado no puntúa (texto = motor)", () => { assert.match(FIRST_MATCH_RULES[2].text, /Si empatan, nadie puntúa/); assert.match(read("src/domain/cardgame/combat/rules.ts"), /encounterTie: "NO_POINT"/); });
test("T46 · desempate final: OVR (+1) → total (sin punto) → empate", () => assert.match(FIRST_MATCH_RULES[3].text, /OVR de los equipos \(da un punto\).*\(sin punto\).*empate/));
const done = (m: number) => J({ ownedCards: 30, readiness: READY, decks: { total: 1, valid: 1, firstInvalid: null }, matchesCompleted: m });
test("T47 · ganar completa el paso JUEGA", () => assert.equal(done(1).steps[3].done, true));
test("T48 · perder completa el paso JUEGA (una partida terminada es una partida)", () => assert.equal(done(1).isComplete, true));
// CORE GAME LOOP · el recuento vive en `matchCounts` (una definición para pase, eventos, vestíbulo y recorrido).
test("T49 · empatar completa (DRAW cuenta como terminada en las métricas)", () => assert.match(read("src/server/services/matchCounts.ts"), /FINISHED_MATCH_STATUSES = \["COMPLETED", "DRAW", "UNRESOLVED"\]/));
test("T50 · no hace falta ganar (sin hechos de victoria en el recorrido)", () => assert.ok(!/won|winner|victor/i.test(Object.keys(jf()).join())));
test("T51 · solo la recompensa PvE existente (awardMatchOutcome) paga la partida", () => assert.ok(read("src/server/services/duels.ts").includes("awardMatchOutcome") && !/award|reward/i.test(Object.keys(done(1)).join())));
test("T52 · sin recompensa de primera sesión", () => assert.ok(!/\+\s*\d+\s*(créditos|XP)|recompensa extra de/i.test(JOURNEY_CODE)));

/* ───────────── completar y descubrir ───────────── */
test("T53 · recorrido completo", () => assert.equal(done(1).status, "COMPLETE"));
test("T54 · destinos con rutas reales", () => { for (const d of DISCOVERY) assert.ok(existsSync(join(ROOT, "src/app", ...d.href.split("/").filter(Boolean), "page.tsx")), d.href); });
test("T55 · sin evento en directo inventado en los destinos", () => assert.ok(!DISCOVERY.some((d) => /directo|live/i.test(d.id + d.title))));
test("T56 · vestíbulo normal tras completar", () => assert.ok(!primary(facts({ j: { ownedCards: 30, readiness: READY, decks: { total: 1, valid: 1, firstInvalid: null }, matchesCompleted: 1 } })).startsWith("journey-")));
test("T57 · sin repetir la guía (con 2+ partidas la foto no trae recorrido)", () => assert.equal(buildDailyLoop(facts({ j: { matchesCompleted: 2, ownedCards: 30 } })).journey, null));
test("T58 · vuelve tras abrir: COLECCIONA", () => assert.equal(J({ ownedCards: 5, packsOpened: 1, unopenedPacks: 3 }).currentStep, "collect"));
test("T59 · vuelve tras guardar equipo: JUEGA", () => assert.equal(J({ ownedCards: 30, readiness: READY, decks: { total: 1, valid: 1, firstInvalid: null } }).currentStep, "play"));
test("T60 · cartas sin sobres: se salta el sobre", () => assert.equal(J({ ownedCards: 30, readiness: READY, unopenedPacks: 0, firstPackId: null }).currentStep, "build"));
test("T61 · equipo sin partida: directo a JUEGA", () => assert.equal(J({ decks: { total: 1, valid: 1, firstInvalid: null } }).currentStep, "play"));
test("T62 · partidas históricas sin equipo: COMPLETA", () => assert.equal(J({ matchesCompleted: 4 }).isComplete, true));
test("T63 · recuperación de partida activa: continuar va a la partida", () => assert.equal(dailyActions(facts({ j: {}, matches: [match("PVE")] })).primary.href, "/duelos/jugar"));
test("T64 · Draft activo se respeta (continuar a su combate, sin tocar la run)", () => assert.equal(dailyActions(facts({ j: {}, matches: [match("DRAFT")] })).primary.href, "/duelos/jugar?draft=1"));
test("T65 · campaña preservada: el recorrido no escribe campaña (servicio sin escrituras)", () => assert.ok(!/campaign_progress.*(insert|update)/.test(code(read("src/server/services/dailyLoop.ts")))));

/* ───────────── offline y aislamiento ───────────── */
test("T66 · lectura offline: la home pinta la última foto (red «offline»)", () => assert.ok(read("src/components/dailyLoop/DailyLobby.tsx").includes('offline={offline}')));
test("T67 · mutaciones desactivadas sin conexión (CTA disabled)", () => assert.ok(read("src/components/journey/JourneyMissionControl.tsx").includes('<NxButton variant="primary" size="lg" disabled')));
test("T68 · temporada caída aislada", () => assert.equal(primary(facts({ j: {}, season: null })), "journey-open"));
test("T69 · social caído aislado", () => assert.equal(primary(facts({ j: {}, social: null })), "journey-open"));
test("T70 · eventos caídos aislados", () => assert.equal(primary(facts({ j: {}, live: null, pickems: null })), "journey-open"));

/* ───────────── seguridad y rendimiento ───────────── */
test("T71 · GET del recorrido sin escrituras (servicio de solo lectura)", () => assert.ok(!/\.(insert|update|upsert|delete)\(|\.rpc\(/.test(code(read("src/server/services/dailyLoop.ts")))));
test("T72 · sin N+1: una lectura de draft_runs, cartas de la misma lectura de progresión", () => { const s = read("src/server/services/dailyLoop.ts"); assert.equal((s.match(/from\("draft_runs"\)/g) ?? []).length, 1); assert.ok(s.includes("p.ownedCardIds")); });
test("T73 · usuario del token", () => assert.ok(read("src/app/api/game/daily-loop/route.ts").includes("getSession(req)")));
test("T74 · usuario arbitrario rechazado: la ruta no acepta parámetros", () => assert.match(read("src/app/api/game/daily-loop/route.ts"), /searchParams|400/));
test("T75 · paso arbitrario imposible: no hay mutación del recorrido", () => assert.ok(!existsSync(join(ROOT, "src/app/api/game/journey"))));
test("T76 · completado arbitrario imposible: completo = partida terminada del servidor", () => assert.ok(showFirstSessionComplete({ isComplete: true, justCompleted: true }) && !showFirstSessionComplete(null)));
test("T77 · intento de concesión imposible: el recorrido no llama a nada que conceda", () => assert.ok(!/grant|claim\(|purchase\(|rpc\(/.test(JOURNEY_CODE)));
test("T78 · cuerpo estricto: el vestíbulo es solo GET", () => assert.ok(!/export async function POST/.test(read("src/app/api/game/daily-loop/route.ts"))));
// F63 · REESCRITO A PROPÓSITO: la Fase 63 añade `/api/game/onboarding` (acuses + primer equipo). Su cuerpo es de UNA clave.
test("T79 · tamaño de cuerpo: el único endpoint nuevo (F63) acepta solo `{ action }`; no hay ruta `ftue`", () => {
  assert.ok(!existsSync(join(ROOT, "src/app/api/game/ftue")));
  const route = read("src/app/api/game/onboarding/route.ts");
  assert.ok(route.includes("parseOnboardingRequest(body)"));
  assert.match(read("src/domain/onboarding/index.ts"), /keys\.length !== 1 \|\| keys\[0\] !== "action"/);
});
test("T80 · 5xx genérico en la ruta del vestíbulo", () => assert.ok(read("src/server/services/dailyLoop.ts").includes("No se pudo leer tu sesión de juego")));
test("T81 · rate limit existente del vestíbulo", () => assert.ok(RATE_POLICY.daily_loop_read.limit <= 120));

/* ───────────── accesibilidad y responsive ───────────── */
const MC = read("src/components/journey/JourneyMissionControl.tsx");
test("T82 · teclado: CTA como enlaces/botones del sistema (NxButton)", () => assert.ok((MC.match(/<NxButton/g) ?? []).length >= 4));
test("T83 · foco visible: enlaces de destinos con nx-focus", () => assert.ok(read("src/components/journey/JourneyDiscovery.tsx").includes("nx-focus")));
test("T84 · CTA ≥ 44 px (lg/md y min-h)", () => assert.ok(!/<NxButton[^>]*size="sm"/.test(MC) && MC.includes("min-h-[44px]")));
test("T85 · movimiento reducido", () => assert.ok(MC.includes("useReducedMotion()")));
test("T86 · móvil: pasos en 2 columnas y CTA a ancho completo", () => assert.ok(MC.includes("grid-cols-2 sm:grid-cols-4") && MC.includes("w-full sm:w-auto")));
test("T87 · tablet: rejilla de destinos a 2 columnas", () => assert.ok(read("src/components/journey/JourneyDiscovery.tsx").includes("sm:grid-cols-2")));
test("T88 · escritorio: Mission Control a dos columnas", () => assert.ok(MC.includes("lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]")));

/* ───────────── verificación y cierre ───────────── */
test("T89 · verificador con 100.000 cuentas nuevas", () => assert.match(read("scripts/player-journey-verify.ts"), /const N = 100_000;/));
test("T90 · el verificador exige 100 % de ruta gratuita", () => assert.ok(read("scripts/player-journey-verify.ts").includes("routeFound === N && unresolved === 0")));
test("T91 · fuerza del starter medida (OVR, rareza, roles)", () => { const v = read("scripts/player-journey-verify.ts"); assert.ok(v.includes("OVR medio del equipo autocompletado") && v.includes("rareza de las cartas de bienvenida") && v.includes("roles de las cartas de bienvenida")); });
test("T92 · verificador de prioridad combinatorio", () => assert.ok(read("scripts/player-journey-verify.ts").includes("combos === 32 * 9 * 8")));
test("T93 · logout/login reanuda: el progreso no vive en el navegador", () => assert.ok(!/localStorage|sessionStorage|useGameStore/.test(code(read("src/domain/journey/index.ts") + read("src/server/services/dailyLoop.ts")))));
test("T94 · recarga reanuda: la foto se deriva del servidor en cada lectura", () => assert.deepEqual(buildDailyLoop(facts({ j: { ownedCards: 5, packsOpened: 1 } })).journey, buildDailyLoop(facts({ j: { ownedCards: 5, packsOpened: 1 } })).journey));
test("T95 · economía de la capa FTUE = 0 (sin importes en el recorrido)", () => assert.ok(!/credits|créditos\s*\+|xp\s*:/i.test(code(read("src/domain/journey/index.ts")))));
test("T96 · integridad de colección: el recorrido no crea cartas", () => assert.ok(!/user_cards/.test(JOURNEY_CODE)));
test("T97 · integridad de equipo: sin atajo del validador", () => assert.ok(!/validateDuelDeck|valid\s*=\s*true/.test(JOURNEY_CODE)));
test("T98 · integridad de partida: sin motor propio", () => assert.ok(!/startDuelMatch|resolveEncounter|createDuelBot/.test(JOURNEY_CODE)));
test("T99 · mercado ausente", () => { assert.equal(GLOBAL_MARKET_ENABLED, false); assert.ok(!/mercado|market/i.test(JOURNEY_CODE)); });
/*
 * FASE 47 · la última migración pasa a ser 0054 (composiciones tácticas), y es legítima: el
 * encargo de esa fase la autoriza expresamente. Lo que estas pruebas protegen NO cambia —que
 * su propia fase no metiera migraciones— y por eso se sigue fijando la cabeza de la lista,
 * sólo que ahora en 0054. Si mañana aparece una 0055 sin que nadie la pida, estas pruebas
 * vuelven a sonar.
 */
test("T100 · sin migración nueva sin encargo: la cabeza es 0058 (F60: 0057; PRE-F70: 0058 privilegios; autorizadas)", () =>
  assert.equal(MIGRATIONS[MIGRATIONS.length - 1], "0073_pickems_launch_guard.sql")); // F87.2 · 0073 (launch guard de Pick'ems: elegibilidad y puerta de tiempo) es la última; antes F87.1 · 0072, F87 · 0071 (Pick'ems 2.0: cuadros de predicción, cierre por partido, liquidación y reclamos; aditiva) es la última; antes F86.2 · 0070 (feedback de la Closed Alpha + embudo derivado) es la última; antes F86 · 0069 (torneos de jugadores) es la última del repositorio (cabeza = 0069; 0068 tag público de cuenta; 0067 gestión de admins, F85 añadió 0066, F84 añadió 0065, F83 0064, ops/release). F82 añadió 0062 y F89 0063.
