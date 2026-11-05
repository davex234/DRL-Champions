/**
 * FASE 63 · EVIDENCIA (instrumento `_`, fuera de CI). Compone los JSON del informe a partir de lo YA medido (ejecuciones
 * reales en `docs/product/qa/fase63-onboarding/*.json`, capturas y tests). No inventa cifras: lo que no está medido aquí
 * se cita con su fichero de origen.
 *
 *   npx tsx scripts/_fase63-evidence.ts
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_MARKET_ENABLED } from "../src/config/features";
import { PAYMENTS_ENABLED } from "../src/config/monetization";
import { TOTAL_CARDS } from "../src/data/catalog";
import { ONBOARDING_STEPS, STEP_DEFS, ONBOARDING_VERSION, GUIDE_FIRST_PACK, MATCH_HINTS } from "../src/domain/onboarding";

const OUT = join(process.cwd(), "docs/product/qa/fase63-onboarding");
const rd = (f: string) => (existsSync(join(OUT, f)) ? JSON.parse(readFileSync(join(OUT, f), "utf8")) : null);
const w = (f: string, o: unknown) => writeFileSync(join(OUT, f), JSON.stringify(o, null, 2));
const migrations = readdirSync(join(process.cwd(), "supabase/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

w("baseline.json", {
  at: "2026-09-26",
  git: { head: "48dac2a", branch: "arch/stabilization", note: "árbol con ~1.300 entradas sin commitear de fases anteriores (no se tocó nada fuera de F63)" },
  tests: { before: { total: 5208, pass: 5208, fail: 0 }, after: { total: 5262, pass: 5262, fail: 0 } },
  tsc: { web: "exit 0 (antes y después)", scripts: "exit 0 (antes y después)" },
  build: { before: "exit 0", after: "exit 0" },
  migrationHead: migrations[migrations.length - 1],
  liveDb: { contentCards: 331, agents: 29, publicTables: 122, accounts: 12, admins: 1, measuredVia: "ssh psql de solo lectura, 2026-09-26" },
  catalogCode: TOTAL_CARDS,
  flags: { GLOBAL_MARKET_ENABLED, PAYMENTS_ENABLED },
  accountsByActivity: { "matches>=2": 3, "matches=1": 1, "activity_no_match": 1, "no_activity": 7 },
  f61: "huella dorada del motor (F61 MOTOR 01) intacta: f61.match.test.tsx verde",
  f62: "/progresion hub + reclamos intactos; solo se añade el bloque de la guía encima",
});

w("old-ftue.json", {
  at: "2026-09-26",
  source: "old-ftue-walk.json (cuenta QA 93915dc0 registrada por /cuenta, build anterior a F63)",
  whatExisted: {
    provisioning: "trigger handle_new_user (0011): perfil (6.000 créditos), user_game, user_packs inicial×3 + estandar×1, asiento starter_grant. Una vez por cuenta.",
    stateStorage: "ninguno: recorrido F40 DERIVADO de hechos (domain/journey) dentro del Daily Loop; sin banderas, sin created_at",
    ui: "JourneyMissionControl/JourneyStrip/JourneyDiscovery (F40) solo en DailyLobby; CollectionCoach en /coleccion; coach en el constructor; FirstMatchCoach en la pre-partida",
    assist: "Sobre Inicial gratis asistido (F41) mientras no se puede formar equipo; tope 8",
  },
  findings: [
    { id: "P0-1", what: "La guía F40 era código muerto en la portada: desde F46 la home es MainMenu y no pinta `journey` (el servidor calculaba `journey-open` y nadie lo enseñaba)." },
    { id: "P0-2", what: "Tras registrarse, la cuenta se quedaba en /cuenta (perfil), no en el juego." },
    { id: "P1-1", what: "JUGAR → /jugar con cuatro modos marcados «EQUIPO NO VÁLIDO» sin decir cómo empezar." },
    { id: "P1-2", what: "3 × 404 en cada visita a la portada (poster, webm y mp4 del vídeo pendiente de F46)." },
    { id: "P1-3", what: "deckReadiness contaba un jugador con cartas de dos roles en ambos: 0,02 % de cuentas nuevas «listas» sin poder formar equipo, y sin Sobre Inicial gratis (callejón sin salida)." },
    { id: "P2-1", what: "Terminología mezclada en el camino: «mazo» (pre-partida y resultado), «plantilla» (guía y reglas) y «equipo» (resto)." },
    { id: "P2-2", what: "El coach de la colección hablaba solo de SH/GS/EF; la carta imprime DMG·SCR·FKS·HS·AST·CLU y no se explicaba la diferencia." },
    { id: "P2-3", what: "Ninguna explicación de ATACAS/DEFIENDES dentro de la partida; tras la primera partida, ninguna puerta a la progresión (F62)." },
  ],
  screens: (rd("old-ftue-walk.json")?.steps ?? []).map((s: { name: string; url: string; ctas: string[]; errors: string[] }) => ({ name: s.name, url: s.url, ctas: s.ctas.slice(0, 8), errors: s.errors.length })),
});

w("new-ftue.json", {
  version: ONBOARDING_VERSION,
  stateModel: "NOT_STARTED / IN_PROGRESS / COMPLETED derivado de hechos reales (JourneyFacts F40) + 3 acuses en auth.users.app_metadata.nx_onboarding (startedAt, skippedAt, finishedAt), escritos SOLO por el servidor",
  completion: ["FINISHED (SEGUIR JUGANDO)", "SKIPPED (Saltar tutorial)", "SELF_GUIDED (partidas sin haber pulsado EMPEZAR: cuentas anteriores)", "PLAYING (2+ partidas)"],
  steps: ONBOARDING_STEPS.map((id, i) => ({ index: i + 1, id, ...STEP_DEFS[id] })),
  firstPack: `${GUIDE_FIRST_PACK} (Bronce) y luego Iniciales — decisión por simulación, ver starter-contract.json`,
  matchHints: MATCH_HINTS,
  endpoints: { "GET /api/game/onboarding": "vista (lectura)", "POST /api/game/onboarding": "{ action: start|skip|resume|finish|first-team }", "GET /api/game/daily-loop": "añade `onboarding` (sin créditos: contrato F36)" },
  surfaces: ["portada (bienvenida, recursos, continúa tu inicio)", "/abrir (tu primera carta / siguiente paso)", "/coleccion (tus cartas)", "portada (crear equipo → equipo listo)", "/duelos/jugar (ayuda atacas/defiendes + resultado → progreso)", "/progresion (así avanzas + ya estás listo)", "franja «Tu inicio» en el resto de pantallas", "/como-jugar (guía sin estado)"],
});

const runs = ["new-user-e2e-1440.json", "new-user-e2e-reduced-390.json", "new-user-e2e-1440-run1.json"].map((f) => ({ f, j: rd(f) })).filter((x) => x.j);
w("new-user-e2e.json", {
  runs: runs.map(({ f, j }) => ({
    file: f, account: j.evidence.account, width: j.width, reduced: j.reduced,
    secondsToFirstMatch: j.evidence.secondsToFirstMatch, result: j.evidence.result?.kind ?? null, match: j.evidence.match,
    initial: j.evidence.initial, afterFirstPack: j.evidence.afterFirstPack, afterTeam: j.evidence.afterTeam, afterMatch: j.evidence.afterMatch, final: j.evidence.final,
    firstPack: j.evidence.firstPackRoute, firstCard: j.evidence.firstCard, hints: j.evidence.hints, timeline: j.evidence.timeline,
  })),
});

w("recovery.json", {
  live: runs.map(({ f, j }) => ({
    file: f,
    welcomeAfterF5: j.evidence.welcomeAfterF5, starterAfterF5: j.evidence.starterAfterF5,
    reloadDuringOpening: j.evidence.reloadDuringOpening, afterTeamF5: j.evidence.afterTeamF5,
    midMatchF5: j.evidence.midMatchF5, resultAfterF5: j.evidence.resultAfterF5,
  })),
  tests: ["onboarding.service.test.ts S05 (F5/pestañas → un solo equipo)", "onboarding.test.ts D13/D14 (repetir callbacks = mismo estado)"],
});

w("idempotence.json", {
  starterGrant: "Lo concede SOLO handle_new_user al insertar en auth.users (una vez por cuenta). Ninguna ruta de F63 toca user_packs, profiles.credits, credit_transactions, user_cards ni economy_ops (test D24 + S02 + S08).",
  tests: ["S02 · EMPEZAR ×1/×2/×10/paralelo ×10 → 0 escrituras en tablas del juego, 1 acuse", "S03 · TERMINAR repetido → mismo estado", "S05 · primer equipo ×2 y ×10 en paralelo → 1 equipo", "D13 · acuse escrito una vez"],
  live: { parallelStart: rd("security-live.json")?.parallelStart, parallelFirstTeamIdempotent: rd("multitab-idempotent-live.json")?.parallel, parallelFirstTeamRace: rd("multitab-race-live.json") },
});

w("security.json", {
  tests: ["D17 cuerpo estricto", "D14 finish exige partida real", "D24 el cliente de la guía no llama a sobres/recompensas; sin localStorage", "D25 app_metadata (servidor), nunca user_metadata", "S08 aislamiento entre cuentas", "S03 partida en curso/Draft no cuentan"],
  live: rd("security-live.json"),
  notes: [
    "«Marcar completado a mano»: el cliente SÍ puede escribir user_metadata (auth.updateUser); la guía solo lee app_metadata → estado sin cambios (probado en real).",
    "«Reclamar el starter otra vez»: no existe acción; la única vía de sobres gratis es la compra del Sobre Inicial (F41) → 409 «Ya tienes un Sobre Inicial por abrir».",
    "Sanciones (F58) siguen aplicando: POST /api/game/onboarding es una mutación bajo /api/game (getSession).",
  ],
});

w("existing-user-regression.json", {
  rule: "COMPLETED/SELF_GUIDED si hay partidas terminadas y la cuenta nunca pulsó EMPEZAR (no se usa created_at).",
  liveDbAccounts: "12 cuentas antes de la QA: 3 con ≥2 partidas + 1 con 1 partida → COMPLETED (sin guía); 1 con actividad sin partidas (QA qapacks) → guía en curso; 7 sin actividad (QA de fases antiguas) → bienvenida, como jugador nuevo, SIN conceder nada.",
  userAccount: { id: "2f86cbe8", matches: 10, status: "COMPLETED/SELF_GUIDED", writes: 0, verified: "fila idéntica antes/después de toda la QA (créditos, XP, cartas, equipos, partidas, libro mayor, app_metadata null, auth.updated_at)" },
  live: rd("existing-user-live.json"),
  tests: ["D10 cuentas reales", "D11 sin actividad", "U09 login solo redirige con la guía activa"],
});

const caps = runs.flatMap(({ f, j }) => j.captures.map((c: { name: string; w: number; reduced: boolean; measure: { over: number; hScroll: boolean; broken: string[] }; errors: string[] }) => ({ run: f, name: c.name, w: c.w, reduced: c.reduced, over: c.measure.over, hScroll: c.measure.hScroll, broken: c.measure.broken.length, errors: c.errors.length })));
const skip = rd("skip-live-1440.json");
const allCaps = [...caps, ...((skip?.captures ?? []).map((c: { name: string; w: number; measure: { over: number; hScroll: boolean; broken: string[] }; errors: string[] }) => ({ run: "skip-live-1440.json", name: c.name, w: c.w, reduced: false, over: c.measure.over, hScroll: c.measure.hScroll, broken: c.measure.broken.length, errors: c.errors.length })))];
w("visual-qa.json", {
  captures: allCaps.length,
  widths: [...new Set(allCaps.map((c) => c.w))],
  horizontalOverflow: allCaps.filter((c) => c.over > 0 || c.hScroll).length,
  brokenImages: allCaps.reduce((s, c) => s + c.broken, 0),
  consoleErrors: allCaps.reduce((s, c) => s + c.errors, 0),
  reducedMotion: allCaps.filter((c) => c.reduced).length,
  list: allCaps,
});
console.log("ok", allCaps.length, "capturas");
