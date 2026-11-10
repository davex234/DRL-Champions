/**
 * EL HISTORIAL DEL ENTRENADOR — `npm run coach-history:verify`
 *
 * Comprueba contra el servidor y la base de datos REALES las tres cosas que hacen que un
 * historial sea un historial y no una lista de filas:
 *
 *   1. **Que se persista de verdad.** Un partido terminado deja fila, y la fila dice lo que
 *      pasó.
 *   2. **Que sea idempotente.** Recargar la pantalla final —o pulsar dos veces— no puede
 *      crear un segundo partido. La clave es la semilla, que ya identificaba al partido antes
 *      de guardarlo.
 *   3. **Que nadie vea lo de nadie.** Dos usuarios, dos historiales, y ni una fila cruzada —ni
 *      por la API, ni por PostgREST saltándose la API.
 *
 * Y una cuarta que es la que evita el peor final: que la tabla NO se pueda escribir desde el
 * cliente. Si `authenticated` pudiera insertar, todo lo anterior daría igual.
 *
 * Lo que crea, lo borra.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
if (!URL_ || !SERVICE || !ANON) { console.error("Falta configuración de Supabase"); process.exit(1); }
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const title = (t: string): void => console.log(`\n─── ${t} ${"─".repeat(Math.max(0, 58 - t.length))}`);

const cuentas: string[] = [];

async function cuenta(tag: string) {
  const email = `chist-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  cuentas.push(data.user.id);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw new Error(`login: ${s.error?.message}`);
  return { id: data.user.id, token: s.data.session.access_token, anon };
}

const partido = (seed: number, extra: Record<string, unknown> = {}) => ({
  seed,
  teamName: "Verificación FC",
  rivalName: "Rival (Normal)",
  difficulty: "normal",
  mapId: "ascent",
  mapSite: "A",
  startSide: "ATK",
  scoreHome: 13,
  scoreAway: 9,
  rounds: 22,
  durationSeconds: 1800,
  mvp: "derke",
  ...extra,
});

const registrar = (m: Record<string, unknown>, token: string | null) =>
  fetch(`${BASE}/api/game/coach-matches`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ match: m }), cache: "no-store",
  }).then(async (r) => ({ status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, unknown> }));

const leer = (token: string | null) =>
  fetch(`${BASE}/api/game/coach-matches`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store",
  }).then(async (r) => ({ status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, unknown> }));

async function main(): Promise<void> {
  console.log("\n═══ HISTORIAL DE PARTIDOS DIRIGIDOS ═══");
  console.log(`  servidor: ${BASE}`);
  const ping = await fetch(`${BASE}/`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) { console.error(`\n  ✕ No hay servidor en ${BASE}.\n`); process.exit(1); }

  const ana = await cuenta("ana");
  const beto = await cuenta("beto");

  // ══════════════════════════════════════════════════════════════════
  title("1 · SE PERSISTE DE VERDAD");
  const SEED_A = 1000001;
  const alta = await registrar(partido(SEED_A), ana.token);
  check("un partido terminado se registra", alta.status === 200, String(alta.data.error ?? "200"));
  check("y no viene marcado como duplicado", alta.data.duplicate === false, "primera vez");

  const { data: fila } = await db.from("coach_matches").select("*")
    .eq("user_id", ana.id).eq("seed", SEED_A).maybeSingle();
  const f = fila as Record<string, unknown> | null;
  check("existe la fila en la base de datos", !!f, f ? "sí" : "no hay fila");
  check("guarda el marcador tal cual", f?.score_home === 13 && f?.score_away === 9, `${f?.score_home}-${f?.score_away}`);
  check("guarda el mapa Y el sitio, sin fingir variedad", f?.map_id === "ascent" && f?.map_site === "A",
    `${f?.map_id} · sitio ${f?.map_site}`);
  check("guarda el lado inicial sorteado", f?.start_side === "ATK", String(f?.start_side));

  /*
   * `won` NO se acepta del cliente: se deriva del marcador. Se comprueba mandando uno que
   * miente —perdiendo 5-13 pero diciendo que ganó— y viendo que la fila dice la verdad.
   */
  const mentira = await registrar(partido(1000002, { scoreHome: 5, scoreAway: 13, rounds: 18, won: true }), ana.token);
  const { data: fm } = await db.from("coach_matches").select("won, score_home, score_away")
    .eq("user_id", ana.id).eq("seed", 1000002).maybeSingle();
  check("`won` se DERIVA del marcador, no se cree al cliente",
    mentira.status === 200 && (fm as { won: boolean } | null)?.won === false,
    "5-13 se guarda como derrota aunque diga lo contrario");

  // ══════════════════════════════════════════════════════════════════
  title("2 · IDEMPOTENCIA: RECARGAR NO DUPLICA");
  const otra = await registrar(partido(SEED_A), ana.token);
  check("registrar el MISMO partido otra vez responde 200", otra.status === 200, String(otra.status));
  check("y lo marca como duplicado", otra.data.duplicate === true, "duplicate: true");

  // Cinco intentos seguidos, como cinco recargas nerviosas de la pantalla final.
  await Promise.all([1, 2, 3, 4, 5].map(() => registrar(partido(SEED_A), ana.token)));
  const { count } = await db.from("coach_matches").select("id", { count: "exact", head: true })
    .eq("user_id", ana.id).eq("seed", SEED_A);
  check("siete intentos del mismo partido dejan UNA sola fila", count === 1, `${count} filas`);

  const mismoId = otra.data.match as { id: string } | undefined;
  const primerId = alta.data.match as { id: string } | undefined;
  check("y devuelve el partido que ya existía, no uno nuevo",
    !!mismoId && mismoId.id === primerId?.id, "mismo id");

  // ══════════════════════════════════════════════════════════════════
  title("3 · CADA UNO VE LO SUYO");
  await registrar(partido(2000001, { teamName: "Beto FC", scoreHome: 8, scoreAway: 13, rounds: 21 }), beto.token);

  const deAna = await leer(ana.token);
  const deBeto = await leer(beto.token);
  const listaAna = (deAna.data.matches ?? []) as { seed: number }[];
  const listaBeto = (deBeto.data.matches ?? []) as { seed: number }[];

  check("Ana ve sus dos partidos", listaAna.length === 2, `${listaAna.length}`);
  check("Beto ve el suyo", listaBeto.length === 1, `${listaBeto.length}`);
  check("Ana NO ve el de Beto", !listaAna.some((m) => m.seed === 2000001), "aislado");
  check("Beto NO ve los de Ana", !listaBeto.some((m) => m.seed === SEED_A), "aislado");

  /*
   * Y saltándose la API. La ruta podría filtrar bien y la tabla estar abierta: entonces
   * bastaría con hablar con PostgREST directamente. RLS tiene que aguantar sola.
   */
  const { data: espia } = await beto.anon.from("coach_matches").select("*").eq("user_id", ana.id);
  check("ni yendo directo a PostgREST con la sesión de Beto",
    (espia ?? []).length === 0, `${(espia ?? []).length} filas visibles`);

  // ══════════════════════════════════════════════════════════════════
  title("4 · EL CLIENTE NO ESCRIBE");
  const { error: eIns } = await beto.anon.from("coach_matches").insert({
    user_id: beto.id, seed: 3000001, team_name: "x", rival_name: "y", difficulty: "normal",
    map_id: "ascent", start_side: "ATK", score_home: 13, score_away: 0, won: true, rounds: 13,
  });
  check("un usuario NO puede insertar en la tabla", !!eIns, eIns?.message.slice(0, 60) ?? "¡pudo!");

  const { error: eUpd } = await ana.anon.from("coach_matches")
    .update({ score_home: 99 }).eq("user_id", ana.id).eq("seed", SEED_A);
  const { data: intacta } = await db.from("coach_matches").select("score_home")
    .eq("user_id", ana.id).eq("seed", SEED_A).maybeSingle();
  check("ni reescribir su propio marcador",
    (intacta as { score_home: number } | null)?.score_home === 13,
    eUpd ? "rechazado" : "sin efecto");

  const { error: eDel } = await ana.anon.from("coach_matches").delete().eq("user_id", ana.id);
  const { count: siguen } = await db.from("coach_matches").select("id", { count: "exact", head: true })
    .eq("user_id", ana.id);
  check("ni borrar su historial desde el cliente", siguen === 2,
    eDel ? "rechazado" : `${siguen} filas siguen ahí`);

  // ══════════════════════════════════════════════════════════════════
  title("5 · SIN SESIÓN NO HAY HISTORIAL");
  check("leer sin token da 401", (await leer(null)).status === 401, "401");
  check("escribir sin token da 401", (await registrar(partido(4000001), null)).status === 401, "401");

  /*
   * Y sin sesión por PostgREST. Supabase concede SELECT a `anon` por defecto en toda tabla nueva;
   * RLS devolvería cero filas, pero la migración revoca el permiso entero y aquí se exige el
   * rechazo, no una lista vacía.
   */
  const anonimo = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: eAnon } = await anonimo.from("coach_matches").select("id").limit(1);
  check("sin sesión, PostgREST ni siquiera deja leer la tabla", !!eAnon,
    eAnon ? eAnon.message.slice(0, 60) : "¡respondió!");

  // ══════════════════════════════════════════════════════════════════
  title("6 · LO QUE NO CUADRA NO ENTRA");
  const malos: [string, Record<string, unknown>][] = [
    ["un marcador que no cabe en las rondas", partido(5000001, { rounds: 3 })],
    ["un marcador imposible", partido(5000002, { scoreHome: 900 })],
    ["una semilla que no es entera", partido(5000003, { seed: 1.5 })],
    ["un lado inventado", partido(5000004, { startSide: "MEDIO" })],
    ["una dificultad inventada", partido(5000005, { difficulty: "imposible" })],
    ["rondas de más, sin dueño", partido(5000006, { rounds: 30 })],
    ["un empate", partido(5000007, { scoreHome: 12, scoreAway: 12, rounds: 24 })],
  ];
  let rechazados = 0;
  for (const [, m] of malos) {
    if ((await registrar(m, ana.token)).status === 400) rechazados++;
  }
  check("se rechazan los partidos incoherentes", rechazados === malos.length,
    `${rechazados}/${malos.length}`);

  const { count: total } = await db.from("coach_matches").select("id", { count: "exact", head: true })
    .eq("user_id", ana.id);
  check("y ninguno de ellos deja fila", total === 2, `${total} filas`);

  // ══════════════════════════════════════════════════════════════════
  title("7 · EL BALANCE SALE DE LOS PARTIDOS");
  const r = (await leer(ana.token)).data.record as Record<string, number>;
  check("cuenta los dirigidos", r.jugados === 2, `${r.jugados}`);
  check("y el balance", r.ganados === 1 && r.perdidos === 1, `${r.ganados}–${r.perdidos}`);
  check("y el diferencial de rondas", r.diferencialRondas === (13 - 9) + (5 - 13),
    String(r.diferencialRondas));

  /*
   * El balance es de TODOS los partidos, no de la página. Antes se calculaba sobre las filas
   * devueltas, así que con `limit=1` un entrenador con dos partidos tenía «1 dirigido».
   */
  const pagina = (await fetch(`${BASE}/api/game/coach-matches?limit=1`, {
    headers: { Authorization: `Bearer ${ana.token}` }, cache: "no-store",
  }).then((x) => x.json())) as { matches: { id: string }[]; record: { jugados: number }; total: number };
  check("con una página de 1, el balance sigue contando los 2",
    pagina.matches.length === 1 && pagina.record.jugados === 2 && pagina.total === 2,
    `página ${pagina.matches.length} · balance ${pagina.record.jugados} · total ${pagina.total}`);
  const segunda = (await fetch(`${BASE}/api/game/coach-matches?limit=1&offset=1`, {
    headers: { Authorization: `Bearer ${ana.token}` }, cache: "no-store",
  }).then((x) => x.json())) as { matches: { id: string }[] };
  check("y la página siguiente trae el OTRO partido, no el mismo",
    segunda.matches.length === 1 && segunda.matches[0].id !== pagina.matches[0]?.id, "paginación estable");

  // ══════════════════════════════════════════════════════════════════
  title("8 · TECHO DE FRECUENCIA");
  /*
   * Un bucle de render o un `curl` en bucle no puede llenar la tabla de semillas inventadas.
   * Cuenta nueva para no heredar las peticiones de Ana en la misma ventana.
   */
  const carla = await cuenta("carla");
  const codigos: number[] = [];
  for (let i = 0; i < 25; i++) codigos.push((await registrar(partido(6000001 + i), carla.token)).status);
  const aceptados = codigos.filter((c) => c === 200).length;
  const cortados = codigos.filter((c) => c === 429).length;
  check("veinticinco registros seguidos: los de más se cortan con 429",
    aceptados === 20 && cortados === 5, `${aceptados} aceptados · ${cortados} cortados`);
  const { count: deCarla } = await db.from("coach_matches").select("id", { count: "exact", head: true })
    .eq("user_id", carla.id);
  check("y los cortados no dejan fila", deCarla === aceptados, `${deCarla} filas`);
}

async function limpiar(): Promise<void> {
  const restos: string[] = [];
  for (const id of cuentas) {
    await db.from("coach_matches").delete().eq("user_id", id);
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) restos.push(`cuenta ${id}: ${error.message}`);
  }
  const { count } = await db.from("coach_matches").select("id", { count: "exact", head: true });
  console.log(`\n  limpieza: ${cuentas.length} cuentas · ${count} partidos en la tabla`);
  check("no deja cuentas ni partidos suyos", restos.length === 0, restos.join(" | ") || "limpio");
}

main()
  .catch((e) => { console.error(`\n  ✕ Verificación abortada: ${e}\n`); fail++; })
  .finally(async () => {
    await limpiar().catch((e) => console.error(`  ✕ limpieza: ${e}`));
    console.log(`\n${"─".repeat(62)}`);
    console.log(`  ${pass} correctas · ${fail} fallidas`);
    console.log(fail === 0
      ? "  ✅ CADA PARTIDO CONSTA UNA VEZ, Y SOLO PARA QUIEN LO JUGÓ"
      : "  ❌ EL HISTORIAL TIENE FALLOS");
    process.exit(fail === 0 ? 0 : 1);
  });
