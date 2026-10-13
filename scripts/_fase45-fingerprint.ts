/**
 * FASE 45 · HUELLA DE LA CUENTA QA (instrumento `_`, fuera de CI, **SOLO LECTURA**).
 *
 *   npx tsx scripts/_fase45-fingerprint.ts <credsFile> <before|after> [etiqueta]
 *
 * Fotografía TODO lo que una partida real puede mover para una sola cuenta, y lo deja en JSON. Se ejecuta antes y
 * después del playtest; el diff de los dos ficheros es la prueba de que la partida cambió exactamente lo que una
 * partida cambia, ni más ni menos.
 *
 * ────────────────────────── POR QUÉ ES SEGURO ──────────────────────────
 *
 * La transacción se fija `default_transaction_read_only = on` ANTES de cualquier consulta: aunque una sentencia
 * estuviera mal escrita, la base la rechazaría. Todas las consultas llevan `where user_id = <cuenta QA>` o su
 * equivalente: no se lee ni se cuenta nada de ningún otro usuario. No hay un solo `insert`, `update` ni `delete`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CREDS = process.argv[2];
const FASE = process.argv[3] ?? "before";
const ETIQUETA = process.argv[4] ?? "";
if (!CREDS) { console.error("uso: _fase45-fingerprint.ts <credsFile> <before|after> [etiqueta]"); process.exit(1); }

const OUT = join(process.cwd(), "docs/product/qa/fase45/playtest");
mkdirSync(OUT, { recursive: true });

const { userId } = JSON.parse(readFileSync(CREDS, "utf8")) as { userId: string };
if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error("identificador de cuenta con forma inesperada");

/*
 * CON REINTENTOS. El SSH a este VPS se cae de vez en cuando (tiempo de espera agotado, ECONNRESET); ya le pasó a
 * la Fase 35.2. Perder una huella por una conexión caída obligaría a repetir el playtest entero, así que se
 * reintenta tres veces con espera creciente. `ServerAliveInterval` mantiene viva la sesión mientras dura la
 * consulta. Si los tres intentos fallan se lanza: una huella a medias no vale.
 */
function psql(sql: string): string {
  let ultimo: unknown;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      return execFileSync(
        "ssh",
        ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=20",
          "-o", "ServerAliveInterval=10", "nexusadmin@212.95.40.144",
          "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -c 'set default_transaction_read_only = on;' -f -"],
        { input: sql, encoding: "utf8" },
      ).trim();
    } catch (e) {
      ultimo = e;
      if (intento < 3) execFileSync(process.execPath, ["-e", `setTimeout(()=>{}, ${intento * 4000})`]);
    }
  }
  throw ultimo;
}

/*
 * UNA SOLA CONSULTA QUE DEVUELVE UN OBJETO JSON.
 *
 * La primera versión lanzaba 24 consultas escalares y emparejaba resultados por POSICIÓN. Bastó con que una
 * columna no existiera (`user_game.credits`: los créditos viven en `profiles`) para que psql saltara esa línea y
 * TODOS los valores siguientes quedaran corridos un puesto. Una huella mal alineada es peor que no tener huella:
 * parece un dato y miente. Con `json_build_object` cada valor viaja con su nombre y el desalineamiento no puede
 * ocurrir; si una columna no existe, la consulta falla entera y en voz alta, que es lo correcto.
 *
 * `to_jsonb(fila)` en pase, campaña y rating evita adivinar nombres de columna: si mañana cambian, la huella
 * sigue detectando el cambio sin tocarse.
 */
const CONSULTA = `select json_build_object(
  'creditos',          (select credits from public.profiles where id = '${userId}'),
  'nivel',             (select level from public.profiles where id = '${userId}'),
  'xpCuenta',          (select xp from public.profiles where id = '${userId}'),
  'puntos',            (select points from public.profiles where id = '${userId}'),
  'packsAbiertosPerfil',(select packs_opened from public.profiles where id = '${userId}'),
  'packsAbiertosJuego',(select packs_opened from public.user_game where user_id = '${userId}'),
  'cartas',            (select count(*) from public.user_cards where user_id = '${userId}'),
  'sobresHash',        (select coalesce(md5(string_agg(pack_id || ':' || qty::text, ',' order by pack_id)), 'vacio') from public.user_packs where user_id = '${userId}'),
  'sobresTotal',       (select coalesce(sum(qty), 0) from public.user_packs where user_id = '${userId}'),
  'mazos',             (select count(*) from public.duel_decks where user_id = '${userId}'),
  'mazoActivo',        (select coalesce(deck_id::text, 'ninguno') from public.duel_active_deck where user_id = '${userId}'),
  'partidas',          (select count(*) from public.duel_matches where user_id = '${userId}'),
  'partidasGanadas',   (select count(*) from public.duel_matches where user_id = '${userId}' and winner = 'A'),
  'partidasPerdidas',  (select count(*) from public.duel_matches where user_id = '${userId}' and winner = 'B'),
  'partidasCerradas',  (select count(*) from public.duel_matches where user_id = '${userId}' and status <> 'IN_PROGRESS'),
  'accionesDeTurno',   (select count(*) from public.duel_match_actions a join public.duel_matches m on m.id = a.match_id where m.user_id = '${userId}'),
  'asientosCredito',   (select count(*) from public.credit_transactions where user_id = '${userId}'),
  'sumaCredito',       (select coalesce(sum(delta), 0) from public.credit_transactions where user_id = '${userId}'),
  'paseHash',          (select coalesce(md5(to_jsonb(p)::text), 'sin-fila') from public.user_pass p where p.user_id = '${userId}'),
  'logros',            (select count(*) from public.user_achievements where user_id = '${userId}'),
  'ratingHash',        (select coalesce(md5(to_jsonb(r)::text), 'sin-fila') from public.duel_pvp_ratings r where r.user_id = '${userId}'),
  'eventosRating',     (select count(*) from public.duel_pvp_rating_events where user_id = '${userId}'),
  'campanaHash',       (select coalesce(md5(to_jsonb(c)::text), 'sin-fila') from public.campaign_progress c where c.user_id = '${userId}'),
  'intentosCampana',   (select count(*) from public.campaign_attempts where user_id = '${userId}'),
  'draftRuns',         (select count(*) from public.draft_runs where user_id = '${userId}'),
  'favoritos',         (select count(*) from public.user_card_favorites where user_id = '${userId}')
)`;

const raw = psql(`${CONSULTA};`);
const linea = raw.split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l !== "SET" && l !== "").pop();
if (!linea) throw new Error(`la huella no devolvió datos: ${raw}`);

const huella: Record<string, unknown> = {
  _userId: userId, _fase: FASE, _instante: new Date().toISOString(), _etiqueta: ETIQUETA,
  ...(JSON.parse(linea) as Record<string, unknown>),
};

const destino = join(OUT, `fingerprint-${FASE}.json`);
writeFileSync(destino, JSON.stringify(huella, null, 2));
console.log(`huella ${FASE} → ${destino}`);
for (const [k, v] of Object.entries(huella)) if (!k.startsWith("_")) console.log(`  ${k.padEnd(20)} ${v}`);
