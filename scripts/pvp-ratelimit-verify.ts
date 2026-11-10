/**
 * VERIFICACIÓN DEL LÍMITE DE FRECUENCIA PvP — `npm run pvp-ratelimit:verify` (Bloque 7.6).
 *
 * Comprueba que D-PVP-9 está resuelta: que el abuso se corta con 429 y que **el juego normal
 * sigue funcionando**. Lo segundo importa tanto como lo primero — un límite que molesta al
 * jugador legítimo es peor que no tener límite.
 *
 * Seis familias:
 *
 *   1. EL TRÁFICO REAL PASA — el ritmo que de verdad usa el cliente no se toca nunca.
 *   2. EL ABUSO SE CORTA    — ráfagas de cientos de peticiones reciben 429.
 *   3. LA RESPUESTA         — 429, `Retry-After`, y un cuerpo que no enumera nada.
 *   4. AISLAMIENTO          — el límite es POR USUARIO y POR SUPERFICIE; ni se hereda ni se
 *                             contagia, y no se puede evadir mandando otro `userId`.
 *   5. NO SUSTITUYE A NADA  — las constraints de la base siguen siendo las que mandan.
 *   6. COMPARTIDO Y MEDIDO  — el contador vive en PostgreSQL (no en memoria del proceso) y el
 *                             coste que añade se mide, no se supone.
 *
 * Necesita el servidor levantado: un límite de frecuencia solo se puede comprobar por HTTP.
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
import { RATE_POLICY, takeRate } from "../src/server/services/rateLimit";

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
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const omit = (l: string, w: string): void => { console.log(`  [SKIP] ${l} — ${w}`); skip++; };

const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const PVP = `${BASE}/api/game/duel/pvp`;
const MM = `${BASE}/api/game/duel/matchmaking`;
let servidorVivo = false;

const registry = new CardRegistry();
function deckCardIds(): string[] {
  const best = new Map<string, (typeof CARDS)[number]>();
  for (const c of CARDS) { const b = best.get(c.playerId); if (!b || c.ovr > b.ovr) best.set(c.playerId, c); }
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const c of best.values()) { const p = registry.player(c.playerId); if (p) byRole.set(p.role, [...(byRole.get(p.role) ?? []), c]); }
  for (const [, a] of byRole) a.sort((x, y) => y.ovr - x.ovr || x.id.localeCompare(y.id));
  return DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(0, 2)).map((c) => c.id);
}

const creadas: string[] = [];
interface Jugador { id: string; deckId: string; token: string }
async function nuevoJugador(tag: string): Promise<Jugador> {
  const email = `pvprl-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  const id = data.user.id; creadas.push(id);
  const rows = deckCardIds().map((cardId) => ({ uid: randomUUID(), user_id: id, card_id: cardId }));
  await db.from("user_cards").insert(rows);
  const deck = await db.from("duel_decks")
    .insert({ user_id: id, name: tag, card_uids: rows.map((r) => r.uid) }).select("id").maybeSingle();
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({ email, password });
  return { id, deckId: (deck.data as { id: string }).id, token: s.data.session!.access_token };
}

interface Resp { status: number; body: any; text: string; retryAfter: string | null }
async function http(token: string | null, method: "GET" | "POST", url: string, body?: unknown): Promise<Resp> {
  const h: Record<string, string> = {};
  if (token) h.authorization = `Bearer ${token}`;
  if (body) h["content-type"] = "application/json";
  const r = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* no-json */ }
  return { status: r.status, body: parsed, text, retryAfter: r.headers.get("retry-after") };
}

/** Limpia los contadores de un usuario: cada familia empieza con la cubeta a cero. */
async function resetear(userId: string): Promise<void> {
  await db.from("api_rate_limits").delete().eq("subject", userId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reparto de códigos de una ráfaga. Se IMPRIME siempre: un hueco sin explicar es un hueco. */
function reparto(rs: Resp[]): string {
  const d = new Map<number, number>();
  for (const r of rs) d.set(r.status, (d.get(r.status) ?? 0) + 1);
  return [...d.entries()].sort((a, b) => a[0] - b[0]).map(([c, n]) => `${c}x${n}`).join(" ");
}

// ───────────────────────────── programa ─────────────────────────────

async function main(): Promise<void> {
  console.log("\n" + "=".repeat(78));
  console.log("  VERIFICACIÓN DEL LÍMITE DE FRECUENCIA PvP — Bloque 7.6 (D-PVP-9)");
  console.log("=".repeat(78));
  try {
    const ping = await fetch(MM, { method: "GET" });
    servidorVivo = ping.status === 401;
    console.log(`\n  servidor: ${servidorVivo ? `${BASE} (vivo)` : `${BASE} no responde 401`}`);
  } catch { console.log(`\n  servidor: ${BASE} inaccesible`); }

  if (!servidorVivo) {
    omit("todas las familias", "un límite de frecuencia solo se comprueba por HTTP y no hay servidor");
    await limpiar(); salir();
    return;
  }

  await familia1(); await familia2(); await familia3();
  await familia4(); await familia5(); await familia6();
  familia7();
  await limpiar(); salir();
}

// ───────────── 1. EL TRÁFICO REAL PASA ─────────────

async function familia1(): Promise<void> {
  console.log("\n## 1. El tráfico real de un jugador NO se toca");

  const A = await nuevoJugador("real");
  await resetear(A.id);

  /*
   * El ritmo más rápido que produce el cliente es un sondeo cada 1.200 ms (turno del rival). Se
   * reproduce EXACTAMENTE ese ritmo durante 12 segundos: 10 peticiones. Ninguna puede fallar.
   */
  const inicio = Date.now();
  const codigos: number[] = [];
  for (let i = 0; i < 10; i++) {
    codigos.push((await http(A.token, "GET", MM)).status);
    await sleep(1_200);
  }
  const dur = Math.round((Date.now() - inicio) / 1000);
  check("10 sondeos al ritmo REAL del cliente (1,2 s) pasan todos",
    codigos.every((c) => c === 200), `${codigos.filter((c) => c === 200).length}/10 en ${dur}s`);

  /*
   * Y una partida entera: 20 acciones. Se comprueba que el límite de acciones (40/min) no la
   * corta ni de lejos — que es la prueba de que el número no se eligió a ojo.
   */
  const B = await nuevoJugador("real-b");
  await resetear(B.id);
  await http(A.token, "POST", MM, { action: "enqueue", deckId: A.deckId });
  await http(B.token, "POST", MM, { action: "enqueue", deckId: B.deckId });
  const matchId = (await http(A.token, "GET", MM)).body.entry?.matchId as string | undefined;
  check("dos jugadores se emparejan con normalidad", typeof matchId === "string", String(matchId));

  let acciones = 0, rechazos = 0;
  for (let i = 0; i < 60 && matchId; i++) {
    let movio = false;
    for (const j of [A, B]) {
      const s = (await http(j.token, "GET", `${PVP}?matchId=${matchId}`)).body.snapshot;
      if (!s || s.lifecycle === "FINISHED") { i = 60; break; }
      if (!s.isYourTurn) continue;
      const m = s.match;
      const sn = s.yourSide === "A" ? m.snapshotA : m.snapshotB;
      const usadas = new Set(s.yourSide === "A" ? m.usedA : m.usedB);
      const carta = sn.cards.find((c: any) => !usadas.has(c.uid));
      if (!carta) { i = 60; break; }
      const r = await http(j.token, "POST", PVP, {
        action: "play", matchId, actionId: randomUUID(), expectedVersion: s.stateVersion,
        cardUid: carta.uid, ...(m.attacker === s.yourSide ? { stat: "stronghold" } : {}),
      });
      if (r.status === 200) acciones++;
      if (r.status === 429) rechazos++;
      movio = true; break;
    }
    if (!movio) break;
  }
  check("una partida ENTERA se juega sin que el límite la corte",
    acciones >= 20 && rechazos === 0, `${acciones} acciones · ${rechazos} rechazos`);
}

// ───────────── 2. EL ABUSO SE CORTA ─────────────

let victima: Jugador;

async function familia2(): Promise<void> {
  console.log("\n## 2. El abuso se corta");

  victima = await nuevoJugador("abuso");

  // A/C — ráfaga de sondeos. 300 peticiones en paralelo contra un límite de 90/min.
  await resetear(victima.id);
  const rafaga = await Promise.all(Array.from({ length: 300 }, () => http(victima.token, "GET", MM)));
  const ok = rafaga.filter((r) => r.status === 200).length;
  const cortadas = rafaga.filter((r) => r.status === 429).length;
  console.log(`  · reparto de la ráfaga: ${reparto(rafaga)}`);
  check("C. 300 sondeos de cola en paralelo: la mayoría se corta con 429",
    cortadas > 0 && ok <= RATE_POLICY.mm_status.limit * 2,
    `${ok} pasaron · ${cortadas} cortadas (límite ${RATE_POLICY.mm_status.limit}/min)`);

  /*
   * NINGUNA puede responder 500. Esto encontró algo de verdad y por eso está escrito así.
   *
   * Con 300 conexiones simultáneas desde un solo proceso, la pila local de Supabase se queda sin
   * sockets («other side closed») y el cliente lanza `TypeError: fetch failed`. El `catch` final
   * de la ruta respondía entonces **500 con el texto interno del error**. Eso es dos cosas mal:
   * 500 dice «me he roto yo» cuando lo cierto es «mi dependencia no contesta», y el mensaje crudo
   * no es asunto del cliente. Ahora eso es un 503 con `Retry-After` y un texto genérico.
   *
   * Se comprueban las dos mitades por separado a propósito: que no haya 500, y que si aparece un
   * 503 sea del tipo bueno.
   */
  const quinientos = rafaga.filter((r) => r.status === 500);
  check("C. ninguna respondió 500 (una dependencia caída es 503, no 500)",
    quinientos.length === 0, quinientos.length ? `${quinientos.length}: ${quinientos[0].text.slice(0, 80)}` : "");
  const saturadas = rafaga.filter((r) => r.status === 503);
  if (saturadas.length > 0) {
    check("C. los 503 de saturación traen `Retry-After` y NO filtran el error interno",
      saturadas.every((r) => r.retryAfter !== null)
      && saturadas.every((r) => !/fetch failed|socket|econn|other side/i.test(r.text)),
      `${saturadas.length} de 300 · ${saturadas[0].body.error}`);
  } else {
    console.log("  · sin 503: la pila local aguantó la ráfaga entera esta vez");
  }

  // D — enqueue en bucle: la cubeta estricta.
  await resetear(victima.id);
  const altas = await Promise.all(Array.from({ length: 60 }, () =>
    http(victima.token, "POST", MM, { action: "enqueue", deckId: victima.deckId })));
  const altasOk = altas.filter((r) => r.status === 200).length;
  const altasCortadas = altas.filter((r) => r.status === 429).length;
  check("D. 60 altas en bucle: se cortan con 429 mucho antes",
    altasCortadas > 0 && altasOk <= RATE_POLICY.mm_write.limit * 2,
    `${altasOk} pasaron · ${altasCortadas} cortadas (límite ${RATE_POLICY.mm_write.limit}/min)`);

  // A/B — sondeo y acción de partida.
  await resetear(victima.id);
  const sondeos = await Promise.all(Array.from({ length: 400 }, () =>
    http(victima.token, "GET", `${PVP}?matchId=${randomUUID()}`)));
  const sCortadas = sondeos.filter((r) => r.status === 429).length;
  check("A. 400 sondeos de partida en paralelo: se cortan con 429",
    sCortadas > 0, `${sCortadas} cortadas de 400 (límite ${RATE_POLICY.pvp_sync.limit}/min)`);

  await resetear(victima.id);
  const acciones = await Promise.all(Array.from({ length: 150 }, () =>
    http(victima.token, "POST", PVP, {
      action: "play", matchId: randomUUID(), actionId: randomUUID(),
      expectedVersion: 0, cardUid: randomUUID(), stat: "stronghold",
    })));
  const aCortadas = acciones.filter((r) => r.status === 429).length;
  check("B/J. 150 acciones con action_id distintos: se cortan con 429",
    aCortadas >= 150 - RATE_POLICY.pvp_action.limit * 2,
    `${aCortadas} cortadas de 150 (límite ${RATE_POLICY.pvp_action.limit}/min)`);

  // G — sin token: ni siquiera llega al contador.
  const sinToken = await Promise.all(Array.from({ length: 30 }, () => http(null, "GET", MM)));
  check("G. sin token se responde 401 (y no se escribe ningún contador)",
    sinToken.every((r) => r.status === 401));
  const { count } = await db.from("api_rate_limits")
    .select("subject", { count: "exact", head: true }).eq("subject", "anon");
  check("G. las peticiones anónimas NO crean filas de contador (no son un amplificador)", (count ?? 0) === 0);
}

// ───────────── 3. LA RESPUESTA ─────────────

async function familia3(): Promise<void> {
  console.log("\n## 3. La respuesta de límite superado");

  await resetear(victima.id);
  await Promise.all(Array.from({ length: 40 }, () =>
    http(victima.token, "POST", MM, { action: "cancel" })));
  const r = await http(victima.token, "POST", MM, { action: "cancel" });

  check("el estado es 429, no 500", r.status === 429, String(r.status));
  check("trae `Retry-After` coherente con la ventana",
    r.retryAfter !== null && Number(r.retryAfter) >= 1 && Number(r.retryAfter) <= RATE_POLICY.mm_write.windowSeconds,
    `Retry-After: ${r.retryAfter}`);
  check("el cuerpo es pequeño", r.text.length < 200, `${r.text.length} bytes`);
  check("el mensaje no enumera NADA (ni id, ni partida, ni cola, ni cuántas van)",
    !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(r.text) && !/\d{2,}/.test(r.body.error ?? "")
    && !/rating|match|queue|cola|opponent|rival/i.test(r.body.error ?? ""), r.body.error);
  check("no filtra internals (ni SQL, ni traza, ni nombre de tabla)",
    !/select |insert |api_rate_limits|at .*\.ts:|Error:/i.test(r.text));
  check("el cliente puede reconocerlo por código", r.body.code === "RATE_LIMITED", String(r.body.code));

  // Las respuestas de dos cubetas distintas son IDÉNTICAS: no se puede deducir cuál se agotó.
  await resetear(victima.id);
  await Promise.all(Array.from({ length: 300 }, () => http(victima.token, "GET", MM)));
  const otra = await http(victima.token, "GET", MM);
  check("la respuesta es la MISMA sea cual sea la cubeta agotada (no es un oráculo)",
    otra.status === 429 && otra.body.error === r.body.error, `${otra.body.error}`);
}

// ───────────── 4. AISLAMIENTO ─────────────

async function familia4(): Promise<void> {
  console.log("\n## 4. El límite es por usuario y por superficie");

  const X = await nuevoJugador("aisl-x");
  const Y = await nuevoJugador("aisl-y");
  await resetear(X.id); await resetear(Y.id);

  // H — agotar la cubeta de X no debe afectar a Y.
  await Promise.all(Array.from({ length: 300 }, () => http(X.token, "GET", MM)));
  const deX = await http(X.token, "GET", MM);
  const deY = await http(Y.token, "GET", MM);
  check("H. agotado X, X recibe 429", deX.status === 429);
  check("H. y OTRO usuario sigue jugando con normalidad", deY.status === 200, String(deY.status));

  // El sujeto sale del token: mandar otro userId no cambia de cubeta.
  await resetear(X.id); await resetear(Y.id);
  await Promise.all(Array.from({ length: 60 }, () =>
    http(X.token, "POST", MM, { action: "cancel", userId: Y.id, user_id: Y.id })));
  const suplantado = await http(X.token, "POST", MM, { action: "cancel", userId: Y.id });
  check("no se evade el límite mandando otro `userId` en el cuerpo", suplantado.status === 429);
  const yTrasSuplantacion = await http(Y.token, "POST", MM, { action: "cancel" });
  check("y la cubeta de la víctima suplantada NO se ha gastado", yTrasSuplantacion.status === 200,
    String(yTrasSuplantacion.status));
  const filas = await db.from("api_rate_limits").select("subject, bucket").eq("subject", X.id);
  check("el contador se guarda bajo el id del TOKEN", (filas.data ?? []).length > 0);

  // Las superficies no se contagian: agotar escritura no cierra la consulta.
  const Z = await nuevoJugador("aisl-z");
  await resetear(Z.id);
  await Promise.all(Array.from({ length: 60 }, () => http(Z.token, "POST", MM, { action: "cancel" })));
  const escritura = await http(Z.token, "POST", MM, { action: "cancel" });
  const consulta = await http(Z.token, "GET", MM);
  check("agotar la ESCRITURA de cola no cierra la CONSULTA", escritura.status === 429 && consulta.status === 200,
    `escritura ${escritura.status} · consulta ${consulta.status}`);
  const cubetas = (await db.from("api_rate_limits").select("bucket").eq("subject", Z.id)).data ?? [];
  check("cada superficie tiene su propia cubeta", new Set(cubetas.map((c: any) => c.bucket)).size >= 2,
    cubetas.map((c: any) => c.bucket).join(","));
}

// ───────────── 5. NO SUSTITUYE A NADA ─────────────

async function familia5(): Promise<void> {
  console.log("\n## 5. El límite NO sustituye a las defensas del juego");

  const P = await nuevoJugador("db-p");
  await resetear(P.id);

  /*
   * I — el índice único parcial sigue siendo lo que impide dos entradas vivas. Se hacen 15 altas
   * simultáneas: por debajo del límite de 20/min, así que NINGUNA la corta el rate limiter, y aun
   * así solo puede quedar UNA entrada. Si el límite se quitara mañana, esto seguiría siendo cierto.
   */
  const altas = await Promise.all(Array.from({ length: 15 }, () =>
    http(P.token, "POST", MM, { action: "enqueue", deckId: P.deckId })));
  const cortadas = altas.filter((r) => r.status === 429).length;
  check("I. 15 altas simultáneas caben dentro del límite (no interfiere)", cortadas === 0, `${cortadas} cortadas`);
  const vivas = (await db.from("duel_pvp_queue").select("id")
    .eq("user_id", P.id).in("state", ["QUEUED", "PAIRING"])).data ?? [];
  check("I. y aun así solo hay UNA entrada viva: manda el índice único, no el límite",
    vivas.length === 1, `${vivas.length} entradas`);

  await db.rpc("duel_pvp_cancel", { p_user: P.id });

  /*
   * Y el contador es del SERVIDOR. Si un usuario pudiera llamar a `app_rate_take` o escribir en
   * la tabla, podría reiniciarse su propia cubeta — que es exactamente saltarse el límite. Se
   * comprueba con una sesión real de usuario, no con el `service_role`.
   */
  const suyo = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { authorization: `Bearer ${P.token}` } },
  });
  const rpc = await suyo.rpc("app_rate_take", {
    p_subject: P.id, p_bucket: "mm_status", p_limit: 1, p_window_seconds: 60,
  });
  check("un usuario NO puede llamar a `app_rate_take` (no puede reiniciarse la cubeta)",
    rpc.error !== null, rpc.error?.code ?? `¡respondió! ${JSON.stringify(rpc.data)}`);
  const barrido = await suyo.rpc("app_rate_sweep", { p_older_than_seconds: 60 });
  check("un usuario NO puede llamar a `app_rate_sweep`",
    barrido.error !== null, barrido.error?.code ?? "¡respondió!");
  const lectura = await suyo.from("api_rate_limits").select("subject").limit(1);
  check("un usuario NO puede leer los contadores (RLS sin políticas + revoke)",
    lectura.error !== null || (lectura.data ?? []).length === 0,
    lectura.error?.code ?? `${(lectura.data ?? []).length} filas`);
  const escritura = await suyo.from("api_rate_limits")
    .update({ count: 0 }).eq("subject", P.id).select("subject");
  check("un usuario NO puede poner su contador a cero",
    escritura.error !== null || (escritura.data ?? []).length === 0,
    escritura.error?.code ?? `${(escritura.data ?? []).length} filas`);
  const { count: partidas } = await db.from("duel_matches")
    .select("id", { count: "exact", head: true }).eq("mode", "PVP").eq("user_id", P.id);
  check("I. ninguna de esas altas creó partidas de más", (partidas ?? 0) === 0, `${partidas} partidas`);
}

// ───────────── 6. COMPARTIDO Y MEDIDO ─────────────

async function familia6(): Promise<void> {
  console.log("\n## 6. Compartido entre procesos, y su coste medido");

  const M = await nuevoJugador("medida");
  await resetear(M.id);

  // El contador NO está en memoria de Node: se ve desde fuera, en la tabla.
  await http(M.token, "GET", MM);
  const fila = (await db.from("api_rate_limits").select("subject, bucket, count")
    .eq("subject", M.id).eq("bucket", "mm_status").maybeSingle()).data as any;
  check("el contador vive en PostgreSQL, no en el proceso (se lee desde fuera)",
    fila?.count >= 1, `count=${fila?.count}`);
  check("y está indexado por (sujeto, superficie)", fila?.subject === M.id && fila?.bucket === "mm_status");

  /*
   * Un segundo «proceso» —otro cliente de Supabase, como si fuera otra instancia de Node— ve y
   * comparte EL MISMO contador. Es exactamente lo que un `Map` en memoria no puede hacer.
   */
  const otroProceso = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const antes = fila?.count ?? 0;
  await otroProceso.rpc("app_rate_take", {
    p_subject: M.id, p_bucket: "mm_status", p_limit: 90, p_window_seconds: 60,
  });
  const despues = (await db.from("api_rate_limits").select("count")
    .eq("subject", M.id).eq("bucket", "mm_status").maybeSingle()).data as any;
  check("otro proceso INCREMENTA el mismo contador (no tiene el suyo)",
    despues?.count === antes + 1, `${antes} → ${despues?.count}`);

  // Coste añadido: se compara el mismo endpoint con la cubeta vacía.
  await resetear(M.id);
  const t: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = Date.now();
    await http(M.token, "GET", MM);
    t.push(Date.now() - a);
    await sleep(120);
  }
  const media = t.reduce((x, y) => x + y, 0) / t.length;
  console.log(`  · sondeo de cola con límite activo: ${media.toFixed(1)} ms de media (10 muestras)`);
  check("MEDIDA: el límite no encarece el sondeo de forma perceptible", media < 400, `${media.toFixed(1)} ms`);

  const t2 = Date.now();
  await db.rpc("app_rate_take", { p_subject: M.id, p_bucket: "pvp_sync", p_limit: 150, p_window_seconds: 60 });
  console.log(`  · coste del contador solo: ${Date.now() - t2} ms`);
  check("MEDIDA: tomar un turno es una sola sentencia barata", Date.now() - t2 < 200);

  // La política es coherente con el tráfico real: cada límite deja margen sobre el ritmo del cliente.
  check("la política deja margen sobre el ritmo REAL del cliente",
    RATE_POLICY.pvp_sync.limit >= 50 * 2 && RATE_POLICY.mm_status.limit >= 30 * 2
    && RATE_POLICY.pvp_action.limit >= 20 * 1.5,
    `sync ${RATE_POLICY.pvp_sync.limit} · status ${RATE_POLICY.mm_status.limit} · acción ${RATE_POLICY.pvp_action.limit}`);
  check("cada límite documenta de dónde sale su número",
    Object.values(RATE_POLICY).every((p) => p.why.length > 40));

  /*
   * FALLO ABIERTO, comprobado en vez de supuesto.
   *
   * Se apunta un cliente a un puerto muerto: `app_rate_take` no puede responder. La decisión
   * tiene que ser DEJAR PASAR, porque el limitador es lo accesorio — si cerrara, un problema del
   * contador tumbaría el juego entero.
   *
   * Y hay que decir la otra mitad, que se midió: bajo una ráfaga muy fuerte esa llamada TAMBIÉN
   * falla (se agotan los sockets), así que el límite se afloja justo cuando más apretaría. Es la
   * consecuencia lógica de fallar abierto y queda anotada como D-RL-3, no disimulada.
   */
  const roto = createClient("http://127.0.0.1:1", SERVICE, { auth: { persistSession: false } });
  const decision = await takeRate(roto, M.id, "mm_status");
  check("si el contador no contesta, se DEJA PASAR (fallo abierto, deliberado)",
    decision.allowed === true, JSON.stringify(decision));
}

// ───────────── 7. EL CLIENTE OBEDECE ─────────────

/**
 * Quita comentarios antes de buscar. Sin esto, una cabecera que EXPLICA `setInterval` cuenta como
 * un `setInterval`, y el verificador se aprueba a sí mismo leyendo su propia documentación.
 */
function code(ruta: string): string {
  return readFileSync(join(ROOT, ruta), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}

function familia7(): void {
  console.log("\n## 7. El cliente AFLOJA cuando se lo piden");

  /*
   * Un límite que el cliente ignora no es un límite: es un servidor gastando CPU en decir que no.
   * Estas comprobaciones son de código fuente a propósito — lo que se afirma es una propiedad del
   * bucle, y un bucle solo se puede observar entero leyéndolo.
   */
  const cola = code("src/lib/duel/usePvpQueue.ts");
  check("el bucle de cola reconoce el 429", /status\s*===\s*429/.test(cola));
  check("y respeta `Retry-After` si viene", /retry-after/i.test(cola));
  check("tiene escalones de espera crecientes",
    /BACKOFF_MS\s*=\s*\[/.test(cola) && /esperaExtra/.test(cola));
  check("la espera del 429 se APLICA al reprogramar", /Math\.max\(\s*base\s*,\s*esperaExtra/.test(cola));

  /*
   * Y lo que NO debe hacer: un 429 mientras se sondea no puede tirar al jugador de la búsqueda.
   * Se comprueba que el 429 se atiende ANTES de la rama que marca error y para el sondeo.
   */
  const i429 = cola.indexOf("429");
  const iError = cola.indexOf('phase: "error"');
  check("el 429 se atiende ANTES de la rama de error (no expulsa de la cola)",
    i429 > 0 && iError > 0 && i429 < iError);
  check("el contador de frenados se reinicia con una respuesta buena",
    /frenados\.current\s*=\s*0/.test(cola));

  // El poller de partida (7.3) ya lo hacía: se comprueba que sigue siendo verdad.
  const transporte = code("src/lib/duel/pvpTransport.ts");
  check("el poller de partida ya trataba el 429 como reintentable (no hizo falta tocarlo)",
    /429\s*\)?\s*return\s+"RATE_LIMIT"/.test(transporte) && /RATE_LIMIT/.test(transporte));

  // Y el servidor: el sujeto sale del token en las dos rutas, nunca del cuerpo.
  for (const ruta of ["src/app/api/game/duel/pvp/route.ts", "src/app/api/game/duel/matchmaking/route.ts"]) {
    const r = code(ruta);
    check(`${ruta.split("/").slice(-3, -1).join("/")}: el sujeto del límite es la sesión`,
      /takeRate\(\s*session\.admin\s*,\s*session\.userId/.test(r));
    check(`${ruta.split("/").slice(-3, -1).join("/")}: no se limita por nada del cuerpo`,
      !/takeRate\([^)]*body\./.test(r) && !/takeRate\([^)]*searchParams/.test(r));
  }
}

// ───────────────────────────── cierre ─────────────────────────────

async function limpiar(): Promise<void> {
  for (const id of creadas) {
    // Sin `.catch`: el constructor de PostgREST es «thenable», no una Promise, y no lo tiene.
    try { await db.from("api_rate_limits").delete().eq("subject", id); } catch { /* da igual */ }
    try { await db.from("duel_pvp_queue").delete().eq("user_id", id); } catch { /* da igual */ }
    try { await db.auth.admin.deleteUser(id); } catch { /* da igual */ }
  }
}

function salir(): void {
  console.log("\n" + "─".repeat(78));
  console.log(`  ${pass} correctas · ${fail} fallidas${skip ? ` · ${skip} omitidas` : ""}`);
  console.log(fail === 0
    ? "  ✅ EL LÍMITE CORTA EL ABUSO Y NO ESTORBA AL JUEGO"
    : "  ❌ EL LÍMITE DE FRECUENCIA TIENE HUECOS");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e: unknown) => { console.error(e); await limpiar(); process.exit(1); });
