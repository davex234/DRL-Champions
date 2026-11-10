/**
 * VERIFICACIÓN DE POOLS Y DISTRIBUCIÓN — `npm run content-pools:verify` (Bloque 8.3).
 *
 * Nueve familias. La 2 es la que decide el bloque: **si aparece una sola divergencia con el
 * motor anterior, esto no está READY.**
 *
 *   1. MODELO        — pools, entradas, vínculos y versión coherentes; sin huérfanos.
 *   2. DETERMINISMO  — el motor con configuración persistida entrega EXACTAMENTE las mismas
 *                      cartas que el de antes. Y no solo en el camino fácil: se cubren
 *                      garantías, `guaranteedMin`, pity, las cinco políticas anti-duplicado,
 *                      `repeatable:false`, pool explícito, variantes y series.
 *   3. EQUIVALENCIA  — `pickWeighted` con peso 1 devuelve el MISMO índice que `rng.pick` y
 *                      consume la MISMA tirada. Comprobado sobre el generador real.
 *   4. MATEMÁTICA    — 10/20/5 → 28,571 % / 57,143 % / 14,286 %. Y los casos límite.
 *   5. ESTADÍSTICA   — una simulación grande converge a los pesos. NO sustituye a la 4.
 *   6. CICLO DE VIDA — draft fuera, retirada fuera de nuevos drops, instancias intactas.
 *   7. VALIDACIÓN    — peso 0, negativo, enorme, carta inexistente, pool inexistente,
 *                      duplicados, pool vacío, transiciones ilegales.
 *   8. SEGURIDAD     — anónimo, usuario normal, suplantación, API directa, admin válido.
 *   9. RENDIMIENTO   — carga, caché, apertura, invalidación.
 *
 * Crea sus datos y los borra. Deja la base como la encontró.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PACKS } from "../src/data/packs";
import { CardRegistry } from "../src/collection/registry";
import { PackEngine } from "../src/pack";
import { buildPool } from "../src/domain/packs/pool";
import { freshPity, pityKey } from "../src/domain/packs/pity";
import { pickWeighted, effectiveProbabilities, DEFAULT_WEIGHT } from "../src/domain/packs/weighted";
import { composeDistribution, type PoolDef } from "../src/domain/packs/distribution";
import { makeRng } from "../src/sim/rng";
import { serverCatalog, resetServerCatalog } from "../src/server/catalog";
import { serverDistribution, resetServerDistribution } from "../src/server/catalog/distribution";
import type { PackDef, RarityBucket } from "../src/domain/packs/types";
import type { OwnedCard, VariantId } from "../src/domain/cards/types";
import { isTeamPackCard } from "../src/data/teamIdentities";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL_ || !SERVICE || !ANON) { console.error("Falta configuración de Supabase"); process.exit(1); }
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");

let pass = 0, fail = 0, skip = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const omit = (l: string, w: string): void => { console.log(`  [SKIP] ${l} — ${w}`); skip++; };
const title = (s: string): void => console.log(`\n─── ${s} ${"─".repeat(Math.max(0, 68 - s.length))}`);

const cuentas: string[] = [];
const poolsCreados: string[] = [];
let servidorVivo = false;

async function cuenta(tag: string): Promise<{ id: string; token: string }> {
  const email = `pool83-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  cuentas.push(data.user.id);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw new Error(`login: ${s.error?.message}`);
  return { id: data.user.id, token: s.data.session.access_token };
}
const http = async (p: string, init: RequestInit = {}): Promise<{ status: number; body: string }> => {
  const r = await fetch(`${BASE}${p}`, { ...init, cache: "no-store" });
  return { status: r.status, body: await r.text().catch(() => "") };
};

/** Registro construido desde el catálogo PERSISTIDO sorteable. */
async function registroPersistido(): Promise<CardRegistry> {
  const cat = await serverCatalog(db);
  return cat.packEngine.registry;
}

// ───────────────────────────── 1 · MODELO ─────────────────────────────

async function familiaModelo(): Promise<void> {
  title("1 · EL MODELO SE SOSTIENE");

  const { data: pools } = await db.from("content_pools").select("*");
  const ps = (pools ?? []) as { id: string; lifecycle: string; mode: string; checksum: string }[];
  check("hay pools persistidos", ps.length >= PACKS.length, `${ps.length} pools`);
  check("todos los pools migrados están ACTIVOS",
    ps.filter((p) => p.id.startsWith("pack-")).every((p) => p.lifecycle === "ACTIVE"),
    `${ps.filter((p) => p.lifecycle === "ACTIVE").length} activos`);
  check("cada pool tiene huella", ps.every((p) => p.checksum.length === 64), "sha256 por pool");

  const { data: binds } = await db.from("content_pack_pools").select("pack_id, pool_id");
  const bs = (binds ?? []) as { pack_id: string; pool_id: string }[];
  const packIds = new Set(PACKS.map((p) => p.id));
  check("todo vínculo apunta a un sobre que existe", bs.every((b) => packIds.has(b.pack_id)),
    `${bs.length} vínculos · ${bs.filter((b) => !packIds.has(b.pack_id)).length} huérfanos`);
  check("los 12 sobres tienen pool", new Set(bs.map((b) => b.pack_id)).size === PACKS.length,
    `${new Set(bs.map((b) => b.pack_id)).size} de ${PACKS.length}`);

  // La pregunta que H-4 decía que no se podía responder.
  const { data: enPools } = await db.from("content_pool_entries")
    .select("pool_id").eq("card_id", "benjy__silver").eq("mode", "INCLUDE");
  check("«¿en qué pools sale esta carta?» ya es un select", (enPools ?? []).length > 0,
    `benjy__silver en ${(enPools ?? []).length} pools — H-4 cerrado`);

  const { data: health } = await db.from("v_pool_health").select("*");
  const h = (health ?? []) as { pool_id: string; includes_no_publicadas: number }[];
  check("ningún pool activo incluye cartas no publicadas",
    h.every((r) => Number(r.includes_no_publicadas) === 0), `${h.length} pools revisados`);
}

// ───────────────────────────── 2 · DETERMINISMO ─────────────────────────────

/**
 * Sobres SINTÉTICOS que recorren lo que los 12 reales NO usan.
 *
 * Auditado: ningún sobre del juego usa `pity`, `guarantees`, `antiDuplicate`,
 * `repeatable:false`, `pool`, `allowedVariants`, `excludeVariants`, `series` ni
 * `serializedOnly`. Es decir, las pruebas de determinismo de 8.1 y 8.2 solo recorrieron el
 * camino rápido de `openPack`. Estos sobres existen para cubrir el resto: la ruta
 * `filtered()`, la rama de pity y las cinco políticas anti-duplicado.
 */
function sobresSinteticos(base: PackDef): PackDef[] {
  const w: Record<RarityBucket, number> = { common: 50, uncommon: 30, rare: 15, epic: 4, legendary: 1 };
  const mk = (over: Partial<PackDef>, id: string): PackDef =>
    ({ ...base, id: `synth-${id}`, name: `synth ${id}`, weights: w, cardCount: 5, ...over });
  return [
    mk({ guaranteedMin: "rare" }, "guaranteedMin"),
    mk({ guarantees: [{ count: 2, minBucket: "rare" }] }, "guarantee-bucket"),
    mk({ guarantees: [{ count: 1, groups: ["regional"] }] }, "guarantee-group"),
    mk({ guarantees: [{ count: 1, serialized: true }] }, "guarantee-serialized"),
    mk({ pity: { minBucket: "epic", threshold: 3 } }, "pity"),
    mk({ antiDuplicate: "avoid" }, "ad-avoid"),
    mk({ antiDuplicate: "replace" }, "ad-replace"),
    mk({ antiDuplicate: "upgrade" }, "ad-upgrade"),
    mk({ antiDuplicate: "compensate" }, "ad-compensate"),
    mk({ repeatable: false }, "norepeat"),
    mk({ serializedOnly: true }, "serialized-only"),
    mk({ restrictGroups: ["mvp", "winner"] }, "groups"),
    mk({ excludeVariants: ["bronze", "silver"] as VariantId[] }, "exclude-variants"),
    mk({ series: ["masters", "champions"] }, "series"),
    mk({ cardCount: 1 }, "one-card"),
  ];
}

async function familiaDeterminismo(): Promise<void> {
  title("2 · DETERMINISMO — el motor entrega EXACTAMENTE lo mismo que antes");

  const registry = await registroPersistido();
  const dist = await serverDistribution(db);

  const antiguo = new PackEngine(registry);                                   // sin pools
  const nuevo = new PackEngine(registry, (id) => dist.forPack(id));           // con pools

  const firma = (r: ReturnType<PackEngine["open"]>): string => JSON.stringify({
    i: r.instances.map((x) => [x.cardId, x.serial, x.bucket, x.byPity, x.isNew, x.value, x.origin]),
    p: r.pityAfter, m: r.mintDelta,
  });

  // Estados de jugador que fuerzan las ramas de pity y anti-duplicado.
  const algunasPoseidas = registry.cards.slice(0, 400)
    .map((c, i) => ({ uid: `own-${i}`, cardId: c.id, obtainedAt: 0 } as OwnedCard));

  const SEMILLAS = [1, 7, 42, 1337, 987654321, 2 ** 30, 123456];
  let aperturas = 0, divergen = 0;
  const ejemplos: string[] = [];

  const todos: { pack: PackDef; sintetico: boolean }[] = [
    ...PACKS.map((p) => ({ pack: p, sintetico: false })),
    ...sobresSinteticos(PACKS[1]).map((p) => ({ pack: p, sintetico: true })),
  ];

  /*
   * ────────────────────────── EL INVARIANTE, ACOTADO A DONDE APLICA (Fase 20) ──────────────────────────
   *
   * Hasta la Fase 20, TODOS los pools tenían peso 1, así que «con pools == sin pools» valía
   * para el catálogo entero: era la condición de éxito de la migración 8.3.
   *
   * Los Team Packs rompen esa igualdad A PROPÓSITO — un pool de sesgo existe justamente para
   * que salga otra carta. Relajar la comprobación para todos habría tirado la red que protege
   * a los otros doce sobres, así que se PARTE en dos:
   *
   *   · pools UNIFORMES  → la igualdad sigue siendo obligatoria (el invariante de 8.3, intacto).
   *   · pools PONDERADOS → la igualdad no debe cumplirse, y el sesgo se verifica aparte, por su
   *                        dirección y su tamaño (`familiaSesgo`).
   *
   * `uniform` lo calcula `composeDistribution` a partir de los pesos reales, no de una lista de
   * sobres escrita a mano: si alguien pondera un pool nuevo, esto se adapta solo.
   */
  let ponderados = 0;
  for (const { pack, sintetico } of todos) {
    const d = dist.forPack(pack.id);
    const esUniforme = d === null || d.uniform;
    if (!esUniforme) ponderados++;
    for (const seed of SEMILLAS) {
      for (const owned of [[] as OwnedCard[], algunasPoseidas]) {
        const key = pityKey(pack);
        const pity = freshPity();
        if (key && pack.pity) pity.counters[key] = Math.max(0, pack.pity.threshold - 1);
        const ctx = { seed, owned, mintCounts: {} as Record<string, number>, now: 1_700_000_000_000 };
        const a = antiguo.open(pack, { ...ctx, pity: { ...pity, counters: { ...pity.counters } } });
        const b = nuevo.open(pack, { ...ctx, pity: { ...pity, counters: { ...pity.counters } } });
        if (!esUniforme) continue; // su divergencia es el objetivo, no un fallo
        aperturas++;
        if (firma(a) !== firma(b)) {
          divergen++;
          if (ejemplos.length < 5) ejemplos.push(`${pack.id}#${seed}${sintetico ? "(synth)" : ""}`);
        }
      }
    }
  }

  check("MISMA semilla ⇒ MISMAS cartas en los sobres de pool UNIFORME", divergen === 0,
    divergen ? ejemplos.join(", ")
      : `${aperturas} aperturas, 0 divergencias · ${ponderados} sobres con pool ponderado se verifican por su sesgo`);
  check("la cobertura incluye lo que los 12 sobres NO usan",
    todos.filter((t) => t.sintetico).length === 15,
    "garantías, guaranteedMin, pity, 4 políticas anti-dup, no-repetible, serialized, grupos, variantes, series");

  // Los pools tienen que dar el MISMO conjunto elegible que la deducción de PackDef.
  let poolDiff = 0;
  for (const pack of PACKS) {
    const a = buildPool(registry, pack).flat.map((c) => c.id).sort().join(",");
    const b = buildPool(registry, pack, dist.forPack(pack.id)).flat.map((c) => c.id).sort().join(",");
    if (a !== b) poolDiff++;
  }
  check("la pertenencia persistida = la deducida por isEligible()", poolDiff === 0,
    `${poolDiff} de ${PACKS.length} sobres divergen`);

  /*
   * ────────────────────────── EL SESGO DE EQUIPO, VERIFICADO (Fase 20) ──────────────────────────
   *
   * Un Team Pack promete «más probabilidad de cartas del equipo» y **no** promete una carta del
   * equipo. Las dos mitades de esa frase se comprueban aquí, midiendo con el motor real:
   *
   *   1. El sesgo EXISTE y va en la dirección correcta (con pools > sin pools).
   *   2. El sesgo NO es una garantía: quedan sobres sin ninguna carta del equipo.
   *
   * La segunda es la que importa de verdad. Un pool `EXPLICIT` en lugar de `RULE` habría
   * convertido el producto en «solo cartas del equipo» y esta comprobación lo cazaría: es la
   * diferencia entre reponderar y restringir, y no se puede ver leyendo el código del motor.
   */
  const N_SESGO = 1500;
  for (const pack of PACKS.filter((p) => p.team)) {
    const team = pack.team!;
    const delEquipo = new Set(
      buildPool(registry, pack).flat.filter((c) => isTeamPackCard(c, registry.player(c.playerId), team)).map((c) => c.id),
    );

    const medir = (motor: PackEngine): { cuota: number; conAlguna: number } => {
      let suyas = 0, total = 0, conAlguna = 0;
      for (let i = 0; i < N_SESGO; i++) {
        const r = motor.open(pack, {
          seed: (0x9e3779b9 + i * 7919) >>> 0, owned: [] as OwnedCard[],
          mintCounts: {}, pity: freshPity(), now: 1_700_000_000_000,
        });
        let enEste = 0;
        for (const ins of r.instances) {
          total++;
          if (delEquipo.has(ins.cardId)) { suyas++; enEste++; }
        }
        if (enEste > 0) conAlguna++;
      }
      return { cuota: total > 0 ? suyas / total : 0, conAlguna: conAlguna / N_SESGO };
    };

    const sin = medir(antiguo);
    const con = medir(nuevo);

    check(`SESGO · ${pack.id} favorece a «${team}» con el pool puesto`,
      con.cuota > sin.cuota * 1.5,
      `cuota ${(sin.cuota * 100).toFixed(1)} % → ${(con.cuota * 100).toFixed(1)} % · ${delEquipo.size} cartas del equipo en el pool`);

    check(`SESGO · ${pack.id} NO garantiza carta de «${team}»`,
      con.conAlguna < 0.99,
      `P(≥1 del equipo) = ${(con.conAlguna * 100).toFixed(1)} % — un 100 % sería una garantía, y el producto no la promete`);
  }

  // Y el ORDEN, que 8.1 demostró que decide el resultado.
  let ordenDiff = 0;
  for (const pack of PACKS) {
    const a = buildPool(registry, pack).flat.map((c) => c.id).join("|");
    const b = buildPool(registry, pack, dist.forPack(pack.id)).flat.map((c) => c.id).join("|");
    if (a !== b) ordenDiff++;
  }
  check("y el ORDEN del pool es el mismo (lo decide content_cards.ordinal, no el pool)",
    ordenDiff === 0, `${ordenDiff} sobres con orden distinto`);
}

// ───────────────────────────── 3 · EQUIVALENCIA ─────────────────────────────

function familiaEquivalencia(): void {
  title("3 · pickWeighted CON PESO 1 ES rng.pick, BIT A BIT");

  let idxDiff = 0, consumoDiff = 0;
  for (let n = 1; n <= 60; n++) {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let seed = 1; seed <= 200; seed++) {
      const r1 = makeRng(seed), r2 = makeRng(seed);
      const a = r1.pick(arr);
      const b = pickWeighted(arr, () => DEFAULT_WEIGHT, r2);
      if (a !== b) idxDiff++;
      // Tras la elección, el generador tiene que estar en el MISMO punto: si no, todas las
      // cartas siguientes del sobre cambiarían.
      if (r1.next() !== r2.next()) consumoDiff++;
    }
  }
  check("mismo elemento elegido", idxDiff === 0, `${60 * 200} casos (n=1..60, 200 semillas)`);
  check("mismo consumo del generador", consumoDiff === 0,
    "una sola tirada, igual que rng.pick — incluye el caso n=1");

  // Con pesos NO uniformes tiene que cambiar: si no, el peso no serviría de nada.
  const arr = [0, 1, 2, 3, 4];
  let cambios = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const a = pickWeighted(arr, () => 1, makeRng(seed));
    const b = pickWeighted(arr, (i) => (i === 4 ? 100 : 1), makeRng(seed));
    if (a !== b) cambios++;
  }
  check("con pesos distintos el resultado SÍ cambia", cambios > 0,
    `${cambios} de 500 — el peso hace algo, la prueba no es vacía`);
}

// ───────────────────────────── 4 · MATEMÁTICA ─────────────────────────────

function familiaMatematica(): void {
  title("4 · PROBABILIDAD EFECTIVA — la cuenta exacta");

  const casos: { nombre: string; pesos: number[]; esperado: number[] }[] = [
    { nombre: "10 / 20 / 5", pesos: [10, 20, 5], esperado: [10 / 35, 20 / 35, 5 / 35] },
    { nombre: "1 / 1", pesos: [1, 1], esperado: [0.5, 0.5] },
    { nombre: "1 / 2", pesos: [1, 2], esperado: [1 / 3, 2 / 3] },
    { nombre: "1 / 100", pesos: [1, 100], esperado: [1 / 101, 100 / 101] },
    { nombre: "una sola carta", pesos: [7], esperado: [1] },
    { nombre: "500 entradas iguales", pesos: Array(500).fill(3), esperado: Array(500).fill(1 / 500) },
  ];
  for (const c of casos) {
    const arr = c.pesos.map((_, i) => i);
    const ps = effectiveProbabilities(arr, (i) => c.pesos[i]).map((x) => x.p);
    const ok = ps.every((p, i) => Math.abs(p - c.esperado[i]) < 1e-12);
    const muestra = ps.slice(0, 3).map((p) => `${(p * 100).toFixed(3)}%`).join(" / ");
    check(`  ${c.nombre}`, ok, muestra);
  }

  const ps = effectiveProbabilities([0, 1, 2], (i) => [10, 20, 5][i]);
  check("10/20/5 da 28,571 % · 57,143 % · 14,286 %",
    Math.abs(ps[0].p - 0.2857142857142857) < 1e-15
    && Math.abs(ps[1].p - 0.5714285714285714) < 1e-15
    && Math.abs(ps[2].p - 0.14285714285714285) < 1e-15,
    "los números del encargo, al dígito");

  check("las probabilidades suman 1",
    Math.abs(effectiveProbabilities(Array(37).fill(0).map((_, i) => i), (i) => i + 1)
      .reduce((s, x) => s + x.p, 0) - 1) < 1e-12, "37 entradas con pesos 1..37");

  // Pesos no válidos: se normalizan a 1 en vez de envenenar la distribución.
  const malos = effectiveProbabilities([0, 1], (i) => (i === 0 ? -5 : 1));
  check("un peso no válido NO envenena la distribución",
    Math.abs(malos[0].p - 0.5) < 1e-12,
    "peso negativo tratado como 1; la BD además lo impide con un CHECK");
  const inf = effectiveProbabilities([0, 1], (i) => (i === 0 ? Infinity : 1));
  check("un peso infinito tampoco", Math.abs(inf[0].p - 0.5) < 1e-12,
    "sin esto, todas las demás cartas tendrían probabilidad 0 en silencio");

  // Pool vacío: debe fallar, no devolver `undefined`.
  let lanzo = false;
  try { pickWeighted([], () => 1, makeRng(1)); } catch { lanzo = true; }
  check("un pool vacío falla en vez de devolver undefined", lanzo);
}

// ───────────────────────────── 5 · ESTADÍSTICA ─────────────────────────────

function familiaEstadistica(): void {
  title("5 · SANIDAD ESTADÍSTICA — la simulación converge a los pesos");

  const pesos = [10, 20, 5, 1, 64];
  const arr = pesos.map((_, i) => i);
  const total = pesos.reduce((a, b) => a + b, 0);
  const N = 400_000;
  const cuenta = new Array(pesos.length).fill(0);
  const rng = makeRng(20260909);
  for (let i = 0; i < N; i++) cuenta[pickWeighted(arr, (k) => pesos[k], rng)]++;

  let peor = 0;
  const filas: string[] = [];
  for (let i = 0; i < pesos.length; i++) {
    const esperado = pesos[i] / total;
    const obs = cuenta[i] / N;
    const err = Math.abs(obs - esperado) / esperado;
    peor = Math.max(peor, err);
    filas.push(`w${pesos[i]}: ${(obs * 100).toFixed(2)}% vs ${(esperado * 100).toFixed(2)}%`);
  }
  console.log(`         ${filas.join(" · ")}`);
  check(`${N.toLocaleString("es-ES")} tiradas convergen a los pesos`, peor < 0.05,
    `error relativo máximo ${(peor * 100).toFixed(2)} % (tolerancia 5 %)`);
  check("esto NO sustituye a la comprobación determinista", true,
    "la familia 4 es la que demuestra la fórmula; esta solo enseña que el sorteo la obedece");
}

// ───────────────────────────── 6 · CICLO DE VIDA ─────────────────────────────

async function familiaLifecycle(): Promise<void> {
  title("6 · CICLO DE VIDA — draft fuera, retirada fuera de NUEVOS drops");

  resetServerCatalog(); resetServerDistribution();
  const cat = await serverCatalog(db);
  const dist = await serverDistribution(db);

  const { data: draft } = await db.from("content_cards")
    .select("card_id").neq("lifecycle", "PUBLISHED").limit(5);
  const noPublicadas = ((draft ?? []) as { card_id: string }[]).map((r) => r.card_id);
  const enAlgunPool = noPublicadas.filter((id) =>
    [...dist.pools.values()].some((p) => p.entries.some((e) => e.cardId === id && e.mode === "INCLUDE")));
  check("ninguna carta no publicada está en un pool activo", enAlgunPool.length === 0,
    `${noPublicadas.length} no publicadas revisadas (${noPublicadas.join(", ") || "ninguna"})`);

  for (const id of noPublicadas) {
    const enPool = PACKS.some((p) => buildPool(cat.packEngine.registry, p, dist.forPack(p.id)).flat.some((c) => c.id === id));
    check(`  ${id} no puede salir en ningún sobre`, !enPool);
    check(`  …pero el servidor la sigue RESOLVIENDO`, cat.has(id),
      "colección, mazos y mercado la siguen viendo — 8.2");
  }
}

// ───────────────────────────── 7 · VALIDACIÓN ─────────────────────────────

async function familiaValidacion(): Promise<void> {
  title("7 · VALIDACIÓN — lo imposible se rechaza");

  const poolId = `zz-test-${randomUUID().slice(0, 8)}`;
  poolsCreados.push(poolId);
  const carta = (await db.from("content_cards").select("card_id").eq("lifecycle", "PUBLISHED").limit(1).maybeSingle())
    .data as { card_id: string };

  const crear = await db.rpc("app_content_pool_upsert", {
    p_pool: { id: poolId, name: "prueba 8.3", mode: "EXPLICIT" },
    p_reason: "verificación", p_actor: null,
  });
  check("se crea un pool de prueba", !crear.error, crear.error?.message ?? poolId);

  const sinMotivo = await db.rpc("app_content_pool_upsert", {
    p_pool: { id: poolId, name: "x" }, p_reason: "", p_actor: null,
  });
  check("un cambio SIN MOTIVO se rechaza", !!sinMotivo.error);

  for (const [etiqueta, w] of [["0", 0], ["negativo", -5], ["enorme", 1e12]] as const) {
    const r = await db.rpc("app_content_pool_set_entries", {
      p_pool_id: poolId, p_entries: [{ card_id: carta.card_id, weight: w }],
      p_reason: "prueba", p_actor: null,
    });
    check(`peso ${etiqueta} rechazado`, !!r.error, r.error?.message?.slice(0, 55) ?? "");
  }

  const cartaFalsa = await db.rpc("app_content_pool_set_entries", {
    p_pool_id: poolId, p_entries: [{ card_id: "no-existe__gold", weight: 1 }],
    p_reason: "prueba", p_actor: null,
  });
  check("carta inexistente rechazada", !!cartaFalsa.error, cartaFalsa.error?.message?.slice(0, 55) ?? "");

  const poolFalso = await db.rpc("app_content_pool_set_entries", {
    p_pool_id: "no-existe", p_entries: [], p_reason: "prueba", p_actor: null,
  });
  check("pool inexistente rechazado", !!poolFalso.error);

  const dup = await db.rpc("app_content_pool_set_entries", {
    p_pool_id: poolId,
    p_entries: [{ card_id: carta.card_id, weight: 1 }, { card_id: carta.card_id, weight: 9 }],
    p_reason: "prueba", p_actor: null,
  });
  check("entrada duplicada rechazada", !!dup.error, dup.error?.message?.slice(0, 55) ?? "");

  const vacio = await db.rpc("app_content_pool_publish", { p_pool_id: poolId, p_state: "ACTIVE", p_actor: null });
  check("un pool EXPLICIT vacío no se puede activar", !!vacio.error, vacio.error?.message?.slice(0, 55) ?? "");

  // Una carta no publicada dentro de un pool que se intenta activar.
  const { data: retirada } = await db.from("content_cards")
    .select("card_id").eq("lifecycle", "RETIRED").limit(1).maybeSingle();
  if (retirada) {
    await db.rpc("app_content_pool_set_entries", {
      p_pool_id: poolId, p_entries: [{ card_id: (retirada as { card_id: string }).card_id, weight: 1 }],
      p_reason: "prueba", p_actor: null,
    });
    const act = await db.rpc("app_content_pool_publish", { p_pool_id: poolId, p_state: "ACTIVE", p_actor: null });
    check("no se activa un pool con cartas no publicadas", !!act.error, act.error?.message?.slice(0, 60) ?? "");
  } else {
    omit("no se activa un pool con cartas no publicadas", "no hay ninguna carta retirada");
  }

  await db.rpc("app_content_pool_set_entries", {
    p_pool_id: poolId, p_entries: [{ card_id: carta.card_id, weight: 1 }], p_reason: "prueba", p_actor: null,
  });
  const ilegal = await db.rpc("app_content_pool_publish", { p_pool_id: poolId, p_state: "RETIRED", p_actor: null });
  check("DRAFT → RETIRED es una transición ilegal", !!ilegal.error);

  const ok = await db.rpc("app_content_pool_publish", { p_pool_id: poolId, p_state: "ACTIVE", p_actor: null });
  check("DRAFT → ACTIVE con configuración válida SÍ", !ok.error, ok.error?.message ?? "");

  const packFalso = await db.rpc("app_content_pack_bind", {
    p_pack_id: "sobre-inexistente", p_pool_id: "pool-inexistente", p_priority: 1, p_action: "bind", p_actor: null,
  });
  check("vincular a un pool inexistente se rechaza", !!packFalso.error);
}

// ───────────────────────────── 8 · SEGURIDAD ─────────────────────────────

async function familiaSeguridad(): Promise<void> {
  title("8 · SEGURIDAD");

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const usuario = await cuenta("normal");
  const comoUsuario = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${usuario.token}` } },
  });

  for (const [etiqueta, cli] of [["anon", anon], ["authenticated", comoUsuario]] as const) {
    for (const t of ["content_pools", "content_pool_entries", "content_pack_pools", "content_distribution_version"]) {
      const { data, error } = await cli.from(t).select("*").limit(1);
      check(`${etiqueta} NO puede leer ${t}`, !!error || (data ?? []).length === 0, error?.code ?? "0 filas");
    }
    for (const [fn, args] of [
      ["app_content_pool_upsert", { p_pool: { id: "hack" }, p_reason: "x", p_actor: null }],
      ["app_content_pool_set_entries", { p_pool_id: "pack-estandar", p_entries: [], p_reason: "x", p_actor: null }],
      ["app_content_pool_publish", { p_pool_id: "pack-estandar", p_state: "RETIRED", p_actor: null }],
      ["app_content_pack_bind", { p_pack_id: "estandar", p_pool_id: "pack-estandar", p_priority: 1, p_action: "unbind", p_actor: null }],
    ] as const) {
      const r = await cli.rpc(fn, args as never);
      check(`${etiqueta} NO puede ${fn.replace("app_content_", "")}`, !!r.error, r.error?.code ?? "");
    }
  }

  const { count: sigueActivo } = await db.from("content_pools")
    .select("id", { count: "exact", head: true }).eq("id", "pack-estandar").eq("lifecycle", "ACTIVE");
  check("y el pool real sigue intacto tras los intentos", sigueActivo === 1);

  if (!servidorVivo) {
    for (const l of ["sin sesión", "usuario normal", "suplantar actor", "admin válido"]) {
      omit(`API /api/admin/pools · ${l}`, `no hay servidor en ${BASE}`);
    }
    return;
  }

  const sinSesion = await http("/api/admin/pools", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "inspect", poolId: "pack-estandar" }),
  });
  check("API · sin sesión responde 401", sinSesion.status === 401, `HTTP ${sinSesion.status}`);

  const normal = await http("/api/admin/pools", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${usuario.token}` },
    body: JSON.stringify({ action: "setEntries", poolId: "pack-estandar", entries: [], reason: "intento" }),
  });
  check("API · usuario normal no puede tocar un pool", normal.status === 401, `HTTP ${normal.status}`);

  const spoof = await http("/api/admin/pools", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${usuario.token}` },
    body: JSON.stringify({
      action: "publish", poolId: "pack-estandar", state: "RETIRED",
      userId: usuario.id, actor: usuario.id, role: "admin", is_admin: true,
    }),
  });
  check("API · suplantar actor/role no sirve", spoof.status === 401, `HTTP ${spoof.status}`);

  const admin = await cuenta("admin");
  await db.from("profiles").update({ is_admin: true }).eq("id", admin.id);
  const insp = await http("/api/admin/pools", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ action: "inspect", poolId: "pack-estandar" }),
  });
  check("API · un admin válido SÍ inspecciona", insp.status === 200, `HTTP ${insp.status}`);

  const malPeso = await http("/api/admin/pools", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({
      action: "setEntries", poolId: "pack-estandar", reason: "x",
      entries: [{ cardId: "benjy__silver", weight: -1 }],
    }),
  });
  check("API · ni un admin puede poner un peso no válido", malPeso.status === 400 || malPeso.status === 409,
    `HTTP ${malPeso.status}`);
}

// ───────────────────────────── 9 · RENDIMIENTO ─────────────────────────────

async function familiaRendimiento(): Promise<void> {
  title("9 · RENDIMIENTO");

  resetServerDistribution();
  const t0 = Date.now();
  const dist = await serverDistribution(db);
  const carga = Date.now() - t0;
  check("cargar la distribución completa en UNA llamada", carga < 5000,
    `${carga} ms · ${dist.pools.size} pools · ${[...dist.pools.values()].reduce((s, p) => s + p.entries.length, 0)} entradas`);

  const t1 = Date.now();
  const cached = await serverDistribution(db);
  check("la segunda llamada sale de caché", Date.now() - t1 < 50 && cached === dist, `${Date.now() - t1} ms`);

  const registry = await registroPersistido();
  const engine = new PackEngine(registry, (id) => dist.forPack(id));
  const pack = PACKS[1];
  const ctx = { owned: [] as OwnedCard[], mintCounts: {}, pity: freshPity(), now: 0 };

  engine.open(pack, { ...ctx, seed: 1 });                     // calienta la caché del pool
  const t2 = Date.now();
  for (let i = 0; i < 2000; i++) engine.open(pack, { ...ctx, seed: i });
  const conPool = Date.now() - t2;

  const viejo = new PackEngine(registry);
  viejo.open(pack, { ...ctx, seed: 1 });
  const t3 = Date.now();
  for (let i = 0; i < 2000; i++) viejo.open(pack, { ...ctx, seed: i });
  const sinPool = Date.now() - t3;

  check("abrir con pools NO degrada significativamente", conPool <= sinPool * 2 + 50,
    `2.000 aperturas: ${sinPool} ms sin pools · ${conPool} ms con pools`);
  check("el pool sigue cacheado (O(1) por apertura)", conPool < 4000, `${(conPool / 2000).toFixed(3)} ms/apertura`);

  // Invalidación: subir la versión tiene que hacer que la siguiente lectura recargue.
  const antes = dist.version;
  await db.rpc("app_content_pack_bind", {
    p_pack_id: "estandar", p_pool_id: "pack-estandar", p_priority: 100, p_action: "bind", p_actor: null,
  });
  resetServerDistribution();
  const despues = await serverDistribution(db);
  check("publicar sube la versión y la siguiente lectura la ve", despues.version > antes,
    `v${antes} → v${despues.version}`);

  /*
   * TRINQUETE DEL FALLO QUE ENCONTRÓ LA QA DE ESTE BLOQUE.
   *
   * Las RPC de 8.2 que editan una carta NO subían `content_catalog_version`, así que un
   * administrador podía retirar una carta y el proceso que sirve el juego seguía creyendo
   * indefinidamente que estaba publicada. No se vio en 8.2 porque sus comprobaciones
   * llamaban a `resetServerCatalog()` antes de mirar — se saltaban justo la parte rota.
   *
   * Esto lo comprueba sin resetear nada: mira el número, no el objeto en memoria.
   */
  const { data: v0 } = await db.from("content_catalog_version").select("version").eq("id", true).maybeSingle();
  const carta = "benjy__ewc";
  await db.rpc("app_content_set_lifecycle", { p_card_id: carta, p_state: "RETIRED", p_reason: "trinquete", p_actor: null });
  const { data: v1 } = await db.from("content_catalog_version").select("version").eq("id", true).maybeSingle();
  await db.rpc("app_content_set_lifecycle", { p_card_id: carta, p_state: "PUBLISHED", p_reason: "trinquete", p_actor: null });
  const { data: v2 } = await db.from("content_catalog_version").select("version").eq("id", true).maybeSingle();
  const n = (x: unknown): number => Number((x as { version: number } | null)?.version ?? 0);
  check("retirar una carta SUBE la versión del catálogo (regresión de 8.2)",
    n(v1) > n(v0), `v${n(v0)} → v${n(v1)}`);
  check("y republicarla también", n(v2) > n(v1), `v${n(v1)} → v${n(v2)}`);
  const { data: estado } = await db.from("content_cards").select("lifecycle").eq("card_id", carta).maybeSingle();
  check("la carta queda como estaba", (estado as { lifecycle: string } | null)?.lifecycle === "PUBLISHED");
}

// ───────────────────────────── ejecución ─────────────────────────────

async function main(): Promise<void> {
  console.log("\n═══ VERIFICACIÓN DE POOLS Y DISTRIBUCIÓN (Bloque 8.3) ═══");
  console.log(`  base de datos: ${URL_}`);
  servidorVivo = await fetch(`${BASE}/api/game/state`, { cache: "no-store" })
    .then((r) => r.status > 0).catch(() => false);
  console.log(`  servidor:      ${servidorVivo ? BASE : `${BASE} (no responde — HTTP omitido)`}`);

  const { count: pools } = await db.from("content_pools").select("id", { count: "exact", head: true });
  if (!pools) {
    console.error("\n  ✕ No hay pools. Ejecuta `npm run content-pools:migrate` primero.\n");
    process.exit(1);
  }

  await familiaModelo();
  await familiaDeterminismo();
  familiaEquivalencia();
  familiaMatematica();
  familiaEstadistica();
  await familiaLifecycle();
  await familiaValidacion();
  await familiaSeguridad();
  await familiaRendimiento();
}

async function limpiar(): Promise<void> {
  for (const id of poolsCreados) {
    await db.from("content_pack_pools").delete().eq("pool_id", id).then(() => {}, () => {});
    await db.from("content_pool_entries").delete().eq("pool_id", id).then(() => {}, () => {});
    await db.from("content_pools").delete().eq("id", id).then(() => {}, () => {});
  }
  for (const id of cuentas) await db.auth.admin.deleteUser(id).catch(() => {});
}

main()
  .catch((e) => { console.error("\n✕ verificación abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar();
    console.log("\n" + "─".repeat(74));
    console.log(`  ${pass} correctas · ${fail} fallidas${skip ? ` · ${skip} omitidas` : ""}`);
    console.log(fail === 0
      ? "  ✅ LA DISTRIBUCIÓN ES ADMINISTRABLE Y EL SORTEO NO HA CAMBIADO"
      : "  ❌ LA DISTRIBUCIÓN TIENE HUECOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
