/**
 * VERIFICACIÓN DE SINCRONIZACIÓN PvP — `npm run pvp-sync:verify` (Bloque 7.3).
 *
 * Ataca el endpoint REAL `/api/game/duel/pvp` por HTTP, con DOS cuentas de verdad y sus
 * Bearer de verdad. No hay mocks: si el servidor filtrara un secreto o aceptara a un intruso,
 * esto lo vería.
 *
 * Necesita el servidor levantado. Usa `BASE_URL` (o `E2E_BASE_URL`), por defecto :3005.
 *
 * Cinco familias:
 *
 *   AUTORIZACIÓN — sin token, con token ajeno, y los dos jugadores legítimos.
 *   CONTRATO     — stateVersion, changed, terminal, serverNow.
 *   SECRETO      — barrido del JSON: ni una carta oculta del rival, ni un id de tercero.
 *   DOS CLIENTES — A → servidor → B y B → servidor → A, que es la prueba obligatoria.
 *   CONCURRENCIA — misma versión, action_id repetida, y stale rechazada.
 *
 * Crea sus cuentas y su partida, y lo borra todo al terminar.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CARDS } from "../src/data/catalog";
import { CardRegistry } from "../src/collection/registry";
import { DUEL_ROLES } from "../src/domain/cardgame";
import type { RoleId } from "../src/domain/cards/types";
import { createPvpMatch } from "../src/server/services/duelsPvp";
import type { PvpSyncResponse } from "../src/domain/cardgame/pvp";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

let pass = 0;
let fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL_ || !SERVICE || !ANON) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
  process.exit(1);
}
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const ENDPOINT = `${BASE}/api/game/duel/pvp`;

// ───────────────────────────── utillaje ─────────────────────────────

const registry = new CardRegistry();

function deckCardIds(block: number): string[] {
  const best = new Map<string, (typeof CARDS)[number]>();
  for (const c of CARDS) {
    const b = best.get(c.playerId);
    if (!b || c.ovr > b.ovr) best.set(c.playerId, c);
  }
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const c of best.values()) {
    const p = registry.player(c.playerId);
    if (p) byRole.set(p.role, [...(byRole.get(p.role) ?? []), c]);
  }
  for (const [, arr] of byRole) arr.sort((x, y) => y.ovr - x.ovr || x.id.localeCompare(y.id));
  return DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(block * 2, block * 2 + 2)).map((c) => c.id);
}

const creadas: string[] = [];

interface Jugador { id: string; deckId: string; token: string; email: string }

async function nuevoJugador(tag: string, block: number): Promise<Jugador> {
  const email = `pvpsync-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  const id = data.user.id;
  creadas.push(id);

  const rows = deckCardIds(block).map((cardId) => ({ uid: randomUUID(), user_id: id, card_id: cardId }));
  const ins = await db.from("user_cards").insert(rows);
  if (ins.error) throw new Error(`cartas: ${ins.error.message}`);

  const deck = await db.from("duel_decks")
    .insert({ user_id: id, name: `Mazo ${tag}`, card_uids: rows.map((r) => r.uid) })
    .select("id").maybeSingle();
  if (deck.error || !deck.data) throw new Error(`mazo: ${deck.error?.message}`);

  // Bearer REAL: el mismo que usaría el navegador.
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const sign = await anon.auth.signInWithPassword({ email, password });
  if (sign.error || !sign.data.session) throw new Error(`login: ${sign.error?.message}`);

  return { id, deckId: (deck.data as { id: string }).id, token: sign.data.session.access_token, email };
}

interface Respuesta { status: number; body: Record<string, unknown>; bytes: number; ms: number }

async function get(token: string | null, matchId: string, since?: number): Promise<Respuesta> {
  const q = new URLSearchParams({ matchId });
  if (since !== undefined) q.set("since", String(since));
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const t0 = Date.now();
  const res = await fetch(`${ENDPOINT}?${q.toString()}`, { headers });
  const text = await res.text();
  const ms = Date.now() - t0;
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* no-json */ }
  return { status: res.status, body, bytes: Buffer.byteLength(text, "utf8"), ms };
}

async function post(token: string, payload: Record<string, unknown>): Promise<Respuesta> {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* no-json */ }
  return { status: res.status, body, bytes: Buffer.byteLength(text, "utf8"), ms };
}

const sync = (r: Respuesta) => r.body as unknown as PvpSyncResponse;

/** Todas las cadenas de un JSON, para poder barrerlo de verdad y no por lista negra. */
function todasLasCadenas(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) todasLasCadenas(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) todasLasCadenas(x, out);
  return out;
}

// ───────────────────────────── ejecución ─────────────────────────────

async function main(): Promise<void> {
  console.log(`# Verificación de sincronización PvP — NEXUS (Bloque 7.3)\n# Servidor: ${BASE}\n`);

  const ping = await fetch(BASE).catch(() => null);
  if (!ping) {
    console.error(`❌ No hay servidor en ${BASE}. Arranca 'npx next start -p 3005' (o fija BASE_URL).`);
    process.exit(1);
  }

  const A = await nuevoJugador("a", 0);
  const B = await nuevoJugador("b", 1);
  const C = await nuevoJugador("c", 2);

  const creada = await createPvpMatch(db, { playerId: A.id, deckId: A.deckId }, { playerId: B.id, deckId: B.deckId });
  if (!creada.ok || !creada.data) { console.error("no se pudo crear la partida PvP"); await limpiar(); process.exit(1); }
  const matchId = creada.data.view.matchId;

  // ─────────────── 1. AUTORIZACIÓN ───────────────
  console.log("## 1. Autorización");

  const anon = await get(null, matchId);
  check("GET exige autenticación", anon.status === 401, `${anon.status}`);

  const rA = await get(A.token, matchId);
  const rB = await get(B.token, matchId);
  check("A (jugador) puede sincronizar", rA.status === 200, `${rA.status}`);
  check("B (jugador) puede sincronizar", rB.status === 200, `${rB.status}`);

  const rC = await get(C.token, matchId);
  check("C (ajeno) NO puede sincronizar", rC.status === 404, `${rC.status}`);
  check("SEGURIDAD: al ajeno se le responde 404, no 403 (sin oráculo de existencia)",
    rC.status === 404, `${rC.status}`);

  const inventada = await get(A.token, randomUUID());
  check("una partida inexistente responde igual que una ajena (404)", inventada.status === 404);

  // ─────────────── 2. CONTRATO ───────────────
  console.log("\n## 2. Contrato de respuesta");

  const sA = sync(rA);
  check("la respuesta trae stateVersion", typeof sA.stateVersion === "number", `v=${sA.stateVersion}`);
  check("la respuesta trae serverNow", typeof sA.serverNow === "number" && sA.serverNow > 0);
  check("la respuesta trae terminal", typeof sA.terminal === "boolean", `${sA.terminal}`);
  check("primera lectura ⇒ changed=true con snapshot", sA.changed === true && !!(sA as { snapshot?: unknown }).snapshot);
  check("A y B ven la MISMA state_version", sA.stateVersion === sync(rB).stateVersion,
    `A=${sA.stateVersion} B=${sync(rB).stateVersion}`);

  const sinCambios = await get(A.token, matchId, sA.stateVersion);
  check("changed=false cuando la versión coincide", sync(sinCambios).changed === false);
  check("changed=false NO reenvía el estado", !("snapshot" in sync(sinCambios)));
  check("changed=false sigue trayendo serverNow (para el reloj)",
    typeof sync(sinCambios).serverNow === "number");

  // Aquí la partida está en la versión 0, así que NO existe una versión más vieja que pedir:
  // lo que se comprueba es la otra mitad de la regla —si `since` NO coincide, se manda el
  // estado completo—. El caso «versión más vieja» se comprueba en el §4, ya con historial.
  const desdeOtra = await get(A.token, matchId, sA.stateVersion + 5);
  check("changed=true cuando `since` no coincide con la versión actual",
    sync(desdeOtra).changed === true, `since=${sA.stateVersion + 5}`);

  const bytesCompleto = rA.bytes;
  const bytesVacio = sinCambios.bytes;
  check("MEDIDA: el sondeo sin cambios es mucho más barato que el completo",
    bytesVacio * 10 < bytesCompleto,
    `completo ${bytesCompleto} B · sin cambios ${bytesVacio} B (${(bytesCompleto / bytesVacio).toFixed(0)}× menos)`);

  // ─────────────── 3. SECRETO ───────────────
  console.log("\n## 3. Secreto (barrido del JSON real)");

  const snapA = (sA as { snapshot: { match: { snapshotA: { cards: unknown[] }; snapshotB: { cards: unknown[] } } } }).snapshot;
  check("A conserva su mazo entero", snapA.match.snapshotA.cards.length === 10);
  check("SECRETO: A no recibe ni una carta oculta de B", snapA.match.snapshotB.cards.length === 0);

  const snapB = (sync(rB) as { snapshot: { match: { snapshotA: { cards: unknown[] }; snapshotB: { cards: unknown[] } } } }).snapshot;
  check("B conserva su mazo entero", snapB.match.snapshotB.cards.length === 10);
  check("SECRETO: B no recibe ni una carta oculta de A", snapB.match.snapshotA.cards.length === 0);

  const cadenasA = todasLasCadenas(rA.body);
  check("SECRETO: el JSON de A NO contiene el id de usuario de B", !cadenasA.includes(B.id));
  check("SECRETO: el JSON de A no contiene su propio id de usuario (no hace falta)", !cadenasA.includes(A.id));
  check("SECRETO: no viaja ningún email", !cadenasA.some((s) => s.includes("@")));
  check("SECRETO: no viaja el id del mazo de B", !cadenasA.includes(B.deckId));
  check("SECRETO: no viaja ningún token ni cookie",
    !cadenasA.some((s) => s.startsWith("ey") && s.length > 100));
  const claves = JSON.stringify(rA.body);
  check("SECRETO: no aparecen campos internos (rng, semillas, closed_by, user_id)",
    !/"rng"|"seed"|"seedA"|"seedB"|"closed_by"|"user_id"|"player_b_id"|"expectedPlayer"/.test(claves));

  // ─────────────── 4. DOS CLIENTES (obligatorio) ───────────────
  console.log("\n## 4. Dos clientes reales: A → servidor → B → servidor → A");

  const v0 = sA.stateVersion;
  const turnoDe = (s: PvpSyncResponse): "A" | "B" | null =>
    s.changed ? s.snapshot.expectedSide : null;
  const quien = turnoDe(sA);
  check("ambos clientes coinciden en de quién es el turno",
    quien !== null && quien === turnoDe(sync(rB)), `turno=${quien}`);

  const primero = quien === "A" ? A : B;
  const segundo = quien === "A" ? B : A;
  const snapPrimero = quien === "A" ? snapA : snapB;
  const cartaPrimero = (quien === "A"
    ? snapPrimero.match.snapshotA.cards
    : snapPrimero.match.snapshotB.cards) as { uid: string }[];

  const acc1 = await post(primero.token, {
    action: "play", matchId, actionId: randomUUID(), expectedVersion: v0,
    cardUid: cartaPrimero[0].uid, stat: "stronghold",
  });
  check("el jugador en turno actúa por HTTP", acc1.status === 200, `${acc1.status} ${String(acc1.body.error ?? "")}`);
  const v1 = sync(acc1).stateVersion;
  check("quien actúa recibe su estado nuevo EN LA RESPUESTA (no espera al sondeo)",
    sync(acc1).changed === true && v1 === v0 + 1, `${v0} → ${v1}`);

  const rivalDetecta = await get(segundo.token, matchId, v0);
  check("el RIVAL detecta el cambio sondeando desde su versión",
    sync(rivalDetecta).changed === true && sync(rivalDetecta).stateVersion === v1,
    `v=${sync(rivalDetecta).stateVersion}`);

  // Y ahora al revés: el segundo actúa y el primero lo detecta.
  const trasPrimera = sync(rivalDetecta) as { snapshot: { expectedSide: "A" | "B" | null; match: { snapshotA: { cards: { uid: string }[] }; snapshotB: { cards: { uid: string }[] } }; yourSide: "A" | "B" } };
  const leTocaAlSegundo = trasPrimera.snapshot.expectedSide === trasPrimera.snapshot.yourSide;
  check("tras la acción de A, el turno pasa a B", leTocaAlSegundo,
    `expected=${trasPrimera.snapshot.expectedSide} yourSide=${trasPrimera.snapshot.yourSide}`);

  let v2 = v1;
  if (leTocaAlSegundo) {
    const misCartas = trasPrimera.snapshot.yourSide === "A"
      ? trasPrimera.snapshot.match.snapshotA.cards
      : trasPrimera.snapshot.match.snapshotB.cards;
    const acc2 = await post(segundo.token, {
      action: "play", matchId, actionId: randomUUID(), expectedVersion: v1,
      cardUid: misCartas[0].uid, stat: "stronghold",
    });
    check("el segundo jugador actúa por HTTP", acc2.status === 200, `${acc2.status} ${String(acc2.body.error ?? "")}`);
    v2 = sync(acc2).stateVersion;
    check("la versión vuelve a avanzar", v2 === v1 + 1, `${v1} → ${v2}`);

    const primeroDetecta = await get(primero.token, matchId, v1);
    check("el PRIMER jugador detecta el cambio del segundo (B → servidor → A)",
      sync(primeroDetecta).changed === true && sync(primeroDetecta).stateVersion === v2,
      `v=${sync(primeroDetecta).stateVersion}`);
  }

  // El secreto se mantiene DESPUÉS de jugar: solo se ve lo que se puso sobre la mesa.
  // Y aquí SÍ existe una versión más vieja (0) que la actual, así que se comprueba de verdad.
  const despuesA = await get(A.token, matchId, 0);
  check("changed=true cuando la versión pedida es MÁS VIEJA que la actual",
    sync(despuesA).changed === true && sync(despuesA).stateVersion > 0,
    `since=0 → v=${sync(despuesA).stateVersion}`);
  const dA = (sync(despuesA) as { snapshot: { match: DuelSnapPair } }).snapshot.match;
  check("SECRETO tras jugar: A solo ve del mazo de B lo ya jugado",
    dA.snapshotB.cards.length === dA.usedB.length,
    `visibles=${dA.snapshotB.cards.length} jugadas=${dA.usedB.length}`);

  // ─────────────── 5. CONCURRENCIA ───────────────
  console.log("\n## 5. Concurrencia por HTTP");

  const actual = await get(A.token, matchId, 0);
  const vAhora = sync(actual).stateVersion;
  const sAhora = (sync(actual) as { snapshot: { expectedSide: "A" | "B" | null; yourSide: "A" | "B"; match: DuelSnapPair } }).snapshot;
  const enTurno = sAhora.expectedSide === "A" ? A : B;

  const vista = await get(enTurno.token, matchId, 0);
  const sv = (sync(vista) as { snapshot: { yourSide: "A" | "B"; match: DuelSnapPair } }).snapshot;
  const mias = sv.yourSide === "A" ? sv.match.snapshotA.cards : sv.match.snapshotB.cards;
  const usadas = new Set([...sv.match.usedA, ...sv.match.usedB]);
  const libres = mias.filter((c) => !usadas.has(c.uid));

  const [c1, c2] = await Promise.all([
    post(enTurno.token, { action: "play", matchId, actionId: randomUUID(), expectedVersion: vAhora, cardUid: libres[0].uid, stat: "stronghold" }),
    post(enTurno.token, { action: "play", matchId, actionId: randomUUID(), expectedVersion: vAhora, cardUid: (libres[1] ?? libres[0]).uid, stat: "stronghold" }),
  ]);
  const ok = [c1, c2].filter((r) => r.status === 200);
  const stale = [c1, c2].filter((r) => r.body.code === "STALE_VERSION");
  check("dos acciones sobre la MISMA versión: solo una gana", ok.length === 1, `ok=${ok.length}`);
  check("la perdedora recibe STALE_VERSION con 409", stale.length === 1 && stale[0].status === 409,
    `${stale[0]?.status} ${String(stale[0]?.body.code)}`);

  // action_id repetida por HTTP.
  const trasCarrera = await get(A.token, matchId, 0);
  const vCarrera = sync(trasCarrera).stateVersion;
  const sCarrera = (sync(trasCarrera) as { snapshot: { expectedSide: "A" | "B" | null; match: DuelSnapPair } }).snapshot;
  if (sCarrera.expectedSide) {
    const jug = sCarrera.expectedSide === "A" ? A : B;
    const v = await get(jug.token, matchId, 0);
    const s = (sync(v) as { snapshot: { yourSide: "A" | "B"; match: DuelSnapPair } }).snapshot;
    const propias = s.yourSide === "A" ? s.match.snapshotA.cards : s.match.snapshotB.cards;
    const gastadas = new Set([...s.match.usedA, ...s.match.usedB]);
    const libre = propias.find((c) => !gastadas.has(c.uid));
    if (libre) {
      const idem = randomUUID();
      const p1 = await post(jug.token, { action: "play", matchId, actionId: idem, expectedVersion: vCarrera, cardUid: libre.uid, stat: "stronghold" });
      const p2 = await post(jug.token, { action: "play", matchId, actionId: idem, expectedVersion: vCarrera, cardUid: libre.uid, stat: "stronghold" });
      check("IDEMPOTENCIA por HTTP: la misma action_id no produce dos transiciones",
        p1.status === 200 && p2.status === 200 && sync(p1).stateVersion === sync(p2).stateVersion,
        `v1=${sync(p1).stateVersion} v2=${sync(p2).stateVersion}`);
    }
  }

  // Versión vieja explícita.
  const staleRes = await post(A.token, {
    action: "play", matchId, actionId: randomUUID(), expectedVersion: 0,
    cardUid: randomUUID(), stat: "stronghold",
  });
  check("una expectedVersion vieja se rechaza", staleRes.status === 409 || staleRes.status === 400,
    `${staleRes.status} ${String(staleRes.body.code ?? "")}`);

  const ajenoActua = await post(C.token, {
    action: "play", matchId, actionId: randomUUID(), expectedVersion: vCarrera,
    cardUid: randomUUID(), stat: "stronghold",
  });
  check("SEGURIDAD: un ajeno no puede actuar (404)", ajenoActua.status === 404, `${ajenoActua.status}`);

  // ─────────────── 6. TERMINAL ───────────────
  console.log("\n## 6. Estados terminales");

  const aband = await post(B.token, { action: "abandon", matchId });
  check("abandonar responde con el contrato de sincronización", aband.status === 200 && sync(aband).changed === true);
  check("terminal=true tras ABANDONED", sync(aband).terminal === true);
  const trasAband = await get(A.token, matchId, 0);
  check("el rival ve terminal=true al sincronizar", sync(trasAband).terminal === true);
  check("el estado final sigue consultable (no se borró la partida)", trasAband.status === 200);
  const lifecycle = (sync(trasAband) as { snapshot: { lifecycle: string } }).snapshot.lifecycle;
  check("el ciclo de vida es ABANDONED", lifecycle === "ABANDONED", lifecycle);

  const trasCierre = await post(A.token, {
    action: "play", matchId, actionId: randomUUID(), expectedVersion: sync(trasAband).stateVersion,
    cardUid: randomUUID(), stat: "stronghold",
  });
  check("una partida terminal no acepta acciones", trasCierre.status === 409 || trasCierre.status === 400,
    `${trasCierre.status} ${String(trasCierre.body.code ?? "")}`);

  // ─────────────── 7. MEDIDAS ───────────────
  console.log("\n## 7. Medidas");

  const muestras: number[] = [];
  let bytesTotal = 0;
  const vFinal = sync(trasAband).stateVersion;
  for (let i = 0; i < 10; i++) {
    const r = await get(A.token, matchId, vFinal);
    muestras.push(r.ms); bytesTotal += r.bytes;
  }
  const media = muestras.reduce((a, b) => a + b, 0) / muestras.length;
  console.log(`  · sondeo completo      : ${bytesCompleto} B · ${rA.ms} ms`);
  console.log(`  · sondeo sin cambios   : ${Math.round(bytesTotal / 10)} B · ${media.toFixed(1)} ms de media (10 muestras)`);
  console.log(`  · ratio de ahorro      : ${(bytesCompleto / (bytesTotal / 10)).toFixed(0)}× menos bytes`);
  check("MEDIDA: el sondeo sin cambios responde rápido", media < 500, `${media.toFixed(1)} ms`);

  await limpiar();
  salir();
}

interface DuelSnapPair {
  snapshotA: { cards: { uid: string }[] };
  snapshotB: { cards: { uid: string }[] };
  usedA: string[];
  usedB: string[];
}

async function limpiar(): Promise<void> {
  for (const id of creadas) await db.auth.admin.deleteUser(id).catch(() => {});
}

function salir(): void {
  console.log("\n" + "─".repeat(60));
  console.log(`  ${pass} correctas · ${fail} fallidas`);
  console.log(fail === 0 ? "  ✅ LA SINCRONIZACIÓN PvP FUNCIONA Y NO FILTRA" : "  ❌ LA SINCRONIZACIÓN TIENE HUECOS");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e: unknown) => {
  console.error(e);
  await limpiar();
  process.exit(1);
});
