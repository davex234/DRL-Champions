/**
 * FASE 45 · ARRANQUE DE LA CUENTA QA POR LA VÍA REAL (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase45-bootstrap.ts <credsFile> [baseUrl]
 *
 * Lleva a la cuenta QA recién creada desde «0 cartas» hasta «mazo legal activo» usando ÚNICAMENTE la API pública
 * del producto, exactamente los mismos `POST` que dispara la interfaz cuando juega una persona:
 *
 *     GET  /api/game/state      → qué sobres tiene
 *     POST /api/game/packs      → { action: "open",         packId, ref }
 *     GET  /api/game/starter    → ¿concede el servidor un Sobre Inicial gratis? ¿qué roles faltan?
 *     POST /api/game/packs      → { action: "buy_and_open", packId, ref }   (Sobre Inicial gratis del contrato F40)
 *     POST /api/game/duels      → { action: "create" } · { action: "save_composition" } · { action: "set_active" }
 *
 * ────────────────────────── LO QUE NO HACE ──────────────────────────
 *
 * Ni un `insert`, ni un `update`, ni una sola sentencia SQL. No concede cartas, no regala créditos, no fabrica un
 * mazo en la base y no toca la economía: si al final hay diez cartas es porque el servidor las repartió con sus
 * propias probabilidades, y si hace falta un Sobre Inicial extra es porque el servidor decidió concederlo.
 *
 * El contrato de Fase 40 dice que un starter puede NO dar para plantilla legal y que entonces el servidor concede
 * Sobres Iniciales gratis hasta que dé. Aquí eso se OBSERVA y se registra; no se corrige ni se fuerza.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const f of [".env.local"]) {
  const p = join(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase45-bootstrap.ts <credsFile> [baseUrl]"); process.exit(1); }

const OUT = join(process.cwd(), "docs/product/qa/fase45/playtest");
mkdirSync(OUT, { recursive: true });

/** La regla del mazo, tal y como la define el dominio: cinco roles, dos cartas cada uno. */
const ROLES = ["Duelista", "Controlador", "Iniciador", "Centinela", "Flex"] as const;
const CUPO = 2;

const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string; userId: string };
const bitacora: unknown[] = [];
const anota = (paso: string, detalle: unknown) => { bitacora.push({ paso, detalle, instante: new Date().toISOString() }); console.log(`· ${paso}: ${JSON.stringify(detalle)}`); };

/* eslint-disable @typescript-eslint/no-explicit-any */
async function main() {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error || !data.session) throw new Error(`no se pudo iniciar sesión: ${error?.message}`);
  const token = data.session.access_token;
  const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const get = async (ruta: string) => {
    const r = await fetch(`${BASE}${ruta}`, { headers: H, cache: "no-store" });
    if (!r.ok) throw new Error(`GET ${ruta} → ${r.status} ${await r.text()}`);
    return r.json() as Promise<any>;
  };
  const post = async (ruta: string, cuerpo: unknown) => {
    const r = await fetch(`${BASE}${ruta}`, { method: "POST", headers: H, body: JSON.stringify(cuerpo) });
    const txt = await r.text();
    if (!r.ok) throw new Error(`POST ${ruta} → ${r.status} ${txt}`);
    return JSON.parse(txt) as any;
  };

  // ── 1 · QUÉ TRAE EL STARTER ──────────────────────────────────────────────
  /*
   * La forma real de `/api/game/state`: `ownedCards` (no `cards`) y `unopenedPacks` como MAPA
   * `{ inicial: 3, estandar: 1 }` (no una lista). Se lee tal cual viene; no se normaliza en ningún sitio más.
   */
  const cartasDe = (e: any): any[] => e.ownedCards ?? [];
  /*
   * EL ROL NO VIVE EN `/api/game/state`. Allí una carta es `{ uid, cardId }` y nada más: el rol lo pone el
   * catálogo. La fuente correcta es `GET /api/game/duels`, que es EXACTAMENTE la que usa el constructor de mazos
   * (`fetchDuelDecks`) y devuelve `collection` con el rol ya resuelto. Preguntárselo a la misma pieza que usa la
   * interfaz evita inventarse una segunda forma de saber qué rol tiene una carta.
   */
  const coleccion = async (): Promise<any[]> => (await get("/api/game/duels")).collection ?? [];
  const sobresDe = (e: any): [string, number][] => Object.entries(e.unopenedPacks ?? {}) as [string, number][];

  let estado = await get("/api/game/state");
  anota("estado inicial", { creditos: estado.credits, cartas: cartasDe(estado).length, sobres: sobresDe(estado) });

  // ── 2 · ABRIR TODO LO QUE HAY, COMO LO HARÍA UN JUGADOR ──────────────────
  let abiertos = 0;
  for (const [packId, qty] of sobresDe(estado)) {
    for (let i = 0; i < qty; i++) {
      const r = await post("/api/game/packs", { action: "open", packId, ref: randomUUID() });
      abiertos++;
      anota(`abre ${packId}`, { cartas: (r.opened ?? []).map((c: any) => `${c.name}/${c.role}`) });
    }
  }

  // ── 3 · ¿DA PARA PLANTILLA LEGAL? SI NO, EL CONTRATO F40 ─────────────────
  const cuentaRoles = (cards: any[]) =>
    Object.fromEntries(ROLES.map((rol) => [rol, cards.filter((c) => c.role === rol).length]));
  const legal = (cards: any[]) => ROLES.every((rol) => cards.filter((c) => c.role === rol).length >= CUPO);

  estado = await get("/api/game/state");
  let col = await coleccion();
  anota("tras abrir el starter", { cartas: col.length, porRol: cuentaRoles(col), legal: legal(col) });

  let inicialesGratis = 0;
  while (!legal(col)) {
    const starter = await get("/api/game/starter");
    anota("consulta Sobre Inicial", starter);
    // `readStarterStatus` decide; aquí sólo se obedece. Si dice que no, se para y se dice por qué.
    if (!starter?.grant && !starter?.eligible && !starter?.canGrant) {
      throw new Error(`el servidor no concede más Sobres Iniciales y el mazo aún no es legal: ${JSON.stringify(starter)}`);
    }
    const packId = starter.packId ?? starter.pack?.id ?? "starter";
    const r = await post("/api/game/packs", { action: "buy_and_open", packId, ref: randomUUID() });
    inicialesGratis++;
    anota(`Sobre Inicial gratis #${inicialesGratis}`, { cartas: (r.opened ?? []).map((c: any) => `${c.name}/${c.role}`) });
    col = await coleccion();
    if (inicialesGratis > 12) throw new Error("demasiados Sobres Iniciales sin alcanzar plantilla legal: se para y se informa");
  }
  anota("plantilla legal alcanzada", { cartas: col.length, porRol: cuentaRoles(col), sobresAbiertos: abiertos, inicialesGratis });

  // ── 4 · MAZO: dos por rol, los de mayor OVR ──────────────────────────────
  const elegidas: any[] = [];
  for (const rol of ROLES) {
    const delRol = col.filter((c: any) => c.role === rol).sort((a: any, b: any) => b.ovr - a.ovr);
    elegidas.push(...delRol.slice(0, CUPO));
  }
  if (elegidas.length !== 10) throw new Error(`se eligieron ${elegidas.length} cartas y el mazo son 10`);
  const uids = elegidas.map((c: any) => c.uid);

  /*
   * EL CONTRATO REAL DEL CONSTRUCTOR (cabecera de `api/game/duels/route.ts`):
   *   { action: "create",           name?, cardUids? }
   *   { action: "save_composition", id, name, cardUids, expectedVersion }
   *   { action: "set_active",       id, expectedVersion? }
   * OJO: la cabecera de esa ruta documenta `expectedVersion`, pero el esquema que de verdad valida
   * (`DECK_SCHEMA` en `domain/deckBuilder/request.ts`) exige **`baseVersion`**. Manda el esquema; la cabecera
   * está desactualizada. Cualquier campo fuera de la lista devuelve «Campo no permitido», que es lo correcto
   * para una API que no acepta campos sueltos.
   *
   * Y la versión que espera es `deck.version` (marca ISO), NO `deck.updatedAt` (milisegundos): mandar el número
   * devuelve «Versión no válida». Las dos cosas viajan en el mismo objeto y se parecen mucho; sólo una vale.
   *
   * IDEMPOTENTE a propósito: si un intento anterior ya dejó el equipo «QA F45» creado, se reutiliza en vez de
   * llenar la cuenta de equipos vacíos.
   */
  const NOMBRE = "QA F45";
  const espacio = await get("/api/game/duels");
  const existente = (espacio.decks ?? []).find((d: any) => d.name === NOMBRE);

  let deckId: string;
  if (existente) {
    deckId = existente.id;
    await post("/api/game/duels", { action: "save_composition", id: deckId, name: NOMBRE, cardUids: uids, baseVersion: existente.version });
    anota("composición guardada en el equipo existente", { deckId, cartas: elegidas.map((c: any) => `${c.name}/${c.role}/${c.ovr}`) });
  } else {
    const creado = await post("/api/game/duels", { action: "create", name: NOMBRE, cardUids: uids });
    deckId = creado.deck?.id ?? creado.id;
    anota("equipo creado con su composición", { deckId, cartas: elegidas.map((c: any) => `${c.name}/${c.role}/${c.ovr}`) });
  }

  const tras = await get("/api/game/duels");
  const mio = (tras.decks ?? []).find((d: any) => d.id === deckId);
  await post("/api/game/duels", { action: "set_active", id: deckId, baseVersion: mio?.version });
  anota("equipo activo", { deckId, valido: mio?.valid ?? mio?.isValid ?? "?" });

  const fin = await get("/api/game/state");
  anota("estado final del arranque", { creditos: fin.credits, cartas: cartasDe(fin).length, sobres: sobresDe(fin) });

  const destino = join(OUT, "bootstrap.json");
  writeFileSync(destino, JSON.stringify({ userId: creds.userId, deckId, sobresAbiertos: abiertos, inicialesGratis, bitacora }, null, 2));
  console.log(`\nARRANQUE OK · deck=${deckId} · sobres abiertos=${abiertos} · Sobres Iniciales gratis=${inicialesGratis}\n→ ${destino}`);
}

main().catch((e) => { console.error("ERROR", e instanceof Error ? e.message : e); process.exit(1); });
