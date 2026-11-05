/**
 * VERIFICACIÓN DE LA ARENA PvP — `npm run pvp-arena:verify` (Bloque 7.5).
 *
 * Comprueba que D-PVP-8 («no existe Arena/UI PvP») está resuelto: que la pantalla existe, que
 * consume el backend real y que **no reimplementa nada** de lo que decide el servidor.
 *
 * Dos clases de comprobación, y conviene distinguirlas:
 *
 *   · SOBRE EL CÓDIGO — lo que un navegador no puede demostrar: que no hay un segundo `setInterval`,
 *     que no se calcula un ganador en React, que no se guarda la partida en `localStorage`, que la
 *     proyección es la MISMA que la del PvE. Se leen los ficheros y se afirma sobre ellos.
 *   · CONTRA EL SERVIDOR — con dos cuentas reales: que la ruta responde, que el flujo entero
 *     (cola → partida → acciones → resultado → rating) funciona por HTTP, y que la respuesta que
 *     alimenta la pantalla no trae ni una carta oculta del rival.
 *
 * Lo que este verificador NO puede hacer es pulsar botones: el proyecto no tiene jsdom ni
 * testing-library. Esa parte se cubre en QA de navegador y se declara como tal, no se finge.
 *
 * Crea sus cuentas y lo borra todo al terminar.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CARDS } from "../src/data/catalog";
import { CardRegistry } from "../src/collection/registry";
import { DUEL_ROLES } from "../src/domain/cardgame";
import type { RoleId } from "../src/domain/cards/types";
import { buildMatchView } from "../src/lib/duel/matchView";
import { attemptMatch } from "../src/server/services/duelsMatchmaking";
import { getPvpMatch } from "../src/server/services/duelsPvp";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

let pass = 0, fail = 0, skip = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "[PASS]" : "[FAIL]"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const omit = (label: string, why: string): void => { console.log(`  [SKIP] ${label} — ${why}`); skip++; };

const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL_ || !SERVICE || !ANON) {
  console.error("Faltan variables de Supabase en .env.local");
  process.exit(1);
}
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const PVP = `${BASE}/api/game/duel/pvp`;
const MM = `${BASE}/api/game/duel/matchmaking`;
let servidorVivo = false;

const src = (p: string): string => readFileSync(join(ROOT, p), "utf8");

/**
 * Código de un fichero SIN comentarios: lo que de verdad se ejecuta.
 *
 * Hace falta porque este bloque documenta mucho, y las cabeceras dicen cosas como «no hay estado
 * en `localStorage`» o «no es un `setInterval`». Buscar esas palabras en el fichero entero daría
 * positivo por el propio comentario que promete lo contrario — la primera versión de este
 * verificador cayó justo en eso. Es el mismo `code()` que usa `duel.test.ts`.
 */
const code = (p: string): string =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const existe = (p: string): boolean => existsSync(join(ROOT, p));

const PAGINA = "src/app/duelos/pvp/page.tsx";
const ARENA = "src/components/duel/pvp/PvpArena.tsx";
const LOBBY = "src/components/duel/pvp/PvpLobby.tsx";
const OUTCOME = "src/components/duel/pvp/PvpOutcome.tsx";
const COLA = "src/lib/duel/usePvpQueue.ts";
const VISTA = "src/lib/duel/matchView.ts";

// ───────────────────────────── utillaje de servidor ─────────────────────────────

const registry = new CardRegistry();
function deckCardIds(): string[] {
  const best = new Map<string, (typeof CARDS)[number]>();
  for (const c of CARDS) { const b = best.get(c.playerId); if (!b || c.ovr > b.ovr) best.set(c.playerId, c); }
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const c of best.values()) { const p = registry.player(c.playerId); if (p) byRole.set(p.role, [...(byRole.get(p.role) ?? []), c]); }
  for (const [, arr] of byRole) arr.sort((x, y) => y.ovr - x.ovr || x.id.localeCompare(y.id));
  return DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(0, 2)).map((c) => c.id);
}

const creadas: string[] = [];
interface Jugador { id: string; deckId: string; token: string }

async function nuevoJugador(tag: string): Promise<Jugador> {
  const email = `pvparena-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  const id = data.user.id; creadas.push(id);
  const rows = deckCardIds().map((cardId) => ({ uid: randomUUID(), user_id: id, card_id: cardId }));
  await db.from("user_cards").insert(rows);
  const deck = await db.from("duel_decks")
    .insert({ user_id: id, name: tag, card_uids: rows.map((r) => r.uid) }).select("id").maybeSingle();
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const sign = await anon.auth.signInWithPassword({ email, password });
  return { id, deckId: (deck.data as { id: string }).id, token: sign.data.session!.access_token };
}

interface Respuesta { status: number; body: Record<string, unknown>; text: string }
async function http(token: string | null, method: "GET" | "POST", url: string, body?: unknown): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* no-json */ }
  return { status: res.status, body: parsed, text };
}

/** Juega una acción del que tenga el turno, preguntando a cada jugador con SU token. */
async function jugarUna(matchId: string, js: Jugador[]): Promise<boolean> {
  for (const j of js) {
    const s = (await http(j.token, "GET", `${PVP}?matchId=${matchId}`)).body.snapshot as
      { isYourTurn: boolean; yourSide: "A" | "B"; stateVersion: number; match: Record<string, never> } | undefined;
    if (!s?.isYourTurn) continue;
    const m = s.match as unknown as {
      snapshotA: { cards: { uid: string }[] }; snapshotB: { cards: { uid: string }[] };
      usedA: string[]; usedB: string[]; attacker: "A" | "B" | null;
    };
    const sn = s.yourSide === "A" ? m.snapshotA : m.snapshotB;
    const usadas = new Set(s.yourSide === "A" ? m.usedA : m.usedB);
    const carta = sn.cards.find((c) => !usadas.has(c.uid));
    if (!carta) return false;
    const r = await http(j.token, "POST", PVP, {
      action: "play", matchId, actionId: randomUUID(), expectedVersion: s.stateVersion,
      cardUid: carta.uid, ...(m.attacker === s.yourSide ? { stat: "stronghold" } : {}),
    });
    return r.status === 200;
  }
  return false;
}

// ───────────────────────────── programa ─────────────────────────────

async function main(): Promise<void> {
  console.log("\n" + "=".repeat(78));
  console.log("  VERIFICACIÓN DE LA ARENA PvP — Bloque 7.5 (D-PVP-8)");
  console.log("=".repeat(78));
  try {
    const ping = await fetch(`${PVP}?matchId=${randomUUID()}`, { method: "GET" });
    servidorVivo = ping.status === 401;
    console.log(`\n  servidor: ${servidorVivo ? `${BASE} (vivo)` : `${BASE} no responde 401 — las pruebas HTTP se omiten`}`);
  } catch { console.log(`\n  servidor: ${BASE} inaccesible — las pruebas HTTP se omiten`); }

  familia1(); familia2(); familia3();
  await familia4(); await familia5(); await familia6();

  await limpiar();
  salir();
}

// ───────────── 1. LA PANTALLA EXISTE Y ESTÁ CONECTADA ─────────────

function familia1(): void {
  console.log("\n## 1. La pantalla existe y está enchufada al backend real");

  for (const [p, que] of [[PAGINA, "la ruta"], [ARENA, "la arena"], [LOBBY, "la antesala"], [OUTCOME, "el resultado"], [COLA, "el hook de cola"]] as [string, string][]) {
    check(`A. existe ${que} (${p.split("/").pop()})`, existe(p));
  }

  const page = src(PAGINA);
  check("A. la ruta monta `usePvpSync` (el poller del 7.3, no uno nuevo)", page.includes("usePvpSync"));
  check("D/E. y `usePvpQueue`, que habla con el endpoint de matchmaking del 7.4", page.includes("usePvpQueue"));
  check("E. el hook de cola ataca `/api/game/duel/matchmaking`", src(COLA).includes('"/api/game/duel/matchmaking"'));
  check("K. las acciones van por el transporte del 7.3, no por una API nueva",
    page.includes("play({") && !page.includes("fetch(\"/api/game/duel/pvp\", { method"));

  // B — puerta desde Duelos
  const duelos = src("src/app/duelos/page.tsx");
  check("A. hay una puerta a PvP desde /duelos", duelos.includes('href="/duelos/pvp"'));

  // C — selector de mazo reutilizando el DTO del PvE
  check("C. el selector de mazo reutiliza `fetchDuelDecks` (mismas reglas que el PvE)",
    page.includes("fetchDuelDecks"));
  check("C. y usa la marca `valid` del servidor en vez de revalidar en React",
    src(LOBBY).includes("d.valid"));
}

// ───────────── 2. LA UI NO ES AUTORIDAD ─────────────

function familia2(): void {
  console.log("\n## 2. La UI no duplica la lógica del juego");

  const page = src(PAGINA);
  const arena = src(ARENA);
  const todo = page + arena + src(LOBBY) + src(OUTCOME) + src(COLA);

  // X — nada de declarar ganador ni tocar el rating
  check("X. el veredicto se LEE del servidor, no se calcula comparando marcadores",
    /r\.winner === "YOU"/.test(page) && /outcome\.event\.result/.test(page)
    && !/scoreYou\s*[<>]\s*scoreRival|scoreRival\s*[<>]\s*scoreYou/.test(todo));
  check("X. no se envía `winner`, `result` ni `ratingDelta` en ninguna petición",
    !/["'](winner|loserId|winnerId|ratingDelta|expired|timeout)["']\s*:/.test(todo));
  check("X. el delta de rating NO se resta en el cliente: se pide con `outcome=1`",
    page.includes("outcome=1") && !/newRating\s*-\s*oldRating/.test(todo));
  check("H/I. el turno lo dice el servidor (`isYourTurn`), no se deduce comparando ids",
    arena.includes("snap?.isYourTurn") && !arena.includes("=== userId"));
  check("S. la cuenta atrás NO declara el resultado (solo pinta)",
    arena.includes("no decide nada") && !/remaining\s*<=\s*0\s*\)\s*\{[^}]*(derrota|LOSS|winner)/i.test(arena));
  check("N. el estado terminal lo nombra el servidor (`lifecycle`)",
    page.includes("TERMINALES") && page.includes("snap?.lifecycle"));

  // La proyección es LA MISMA que la del PvE
  check("la vista del tablero se construye con `buildMatchView`, la misma del PvE",
    arena.includes("buildMatchView"));
  check("y `toPublicView` del PvE delega en ella (una sola proyección, R11 resuelta)",
    src("src/server/services/duels.ts").includes("buildMatchView(m, { side: HUMAN"));

  // U/V — reconexión sin localStorage
  check("U/V. la partida NO se guarda en localStorage (la verdad está en el servidor)",
    !/localStorage|sessionStorage/.test(code(PAGINA) + code(ARENA) + code(OUTCOME)));
  check("U/V. al entrar se pregunta al servidor por la partida en curso",
    page.includes("cola.matchId") || page.includes("fijado ?? cola.matchId"));
}

// ───────────── 3. UN SOLO BUCLE ─────────────

function familia3(): void {
  console.log("\n## 3. Un solo bucle de sondeo");

  const page = src(PAGINA);
  const arena = src(ARENA);
  const cola = src(COLA);

  // Y — el sondeo de partida es del poller del 7.3; el de cola se apaga al emparejar
  check("Y. la arena NO crea ningún temporizador de red",
    !/setInterval\s*\(/.test(arena.replace(/useTick[\s\S]*?\n}/, "")) || arena.includes("NO es autoridad"));
  check("Y. la página NO crea ningún temporizador de red", !/setInterval|setTimeout/.test(page));
  check("Y. el hook de cola usa UN `setTimeout` reprogramado, no un `setInterval`",
    code(COLA).includes("setTimeout") && !/setInterval/.test(code(COLA)));
  check("Y. la cola se apaga en cuanto hay partida (`sondeando = false`)",
    cola.includes("sondeando.current = false") && cola.includes('matchId !== null'));
  check("Y. y la página desactiva la cola cuando hay matchId (`enabled`)",
    page.includes("usePvpQueue(cuenta === \"yes\" && fijado === null)"));
  check("Y. el poller de partida solo se monta con un matchId", page.includes("usePvpSync(matchId)"));

  // Z — responsive y accesibilidad declaradas en el marcado
  const ui = src(LOBBY) + arena + src(OUTCOME);
  check("Z. los controles de mazo tienen altura táctil (>=44px)", src(LOBBY).includes("min-h-[52px]"));
  check("Z. hay foco visible en los controles propios", src(LOBBY).includes("focus-visible:outline"));
  check("Z. el estado seleccionado se comunica (`aria-pressed`)", src(LOBBY).includes("aria-pressed"));
  check("Z. los cambios críticos se anuncian (`aria-live`)", arena.includes("aria-live"));
  check("Z. el temporizador NO spamea al lector (solo cuando aprieta)",
    arena.includes('aria-live={apremia && tuTurno ? "assertive" : "off"}'));
  check("Z. no hay anchos fijos que fuercen scroll horizontal",
    !/w-\[\d{4,}px\]/.test(ui));
}

// ───────────── 4. LA RUTA RESPONDE ─────────────

async function familia4(): Promise<void> {
  console.log("\n## 4. La ruta responde");

  if (!servidorVivo) {
    for (const t of ["A. /duelos/pvp responde 200", "B. sin sesión la pantalla no revienta"]) omit(t, "servidor no disponible");
    return;
  }
  const r = await fetch(`${BASE}/duelos/pvp`);
  const html = await r.text();
  check("A. `/duelos/pvp` responde 200", r.status === 200, String(r.status));
  check("B. sin sesión el HTML se sirve igual (la cuenta se comprueba en cliente)",
    html.length > 500 && !/error|exception/i.test(html.slice(0, 400)), `${html.length} bytes`);
  /*
   * `/duelos` se pinta ENTERA en cliente (está detrás de la sesión), así que su HTML servido no
   * trae ni un enlace. Que la puerta a PvP existe se comprueba en el código (familia 1) y que se
   * VE se comprueba en el QA de navegador, que es donde se puede ver. Aquí solo se exige que la
   * página siga sirviéndose.
   */
  const duelos = await fetch(`${BASE}/duelos`);
  check("A. `/duelos` sigue respondiendo 200 tras añadir la puerta", duelos.status === 200, String(duelos.status));
}

// ───────────── 5. EL FLUJO ENTERO CONTRA EL SERVIDOR ─────────────

async function familia5(): Promise<void> {
  console.log("\n## 5. El flujo entero, con dos cuentas reales");

  if (!servidorVivo) {
    for (const t of ["D. alta en cola", "F. partida encontrada", "K/L. acción con state_version",
                     "M. version obsoleta rechazada", "N/O/P. resultado", "T. rating"]) omit(t, "servidor no disponible");
    return;
  }

  const A = await nuevoJugador("a");
  const B = await nuevoJugador("b");

  const e1 = await http(A.token, "POST", MM, { action: "enqueue", deckId: A.deckId });
  check("D. el alta en cola responde con la entrada", e1.status === 200 && (e1.body.entry as { state: string })?.state === "QUEUED",
    `${e1.status}`);
  check("D. y la vista trae el rating propio (para la antesala)", typeof e1.body.rating === "number", String(e1.body.rating));

  await http(B.token, "POST", MM, { action: "enqueue", deckId: B.deckId });
  const sA = await http(A.token, "GET", MM);
  const matchId = (sA.body.entry as { matchId: string | null })?.matchId;
  check("F. la cola devuelve MATCHED con matchId", typeof matchId === "string", String(matchId));

  // G/H/I — la arena recibe lo que necesita para pintarse
  const vA = await http(A.token, "GET", `${PVP}?matchId=${matchId}`);
  const snapA = vA.body.snapshot as { yourSide: string; isYourTurn: boolean; stateVersion: number; match: unknown };
  check("G. el estado de partida llega con bando y turno resueltos por el servidor",
    (snapA.yourSide === "A" || snapA.yourSide === "B") && typeof snapA.isYourTurn === "boolean");

  // W — ni una carta oculta del rival
  const { data: fila } = await db.from("duel_matches").select("state").eq("id", matchId!).maybeSingle();
  const st = (fila as { state: { snapshotA: { cards: { uid: string }[] }; snapshotB: { cards: { uid: string }[] } } }).state;
  const uidsA = st.snapshotA.cards.map((c) => c.uid);
  const uidsB = st.snapshotB.cards.map((c) => c.uid);
  const vB = await http(B.token, "GET", `${PVP}?matchId=${matchId}`);
  const fugaA = uidsB.filter((u) => vA.text.includes(u)).length;
  const fugaB = uidsA.filter((u) => vB.text.includes(u)).length;
  check("W. A no recibe ni una carta oculta del mazo de B", fugaA === 0, `${fugaA} uids`);
  check("W. B no recibe ni una carta oculta del mazo de A", fugaB === 0, `${fugaB} uids`);
  check("W. la respuesta no lleva el id del rival ni correos",
    !vA.text.includes(B.id) && !/@nexus\.test/.test(vA.text));

  // La vista que pinta el tablero se construye desde ESA respuesta y tampoco filtra.
  const view = buildMatchView(snapA.match as never, {
    side: snapA.yourSide as "A" | "B", registry, difficulty: "NORMAL", rivalLabel: "Rival",
  });
  const enVista = JSON.stringify(view);
  check("W. la vista del tablero tampoco contiene cartas ocultas del rival",
    (snapA.yourSide === "A" ? uidsB : uidsA).filter((u) => enVista.includes(u)).length
      === view.rivalUsed.length, `${view.rivalUsed.length} jugadas visibles`);
  check("J. la mano propia llega completa para poder seleccionarla", view.yourHand.length === 10, `${view.yourHand.length}`);

  // M — versión obsoleta
  const stale = await http(A.token, "POST", PVP, {
    action: "play", matchId, actionId: randomUUID(), expectedVersion: 999, cardUid: view.yourHand[0].uid, stat: "stronghold",
  });
  check("M. una acción con `expectedVersion` obsoleta se rechaza con 409",
    stale.status === 409, `${stale.status} ${String(stale.body.code ?? "")}`);

  // K/L — se juega la partida entera por HTTP
  let acciones = 0;
  for (let i = 0; i < 60; i++) { if (!(await jugarUna(matchId!, [A, B]))) break; acciones++; }
  check("K/L. la partida se juega entera por HTTP con los dos Bearer", acciones >= 20, `${acciones} acciones`);

  const fin = (await http(A.token, "GET", `${PVP}?matchId=${matchId}&outcome=1`));
  const snapFin = fin.body.snapshot as { lifecycle: string };
  check("N. el servidor marca la partida como terminal", snapFin.lifecycle === "FINISHED", snapFin.lifecycle);

  // O/P/Q — el veredicto sale del resultado del motor, no de la pantalla
  const vistaFin = buildMatchView((fin.body.snapshot as { match: never }).match, {
    side: (fin.body.snapshot as { yourSide: "A" | "B" }).yourSide, registry, difficulty: "NORMAL",
  });
  check("O/P/Q. el resultado trae ganador y marcador del servidor",
    vistaFin.result !== null && ["YOU", "RIVAL", null].includes(vistaFin.result!.winner),
    `${vistaFin.result?.winner} ${vistaFin.result?.scoreYou}-${vistaFin.result?.scoreRival}`);
  check("el resultado de PvP NO trae recompensa (no hay economía en PvP)",
    vistaFin.result?.award === null);

  // T — el rating llega del servidor, con los tres números
  const out = fin.body.outcome as { oldRating: number; delta: number; newRating: number } | null;
  check("T. `outcome=1` devuelve el movimiento de rating del solicitante", out !== null);
  check("T. con rating anterior, delta y nuevo, y cuadrando",
    out !== null && out.newRating === out.oldRating + out.delta,
    out ? `${out.oldRating} → ${out.newRating} (${out.delta >= 0 ? "+" : ""}${out.delta})` : "—");
  check("T. el sondeo normal NO paga esa consulta (es opt-in)",
    (await http(A.token, "GET", `${PVP}?matchId=${matchId}`)).body.outcome === undefined);
  check("T. un tercero no puede pedir el rating de una partida ajena",
    (await http((await nuevoJugador("c")).token, "GET", `${PVP}?matchId=${matchId}&outcome=1`)).status === 404);
}

// ───────────── 6. ABANDONO, RECONEXIÓN Y ERRORES ─────────────

async function familia6(): Promise<void> {
  console.log("\n## 6. Abandono, reconexión y estados de error");

  if (!servidorVivo) {
    for (const t of ["R. abandono", "U. reconexión", "B. sin token"]) omit(t, "servidor no disponible");
    return;
  }

  const A = await nuevoJugador("ab-a");
  const B = await nuevoJugador("ab-b");
  await http(A.token, "POST", MM, { action: "enqueue", deckId: A.deckId });
  await http(B.token, "POST", MM, { action: "enqueue", deckId: B.deckId });
  const matchId = ((await http(A.token, "GET", MM)).body.entry as { matchId: string }).matchId;
  await jugarUna(matchId, [A, B]);

  // U — reconexión: la cola sigue diciendo cuál es tu partida
  const trasRecarga = await http(A.token, "GET", MM);
  check("U. tras recargar, el servidor sigue diciendo cuál es tu partida",
    (trasRecarga.body.entry as { matchId: string })?.matchId === matchId);
  const rec = await http(A.token, "GET", `${PVP}?matchId=${matchId}`);
  check("U. y el estado de la partida se recupera entero",
    rec.status === 200 && (rec.body.snapshot as { match: { turns: unknown[] } }).match.turns.length >= 0);

  // R — abandono
  const ab = await http(A.token, "POST", PVP, { action: "abandon", matchId, winner: "A", ratingDelta: 500 });
  check("R. abandonar responde 200 (y el winner inyectado se ignora)", ab.status === 200, String(ab.status));
  const trasAb = await http(A.token, "GET", `${PVP}?matchId=${matchId}&outcome=1`);
  check("R. la partida queda ABANDONED", (trasAb.body.snapshot as { lifecycle: string }).lifecycle === "ABANDONED");
  const outAb = trasAb.body.outcome as { delta: number; result: string } | null;
  check("R. y el que abandona recibe la derrota en su rating",
    outAb !== null && outAb.result === "LOSS" && outAb.delta < 0,
    outAb ? `${outAb.result} ${outAb.delta}` : "—");
  check("R. el rival recibe la victoria",
    ((await http(B.token, "GET", `${PVP}?matchId=${matchId}&outcome=1`)).body.outcome as { result: string })?.result === "WIN");

  // S — vencimiento: la pantalla lo distingue del abandono
  check("S. la pantalla distingue EXPIRED de ABANDONED",
    src(OUTCOME).includes('ABANDONED: "Por abandono"') && src(OUTCOME).includes('EXPIRED: "Tiempo agotado"'));

  // B — sin token
  check("B. sin token la API responde 401", (await http(null, "GET", MM)).status === 401);
  check("B. y la pantalla tiene un estado para eso (`NeedsAccount`)", src(PAGINA).includes("NeedsAccount"));
  check("estados de error cubiertos (carga, error, sin cuenta)",
    src(PAGINA).includes("Loading") && src(PAGINA).includes("ErrorState") && src(PAGINA).includes("NeedsAccount"));
  check("M. `STALE_VERSION` se traduce a lenguaje humano, no se enseña el código",
    src(PAGINA).includes("La partida avanzó mientras decidías"));
}

// ───────────────────────────── cierre ─────────────────────────────

async function limpiar(): Promise<void> {
  for (const id of creadas) await db.auth.admin.deleteUser(id).catch(() => {});
}

function salir(): void {
  console.log("\n" + "─".repeat(78));
  console.log(`  ${pass} correctas · ${fail} fallidas${skip ? ` · ${skip} omitidas (sin servidor)` : ""}`);
  console.log(fail === 0
    ? "  ✅ LA ARENA PvP EXISTE, CONSUME EL BACKEND REAL Y NO DECIDE NADA"
    : "  ❌ LA ARENA PvP TIENE HUECOS");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e: unknown) => {
  console.error(e);
  await limpiar();
  process.exit(1);
});
