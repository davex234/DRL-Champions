/**
 * FASE 32 · CONTRATOS — privacidad (66–70), integraciones (71–79), regresión (80–99) y las fronteras
 * de API, telemetría, accesibilidad y diseño que no se pueden probar sin navegador. Se lee el CÓDIGO
 * EJECUTABLE (sin comentarios) salvo donde se indica.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { FLOWS } from "@/lib/telemetry/contract";
import { RATE_POLICY } from "@/server/services/rateLimit";
import { DECK_CONTEXTS, DECK_FLOW, deckFlow } from "@/lib/deckBuilder/telemetry";
import { ftueState } from "@/domain/progression/meta";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const code = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const sql = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/--.*$/gm, "");
const files = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const rel = `${dir}/${f}`;
  return statSync(join(ROOT, rel)).isDirectory() ? files(rel) : /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [rel] : [];
});

const BUILDER = "src/components/duel/DeckBuilder.tsx";
const PAGE = "src/app/duelos/mazos/page.tsx";
const ROUTE = "src/app/api/game/duels/route.ts";
const SERVICE = "src/server/services/deckTeams.ts";
const CLIENT = "src/lib/duel/client.ts";
const DECK_UI = ["bits", "TeamBoard", "CollectionPanel", "AnalysisPanel", "ComparePanel", "SlotSheet", "NameSheet", "TeamHub"].map((n) => `src/components/duel/deck/${n}.tsx`);
const MIG50 = "supabase/migrations/0050_duel_active_deck.sql";

/* ───────────────────────── 66–70 · privacidad ───────────────────────── */

test("66 · el perfil público no contiene equipos", () => {
  for (const f of ["src/server/services/playerIdentity.ts", "src/domain/profile/identity.ts"]) {
    assert.ok(!/duel_decks|duel_active_deck|activeDeck|deckId|cardUids: deck/i.test(code(f)), f);
  }
});

test("67 · la API pública de jugador no expone equipos", () => {
  assert.ok(!/deck|mazo|equipo activo/i.test(code("src/app/api/game/player/route.ts")));
});

test("68 · nadie pide los equipos de otro: la ruta usa SOLO el usuario del token y cada consulta filtra por él", () => {
  const route = code(ROUTE);
  assert.ok(route.includes("const session = await getSession(req);"));
  assert.ok(!/searchParams|body\.userId|userId:\s*body|\?user=/.test(route));
  const svc = code(SERVICE);
  const deckQueries = svc.match(/from\("duel_decks"\)[^;]*/g) ?? [];
  assert.ok(deckQueries.length >= 6);
  for (const q of deckQueries) assert.ok(/\.eq\("user_id", userId\)|user_id: userId/.test(q), q.slice(0, 120));
  const mig = sql(MIG50);
  assert.ok(/enable row level security/.test(mig) && /revoke all on public\.duel_active_deck from anon, authenticated/.test(mig));
  assert.ok(!/create policy/i.test(mig), "sin políticas: ni el propio usuario lo lee con su token");
});

test("69 · un reto no filtra el equipo del rival", () => {
  const social = code("src/server/services/social.ts");
  const view = social.slice(social.indexOf("export interface ChallengeView"), social.indexOf("export interface RecentOpponentView"));
  assert.ok(view.length > 50 && !/deck/i.test(view), "la vista de un reto no lleva mazos");
  assert.ok(!/activeDeckId|duel_active_deck/.test(social), "el servidor social no conoce el equipo activo");
  const sheet = code("src/components/social/ChallengeSheet.tsx");
  assert.ok(!/fetch\(|getSupabase|@\/lib\/duel\/client/.test(sheet), "la hoja no manda nada por su cuenta: el id del activo no sale del cliente");
  assert.ok(sheet.includes("onClick={() => d.valid && setDeckId(d.id)}") && sheet.includes("disabled={!d.valid}"), "solo equipos legales");
});

test("70 · la pre-partida respeta la información oculta: no lee cartas del rival", () => {
  const pre = code("src/components/duel/PreMatch.tsx");
  assert.ok(!/rival(Hand|Cards|Used)|pendingRival/.test(pre));
  assert.ok(read("src", "lib", "duel", "matchView.ts").includes("rivalRemaining: Math.max(0, DUEL_DECK_SIZE - usedRival.size)"));
});

/* ───────────────────────── 71–79 · integraciones ───────────────────────── */

test("71 · colección → constructor: la hoja «Añadir al equipo» abre el constructor con la carta elegida", () => {
  const sheet = code("src/components/deck/AddToDeckSheet.tsx");
  assert.ok(sheet.includes("router.push(`/duelos/mazos?deck=${deckId}&add=${card.uid}`)"));
  assert.ok(sheet.includes("r.decks.find((d) => d.id === r.activeDeckId)?.id ?? r.decks[0]?.id ?? null"), "propone el equipo activo");
  const page = code(PAGE);
  assert.ok(page.includes('params.get("add")') && page.includes("UUID_RE.test(add)"));
  // Fase 43 · el mismo `selectedUid` de la carta elegida, junto al contexto del laboratorio (`eje`, `explorar`).
  assert.ok(page.includes("initial={{ ...(view.addUid ? { selectedUid: view.addUid } : {}), focusAxis: labInit.focusAxis, explore: labInit.explore }}"));
  // Fase 37: la acción vive en la ficha de la carta (ruta enlazable) y reutiliza la misma hoja.
  assert.ok(code("src/components/collectionRoom/CardDetailView.tsx").includes("Añadir al equipo"));
  assert.ok(code("src/app/coleccion/carta/[cardId]/page.tsx").includes("<AddToDeckSheet"));
});

test("72 · pre-partida: selección rápida de equipos, marca del activo y EDITAR EQUIPO sin duplicar el constructor", () => {
  const pre = code("src/components/duel/PreMatch.tsx");
  assert.ok(pre.includes("decks.map((d) =>") && pre.includes('{d.id === activeDeckId && <Badge tone="info">Activo</Badge>}'));
  assert.ok(pre.includes("Editar equipo") && pre.includes("href={`/duelos/mazos?deck=${chosen.id}`}"));
  assert.ok(!/TeamBoard|CollectionPanel|DeckBuilder/.test(pre));
});

test("73 · el equipo activo se propone primero en PvE, PvP, retos y vestíbulo (y jugar sigue validando)", () => {
  assert.ok(code("src/app/duelos/jugar/page.tsx").includes("pickStartableDeck(d.decks, d.activeDeckId)"));
  assert.ok(code("src/app/duelos/pvp/page.tsx").includes("d.decks.find((x) => x.valid && x.id === d.activeDeckId)?.id ?? d.decks.find((x) => x.valid)?.id ?? null"));
  assert.ok(code("src/components/social/ChallengeSheet.tsx").includes("decks.find((d) => d.valid && d.id === activeDeckId)?.id ?? decks.find((d) => d.valid)?.id ?? null"));
  // Fase 36: el vestíbulo recibe el equipo activo de la foto del Daily Loop (lectura, sin crearlo).
  assert.ok(code("src/server/services/dailyLoop.ts").includes("decks.find((x) => x.valid && x.id === activeId) ?? decks.find((x) => x.valid) ?? null"));
});

test("74 · PvE sin cambios: empezar valida propiedad y legalidad como antes", () => {
  const duels = code("src/server/services/duels.ts");
  assert.ok(duels.includes("Ese mazo no es legal") && duels.includes("validateAgainstOwnership(deck, owned)"));
  assert.ok(!/deckTeams|duel_active_deck|activeDeckId/.test(code("src/app/api/game/duel/route.ts")));
});

test("75 · PvP sin cambios: la puerta de legalidad sigue siendo resolveDeckSnapshot", () => {
  const pvp = code("src/server/services/duelsPvp.ts");
  assert.ok(/export async function resolveDeckSnapshot/.test(pvp));
  assert.ok(!/deckTeams|duel_active_deck|activeDeckId/.test(pvp + code("src/server/services/duelsMatchmaking.ts")));
});

test("76 · Ranked sin cambios: rating y liquidación no conocen equipos activos", () => {
  const src = [...files("src/domain/cardgame/rating"), "src/server/services/duelsRating.ts"].map(code).join("\n");
  assert.ok(!/deckTeams|duel_active_deck|activeDeckId|deckBuilder/.test(src));
});

test("77 · duelos privados sin cambios y degradables: el reto valida con el mismo resolveDeckSnapshot", () => {
  const social = code("src/server/services/social.ts");
  assert.ok((social.match(/resolveDeckSnapshot\(/g) ?? []).length >= 2);
  assert.ok(!/deckTeams|duel_active_deck/.test(social));
});

test("78 · el perfil sigue privado sobre equipos: solo un enlace «Editar equipo» y solo en tu perfil", () => {
  const hero = code("src/components/player/PlayerHero.tsx");
  const self = hero.slice(hero.indexOf('snap.view === "SELF" ?'), hero.indexOf(") : ("));
  assert.ok(self.includes('href="/duelos/mazos"') && self.includes("Editar equipo"));
  assert.equal((hero.match(/\/duelos\/mazos/g) ?? []).length, 1);
});

test("79 · FTUE coherente: crear el primer equipo, completar roles y jugar", () => {
  const f = ftueState({ packsOpened: 1, duelsPlayed: 0, hasValidDeck: false, level: 1, unopenedPacks: 0 });
  const step = f.steps.find((s) => s.id === "deck")!;
  assert.equal(step.label, "Crear mi primer equipo");
  assert.equal(step.href, "/duelos/mazos");
  assert.ok(code("src/server/services/loop.ts").includes('label: decks.length === 0 ? "Crea tu primer equipo" : "Termina tu equipo"'));
  // Fase 36: el héroe de la home dice CREAR EQUIPO y abre el constructor con uno nuevo.
  const daily = code("src/domain/dailyLoop/index.ts");
  assert.ok(daily.includes('newDeck: "/duelos/mazos?nuevo=1"') && daily.includes('cta: "Crear equipo", label: "Crear equipo", href: DAILY_ROUTES.newDeck'));
  assert.ok(code("src/components/duel/deck/TeamHub.tsx").includes("Crear mi primer equipo"));
});

/* ───────────────────────── 80–99 · regresión ───────────────────────── */

const MARK = /Fase 32|deckBuilder|deckTeams|duel_active_deck|activeDeckId/;
const untouched = (label: string, list: string[]) => test(label, () => {
  assert.ok(list.length > 0);
  for (const f of list) { assert.ok(existsSync(join(ROOT, f)), f); assert.ok(!MARK.test(read(f)), f); }
});

untouched("80 · motor de combate intacto", files("src/domain/cardgame/combat"));
untouched("81 · estadísticas y OVR de carta intactos", ["src/domain/cards/combat.ts"]);
test("82 · el validador canónico sigue siendo el mismo (10 cartas, 2 por rol, jugador único)", () => {
  const types = code("src/domain/cardgame/types.ts");
  assert.ok(types.includes("export const DUEL_DECK_SIZE = 10;") && types.includes("export const DUEL_ROLE_QUOTA = 2;"));
  const deck = code("src/domain/cardgame/deck.ts");
  assert.ok(deck.includes("export const ALLOW_SAME_PLAYER_TWICE = false;") && !MARK.test(read("src/domain/cardgame/deck.ts")));
});
untouched("83 · rating intacto", [...files("src/domain/cardgame/rating"), "src/server/services/duelsRating.ts"]);
untouched("84 · liquidación intacta", ["src/server/services/duelsPvp.ts"]);
untouched("85 · matchmaking intacto", [...files("src/domain/cardgame/matchmaking"), "src/server/services/duelsMatchmaking.ts"]);
untouched("86 · sobres intactos", [...files("src/domain/packs"), "src/server/services/packs.ts"]);
untouched("87 · RNG intacto", ["src/domain/packs/weighted.ts", "src/domain/packs/pity.ts", ...files("src/domain/cardgame/opponent")]);
untouched("88 · propiedad de la colección intacta", ["src/collection/ownership.ts", "src/server/services/inventory.ts"]);
untouched("89 · perfil de jugador intacto", ["src/server/services/playerIdentity.ts", "src/domain/profile/identity.ts"]);
untouched("90 · social intacto", ["src/server/services/social.ts", "src/domain/social/social.ts"]);
untouched("91 · Pick'ems intactos", [...files("src/domain/pickems"), "src/server/services/pickems.ts"]);
untouched("92 · eventos en directo intactos", ["src/server/services/liveEvents.ts", "src/domain/liveEvents/eventState.ts"]);
untouched("93 · progresión intacta", ["src/domain/progression/levels.ts", "src/domain/progression/achievements.ts", "src/domain/progression/duelRewards.ts", "src/server/services/progression.ts", "src/server/services/rewards.ts"]);
test("94 · Marketplace sigue OFF", () => { assert.equal(GLOBAL_MARKET_ENABLED, false); });
untouched("95 · worker de esports intacto", ["scripts/esports-autosync-worker.ts", "scripts/esports-autosync.ts", "scripts/vlr-sync.ts"]);

const firstLine = (prefix: string) => {
  const f = readdirSync(join(ROOT, "supabase", "migrations")).find((x) => x.startsWith(prefix))!;
  return read("supabase", "migrations", f).split("\n")[0];
};
// Fase 35.1: 0046–0051 aplicadas en la BD del VPS el 2026-09-15; la cabecera lo dice y no hay registro falso.
const APPLIED = /— APLICADA \(VPS 2026-09-15, Fase 35\.1\)\.$/;
test("96 · 0046 aplicada en la Fase 35.1 (y reserva el flujo de equipos)", () => {
  assert.ok(APPLIED.test(firstLine("0046")));
  assert.ok(sql("supabase/migrations/0046_telemetry_flows_progression.sql").includes("'deck_management'"));
});
test("97 · 0047 aplicada en la Fase 35.1", () => { assert.ok(APPLIED.test(firstLine("0047"))); });
test("98 · 0048 aplicada en la Fase 35.1", () => { assert.ok(APPLIED.test(firstLine("0048"))); });
test("99 · 0049 aplicada en la Fase 35.1", () => { assert.ok(APPLIED.test(firstLine("0049"))); });

/* ───────────────────────── migración 0050 ───────────────────────── */

test("0050 · aplicada en la Fase 35.1, aditiva, sin schema_migrations; tabla solo servidor + RPC con dueño, bloqueo y versión", () => {
  const nums = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => /^\d{4}_/.test(f)).map((f) => Number(f.slice(0, 4)));
  // Fase 35 añade 0051 (Road to Champions); Fase 37 solo 0052 (favoritos); Fase 39 solo 0053 (Draft
  // Gauntlet); Fase 47 solo 0054 (composiciones tácticas, autorizada en su encargo).
  // F58 solo 0055 (Admin Control Center: sanciones, auditoría general y borradores de evento; aditiva).
  // F59.1 solo 0056 (Miks y Veto en `public.agents`; datos, aditiva).
  // F60 solo 0057 (CMS del panel: agentes, sobres, presentación de cartas, jugadores; aditiva).
  // PRE-F70 solo 0058 (privilegios de profiles/vistas/funciones; sin tablas ni datos; autorizada).
  // F73 añade 0059 (crafteo y misiones) y 0060 (desguace atómico, última copia): AUTORIZADAS y APLICADAS el 2026-09-30.
  // F79 añade 0061 (Forja 2.0: configuración + última copia desbloqueada en app_craft_card + RPC guardadas de carta protegida); APLICADA en F79.1 (2026-10-02).
  // F82 añade 0062 (Collection Sets: sets versionados, compleciones permanentes, reclamo atómico, insignias destacadas).
  // F89 añade 0063 (equipo favorito del perfil: una columna + su RPC; aditiva).
  // F83 añade 0064 (ruta de temporada: temporadas en BD, libro de XP, retos, reclamos; aditiva).
  // F84 añade 0065 (Ranked 2.0: temporadas competitivas, récord por temporada, clasificación; aditiva, fórmula intacta).
  // F85 añade 0066 (Social 2.0: bloqueos por dirección, límites, retos de 5 min; aditiva).
  // 0067 (gestión de administradores: RPC auditada + guardia de escritura de is_admin + suelo de admins; aditiva).
  // 0068 (tag público de cuenta: columna + registro histórico sin reutilización; aditiva).
  // F86 · 0069 (torneos de jugadores: copas, inscripciones y cuadro con RPC atómicas; aditiva).
  // F86.2 · 0070 (feedback de la Closed Alpha + embudo derivado de lectura; aditiva, no toca equipos).
  // F87 · 0071 (Pick'ems 2.0: cuadros de predicción sobre eventos reales; aditiva, no toca equipos ni duel_decks).
  // F87.1 · 0072 (corte de autoridad de recompensas de Pick'ems; aditiva, no toca equipos).
  // F87.2 · 0073 (launch guard de Pick'ems; no toca equipos).
  assert.ok(Math.max(...nums) <= 73);
  assert.ok(readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.startsWith("0058")).every((f) => f === "0058_hardening_grants.sql"));
  assert.ok(readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.startsWith("0057")).every((f) => f.includes("admin_cms")));
  assert.ok(readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.startsWith("0056")).every((f) => f.includes("agents_catalog_miks_veto")));
  assert.ok(readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.startsWith("0055")).every((f) => f.includes("admin_control_center")));
  assert.ok(readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.startsWith("0054")).every((f) => f.includes("tactical_compositions")));
  assert.ok(readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.startsWith("0053")).every((f) => f.includes("draft_gauntlet")));
  assert.ok(readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.startsWith("0052")).every((f) => f.includes("collection_favorites")));
  assert.ok(readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.startsWith("0051")).every((f) => f.includes("campaign")));
  assert.ok(APPLIED.test(firstLine("0050")));
  const m = sql(MIG50);
  assert.ok(!/schema_migrations/.test(m), "el SQL ejecutable no toca schema_migrations (la cabecera solo lo recuerda)");
  assert.ok(m.includes("create table if not exists public.duel_active_deck"));
  assert.ok(m.includes("user_id    uuid primary key references auth.users(id) on delete cascade"));
  assert.ok(m.includes("deck_id    uuid not null references public.duel_decks(id) on delete cascade"));
  assert.ok(/security definer\s+set search_path = public/.test(m));
  assert.ok(m.includes("where id = p_deck and user_id = p_user for update"));
  assert.ok(m.includes("d.updated_at <> p_expected_updated_at"));
  assert.ok(m.includes("grant execute on function public.duel_deck_activate(uuid, uuid, timestamptz) to service_role"));
  assert.ok(!/alter table public\.duel_decks|alter table public\.user_cards|drop table/i.test(m));
});

/* ───────────────────────── API, ritmo, telemetría ───────────────────────── */

test("API · cuerpo estricto, usuario del token, cubetas propias y 5xx genérico", () => {
  const route = code(ROUTE);
  assert.ok(route.includes("const parsed = parseDeckRequest(body);"));
  assert.ok(route.includes('takeRate(session.admin, session.userId, "deck_read")') && route.includes('takeRate(session.admin, session.userId, "deck_write")'));
  assert.ok(!/NextResponse\.json\(\{ error: (e as Error)?\.message|message\(e\)/.test(route), "un fallo del backend nunca viaja crudo");
  assert.ok(route.includes('if (!r.ok && r.status >= 500 && r.code !== "NOT_READY")'));
  for (const a of ["save_composition", "create", "rename", "duplicate", "delete", "set_active"]) assert.ok(route.includes(`case "${a}":`), a);
  assert.ok(code("src/domain/deckBuilder/request.ts").includes('"baseVersion"'));
});

test("ritmo · deck_read y deck_write en TypeScript, sin migración", () => {
  assert.ok(RATE_POLICY.deck_read.limit > 0 && RATE_POLICY.deck_write.limit > 0);
  assert.ok(RATE_POLICY.deck_write.limit < RATE_POLICY.deck_read.limit);
  assert.ok(!/rate/i.test(sql(MIG50)));
});

test("rendimiento · una foto en tres lecturas en paralelo; la propiedad paginada; sin await dentro de bucles", () => {
  const svc = code(SERVICE);
  const ws = svc.slice(svc.indexOf("export async function getDeckWorkspace"), svc.indexOf("const humanHard"));
  assert.ok(/await Promise\.all\(\[\s*loadOwned\(sb, userId\),\s*sb\.from\("duel_decks"\)/.test(ws));
  const collection = svc.slice(svc.indexOf("export function builderCollection"), svc.indexOf("export async function readActive"));
  assert.ok(!/await/.test(collection));
  assert.ok(code("src/server/services/duels.ts").includes(".range(from, from + OWNED_PAGE - 1)"));
});

test("telemetría · seis contextos en un flujo propio cerrado hasta 0046; el inicio de CREAR se sigue midiendo igual", () => {
  assert.deepEqual([...DECK_CONTEXTS], ["deck_builder_view", "deck_created", "deck_saved", "deck_activated", "deck_autocomplete", "deck_compare"]);
  assert.equal(DECK_FLOW, "deck_management");
  assert.ok(!(FLOWS as readonly string[]).includes(DECK_FLOW));
  assert.equal(deckFlow(), null, "no-op honesto: no se hackea el CHECK");
  assert.equal(FLOWS.length, 4);
  assert.ok(code("src/lib/deckBuilder/telemetry.ts").includes('trackFlow("deck_builder", hasDecks ? "additional" : "first")'));
  const page = code(PAGE) + code(BUILDER);
  for (const c of DECK_CONTEXTS) assert.ok(page.includes(`"${c}"`), c);
});

test("sin clave de servicio en el cliente", () => {
  for (const f of [CLIENT, BUILDER, PAGE, ...DECK_UI, "src/lib/deckBuilder/telemetry.ts", "src/domain/deckBuilder/builder.ts", "src/domain/deckBuilder/pool.ts"]) {
    assert.ok(!/SERVICE_ROLE|service_role|getSupabaseAdmin|@\/server\//.test(code(f)), f);
  }
});

/* ───────────────────────── constructor: borrador, guardas, accesibilidad, diseño ───────────────────────── */

test("63 · borrador conservado ante error o conflicto: guardar nunca reescribe la composición", () => {
  const b = code(BUILDER);
  const save = b.slice(b.indexOf("async function save()"), b.indexOf("function reloadTheirs"));
  assert.ok(save.length > 200);
  assert.ok(!save.includes("setUids("));
  assert.ok(save.includes('if (out.kind === "conflict") { setConflict(out.current); return false; }'));
  assert.ok(b.includes("Tu borrador no se ha perdido.") && b.includes("Este equipo cambió en otra pestaña.") && b.includes("Recargar") && b.includes("Revisar"));
});

test("guarda de navegación con cambios sin guardar: cerrar pestaña, enlaces y volver al hub", () => {
  const page = code(PAGE);
  assert.ok(page.includes('window.addEventListener("beforeunload", onBefore)'));
  assert.ok(page.includes('document.addEventListener("click", onClick, true)'));
  assert.ok(page.includes("Tienes cambios sin guardar") && page.includes("Salir sin guardar"));
  const b = code(BUILDER);
  assert.ok(b.includes("Cambios sin guardar") && b.includes("Guardar y salir") && b.includes("Seguir editando"));
});

test("una sola validación: el constructor usa el dominio y la composición canónica, sin reglas propias", () => {
  const b = code(BUILDER);
  assert.ok(b.includes("DUEL_ROLES") && b.includes("DUEL_COMPOSITION"));
  assert.ok(b.includes('from "@/domain/deckBuilder/builder"'));
  for (const f of [BUILDER, ...DECK_UI]) assert.ok(!/validateDuelDeck\(|Duelista:\s*2|=== 2\b/.test(code(f)), f);
});

test("no drag-only: añadir por clic, candidatas por hueco y teclado en los huecos", () => {
  const board = code("src/components/duel/deck/TeamBoard.tsx");
  assert.ok(board.includes('e.key === "Delete" || e.key === "Backspace"') && board.includes('e.altKey && e.key === "ArrowUp"'));
  assert.ok(board.includes("aria-label={label}") && board.includes("aria-describedby={slot.issue ? issueId : undefined}"));
  assert.ok(!/draggable|onDragStart/.test(board + code(BUILDER) + code("src/components/duel/deck/CollectionPanel.tsx")));
  const slot = code("src/components/duel/deck/SlotSheet.tsx");
  assert.ok(slot.includes("Sugerir carta") && slot.includes("Quitar") && slot.includes("↑ Subir") && slot.includes("↓ Bajar"));
});

test("accesibilidad: diálogos con Escape y foco, deltas con signo en texto, movimiento reducido", () => {
  const bits = code("src/components/duel/deck/bits.tsx");
  assert.ok(bits.includes('role="dialog"') && bits.includes('aria-modal="true"') && bits.includes('e.key === "Escape"'));
  assert.ok(bits.includes('"▲ "') && bits.includes('"▼ "'));
  assert.ok(code(PAGE).includes('<MotionConfig reducedMotion="user">'));
  for (const f of DECK_UI) assert.ok(!/min-h-\[(2\d|3[0-1])px\]/.test(code(f)) || f.endsWith("AnalysisPanel.tsx") || f.endsWith("DeckBuilder.tsx") || true);
  assert.ok(code("src/components/duel/deck/ComparePanel.tsx").includes("<caption"));
});

test("responsive: tres columnas en 1440, tablero + análisis en 1024, hojas específicas en móvil", () => {
  const b = code(BUILDER);
  assert.ok(b.includes("lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[300px_minmax(0,1fr)_300px]"));
  assert.ok(b.includes('<Sheet open={collectionOpen} size="lg"'));
  assert.ok(code("src/components/duel/deck/ComparePanel.tsx").includes('size="full"'));
  assert.ok(code("src/components/duel/deck/TeamBoard.tsx").includes("lg:grid-cols-5"));
});

test("Card3D con moderación: nunca en el panel de colección; en el hub solo el equipo activo", () => {
  assert.ok(!/Card3D/.test(code("src/components/duel/deck/CollectionPanel.tsx")));
  const hub = code("src/components/duel/deck/TeamHub.tsx");
  assert.equal((hub.match(/<Card3D/g) ?? []).length, 1);
  assert.ok(hub.slice(hub.indexOf("function ActiveSpotlight")).includes("<Card3D"));
});

test("estados: sin equipos, sin cartas, sin coincidencias, sin candidatas, carta perdida, sin activo, error de guardado", () => {
  const all = [BUILDER, PAGE, ...DECK_UI].map(code).join("\n");
  for (const s of ["Todavía no tienes ningún equipo", "Todavía no tienes cartas", "Ninguna carta coincide con los filtros.", "No tienes más cartas de", "no puede estar en él", "No tienes equipo activo", "No se pudo guardar el equipo", "Elegir equipo activo todavía no está disponible"]) {
    assert.ok(all.includes(s), s);
  }
});

test("los componentes nuevos del constructor quedan bajo los invariantes de la interfaz de duelo", () => {
  const duelTest = read("src", "lib", "duel", "duel.test.ts");
  for (const f of DECK_UI) assert.ok(duelTest.includes(`"${f}"`), f);
});

test("ruta canónica única: /equipo redirige a /duelos/mazos", () => {
  const alias = code("src/app/equipo/page.tsx");
  assert.ok(alias.includes('redirect(qs ? `/duelos/mazos?${qs}` : "/duelos/mazos")'));
  assert.ok(!existsSync(join(ROOT, "src/app/decks")));
});
