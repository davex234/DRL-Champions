/**
 * VERIFICACIÓN — Blindaje de seguridad de la Fase A (SEC-01, SEC-02, SEC-03, BUG-01/02/05/10).
 *
 *   npx tsx scripts/security-verify.ts        (o `npm run verify:all`)
 *
 * ALCANCE — leer esto antes de confiar en el resultado.
 *   Este verify NO se conecta a una base de datos: comprueba que los INVARIANTES del
 *   blindaje siguen presentes en las migraciones y en el código. Es una red contra
 *   REGRESIONES (que alguien vuelva a conceder un privilegio, reintroduzca una escritura
 *   de `credits` desde el cliente o quite `verifyAdmin` de una ruta admin).
 *
 *   La comprobación de comportamiento contra una base de datos real vive en
 *   `supabase/tests/0009_0010_security_test.sql`, que sí ejecuta los UPDATE y las RPC
 *   y espera que Postgres los rechace. Ese fichero necesita credenciales, así que se
 *   ejecuta a mano o en un job con `DATABASE_URL`.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

/** Quita comentarios `--` de un SQL: los ejemplos de reversión no son código activo. */
const sqlCode = (sql: string): string =>
  sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

/** Quita comentarios de bloque y de línea de un fichero TS/TSX. */
const tsCode = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let failures = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};

console.log("# Verificación del blindaje de seguridad — DRL Champions (Auditoría Fase A)\n");

/** Columnas de `profiles` que el cliente NO debe poder escribir nunca. */
const PROTECTED_COLUMNS = [
  "credits", "tokens", "xp", "level",
  "collection_value", "distinct_cards", "rarest_rank",
  "market_volume", "packs_opened", "taxes_paid", "is_admin",
] as const;

/** RPC que acuñan o mueven valor y deben estar revocadas para el cliente. */
const REVOKED_RPCS = [
  "deposit_card", "create_listing", "buy_listing", "make_offer", "accept_offer",
] as const;

// ─────────────────────── 1. SEC-02 · blindaje de public.profiles ───────────────────────
console.log("## SEC-02 · public.profiles (0009_profiles_hardening.sql)");
{
  const p = "supabase/migrations/0009_profiles_hardening.sql";
  check("La migración existe", existsSync(join(ROOT, p)));
  const sql = existsSync(join(ROOT, p)) ? sqlCode(read(p)) : "";
  const norm = sql.toLowerCase().replace(/\s+/g, " ");

  check(
    "Capa 1 · revoca UPDATE de tabla completa a anon y authenticated",
    norm.includes("revoke update on public.profiles from anon") &&
      norm.includes("revoke update on public.profiles from authenticated"),
  );
  check(
    "Capa 1 · concede UPDATE SOLO sobre (username, avatar)",
    /grant update \(\s*username\s*,\s*avatar\s*\) on public\.profiles to authenticated/.test(norm),
  );
  check(
    "Capa 1 · no reconcede UPDATE de tabla completa a authenticated",
    !/grant update on public\.profiles to authenticated/.test(norm),
  );
  check(
    "Capa 1 · el backend (service_role) conserva acceso",
    norm.includes("grant update on public.profiles to service_role"),
  );
  check(
    "Capa 2 · la política de UPDATE tiene `with check` (antes solo `using`)",
    /create policy "edita tu perfil" on public\.profiles for update using \(auth\.uid\(\) = id\) with check \(auth\.uid\(\) = id\)/.test(norm),
  );
  check(
    "Capa 3 · existe el trigger guardián sobre profiles",
    norm.includes("create trigger profiles_guard") && norm.includes("before update on public.profiles"),
  );
  check(
    "Capa 3 · el guardián solo se aplica a roles de cliente (no rompe RPC ni service_role)",
    norm.includes("current_user not in ('authenticated', 'anon')"),
  );

  for (const col of PROTECTED_COLUMNS) {
    check(
      `Capa 3 · el guardián protege \`${col}\``,
      new RegExp(`new\\.${col}\\s+is distinct from old\\.${col}`).test(norm),
    );
  }
}

// ─────────────────────── 2. SEC-01 · cierre del mercado global ───────────────────────
console.log("\n## SEC-01 + BUG-01/02 · RPC de mercado (0010_market_lockdown.sql)");
{
  const p = "supabase/migrations/0010_market_lockdown.sql";
  check("La migración existe", existsSync(join(ROOT, p)));
  const norm = (existsSync(join(ROOT, p)) ? sqlCode(read(p)) : "").toLowerCase().replace(/\s+/g, " ");

  for (const fn of REVOKED_RPCS) {
    check(
      `\`${fn}\` revocada para authenticated`,
      new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from authenticated`).test(norm),
    );
    check(
      `\`${fn}\` NO se reconcede a authenticated en la misma migración`,
      !new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`).test(norm),
    );
  }
  check(
    "Las rutas de recuperación (cancel_listing / cancel_offer) SÍ siguen concedidas",
    /grant execute on function public\.cancel_listing\(uuid\) to authenticated/.test(norm) &&
      /grant execute on function public\.cancel_offer\(uuid\) to authenticated/.test(norm),
  );
  check(
    "No se ha borrado nada: la migración solo revoca/concede, no hace DROP",
    !/drop function|drop table|drop policy/.test(norm),
  );
}

// ─────────────────────── 3. SEC-04/05 · el cliente ya no escribe en profiles ───────────────────────
console.log("\n## SEC-04/05 · el cliente ha dejado de ser autoridad de saldo y ranking");
{
  // Fase B: `lib/supabase/cloud.ts` (pushState/pullState) se ELIMINÓ. Encarnaba el
  // modelo de autoridad-cliente: subía saldo, XP y ranking calculados en el
  // navegador. Ahora el estado se LEE del servidor y no se sube nada.
  check(
    "el módulo de sincronización con autoridad-cliente ya no existe",
    !existsSync(join(ROOT, "src/lib/supabase/cloud.ts")),
  );
  // Barrido de TODO el código de cliente.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) files.push(rel);
    }
  };
  walk("src");

  const cloudImporters = files.filter((f) =>
    /from\s+["'][^"']*supabase\/cloud["']/.test(readFileSync(join(ROOT, f), "utf8")));
  check("no queda ningún consumidor de aquel módulo", cloudImporters.length === 0,
    cloudImporters.join(", "));

  // Ningún update a profiles puede tocar una columna protegida.

  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    // Solo miramos el código que usa el cliente de navegador (anon key).
    if (!src.includes('from("profiles")')) continue;
    if (f.includes("supabase/admin")) continue; // service_role, server-only
    const updates = src.match(/from\("profiles"\)\s*\.update\(([^)]*)\)/g) ?? [];
    for (const u of updates) {
      for (const col of PROTECTED_COLUMNS) {
        if (new RegExp(`\\b${col}\\b`).test(u)) offenders.push(`${f} → ${col}`);
      }
    }
  }
  check(
    "Ningún módulo de cliente escribe columnas protegidas de `profiles`",
    offenders.length === 0,
    offenders.join(", "),
  );
}

// ─────────────────────── 4. Fase B · el servidor es la autoridad ───────────────────────
console.log("\n## Fase B · dirección de la sincronización");
{
  // BUG-05 y BUG-08 desaparecen por construcción: ya no hay dos copias que
  // reconciliar ni snapshot que resubir. El estado se LEE del servidor.
  const sync = tsCode(read("src/components/sync/CloudSync.tsx"));
  check("la sincronización LEE del servidor", sync.includes("syncFromServer"));
  check("y no SUBE estado del cliente",
    !/pushState|game_state|upsert/.test(sync));

  const bridge = read("src/lib/game/sync.ts");
  check("el puente vuelca el estado del servidor en el store de UI",
    bridge.includes("applyServerState"));
  check("las operaciones de sobres pasan por la API, no por el store local",
    /\/api\/game\/packs/.test(read("src/lib/game/client.ts")));
}

// ─────────────────────── 4b. Fase B · autoridad del servidor ───────────────────────
console.log("\n## Fase B · inventario, economía y Pick'ems en servidor");
{
  const m11 = sqlCode(read("supabase/migrations/0011_server_authority.sql")).toLowerCase().replace(/\s+/g, " ");
  const m12 = sqlCode(read("supabase/migrations/0012_pickems.sql")).toLowerCase().replace(/\s+/g, " ");

  for (const t of ["user_cards", "user_packs", "user_game", "credit_transactions", "card_mints"]) {
    check(`\`${t}\` no es escribible por el cliente`,
      new RegExp(`revoke insert, update, delete on public\\.${t} from anon, authenticated`).test(m11));
  }
  check("un nº de serie es único en toda la plataforma",
    /create unique index if not exists user_cards_serial_uniq/.test(m11));
  check("el libro mayor tiene clave de idempotencia única",
    /create unique index if not exists credit_tx_ref_uniq/.test(m11));
  check("no se puede quedar saldo negativo",
    m11.includes("raise exception 'saldo insuficiente'"));

  for (const fn of ["app_adjust_credits", "app_buy_pack", "app_apply_pack_open", "app_grant_cards", "app_grant_pack"]) {
    check(`la RPC \`${fn}\` está revocada al cliente`,
      new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`).test(m11));
  }

  // Pick'ems: el cierre es del servidor y la respuesta no se filtra.
  check("el cierre de una predicción se comprueba con el reloj de la BD",
    /if now\(\) >= v_q\.locks_at then raise exception 'predicción cerrada'/.test(m12));
  check("la opción enviada debe estar entre las declaradas",
    m12.includes("raise exception 'opción inválida'"));
  check("la tabla de preguntas no es legible por el cliente",
    /revoke select on public\.pickem_questions from anon, authenticated/.test(m12));
  check("la vista pública oculta la respuesta hasta el cierre",
    /case when now\(\) >= q\.locks_at then q\.correct_option else null end/.test(m12));
  check("`points` está en el trigger guardián de profiles",
    /new\.points is distinct from old\.points/.test(m12));
  check("el ranking ordena por `points`, que solo escribe el corrector",
    /create or replace view public\.ranking_points/.test(m12));
  for (const fn of ["app_submit_pick", "app_set_correct_option", "app_score_pickem_event"]) {
    check(`la RPC \`${fn}\` está revocada al cliente`,
      new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`).test(m12));
  }

  // El servidor deriva el usuario del token, nunca del cuerpo.
  const session = read("src/server/services/session.ts");
  check("la sesión se resuelve desde el Bearer, no desde el cuerpo",
    session.includes("auth.getUser(token)"));
  for (const route of ["src/app/api/game/packs/route.ts", "src/app/api/game/state/route.ts", "src/app/api/pickems/route.ts"]) {
    const src = tsCode(read(route));
    check(`${route.split("/api/")[1]} exige sesión`, src.includes("getSession(req)"));
    check(`${route.split("/api/")[1]} no acepta userId del cliente`, !/body\.userId|body\.user_id/.test(src));
  }
  check("el precio del sobre lo pone el servidor, no el cliente",
    /getPack\(packId\)/.test(read("src/server/services/packs.ts")) &&
    !/body\.price|p_price: *body/.test(read("src/app/api/game/packs/route.ts")));
  check("la semilla de la tirada la genera el servidor",
    read("src/server/services/packs.ts").includes("randomInt"));
}

// ─────────────────────── 5. SEC-03 · /api/admin/releases ───────────────────────
console.log("\n## SEC-03 · autorización de las rutas admin");
{
  const routes = ["assets", "releases", "tournaments"];
  for (const r of routes) {
    const src = tsCode(read(`src/app/api/admin/${r}/route.ts`));
    check(`/api/admin/${r} usa \`verifyAdmin\` (sesión + is_admin en servidor)`, src.includes("verifyAdmin"));
    check(
      `/api/admin/${r} NO usa ADMIN_ENABLED como control de acceso`,
      !src.includes("ADMIN_ENABLED"),
    );
  }
  const releases = read("src/app/api/admin/releases/route.ts");
  check("La guarda de releases cubre GET y POST", (releases.match(/requireAdmin\(req\)/g) ?? []).length === 2);
  check(
    "Falla cerrado si Supabase admin no está configurado",
    releases.includes("isAdminConfigured()") && releases.includes("503"),
  );

  // Los llamadores del panel deben mandar el Bearer, incluidas las descargas.
  for (const page of ["src/app/admin/releases/page.tsx", "src/app/admin/control/page.tsx"]) {
    const src = read(page);
    check(
      `${page} llama a la API admin con token`,
      src.includes("adminFetch") && !/\bfetch\("\/api\/admin\/releases"/.test(src),
    );
    check(
      `${page} no deja enlaces <a href> de descarga sin autorizar`,
      !/href=\{dl\(/.test(src) && !/<a href=\{`\/api\/admin\/releases\?download=/.test(src),
    );
  }
}

// ─────────────────────── 6. Mercado global cerrado en la UI ───────────────────────
console.log("\n## BUG-01/02/06 · mercado global desactivado de forma controlada");
{
  const features = read("src/config/features.ts");
  const page = read("src/app/mercado/page.tsx");
  check("`GLOBAL_MARKET_ENABLED` está a false", /export const GLOBAL_MARKET_ENABLED = false;/.test(features));
  check("La página de mercado respeta el interruptor", page.includes("GLOBAL_MARKET_ENABLED"));
  check("Se muestra un estado controlado al usuario", page.includes("GlobalMarketDisabled"));
  check(
    "BUG-07 · la reversión de publicación preserva la instancia (`restoreOwnedCard`)",
    /restoreOwnedCard\(removed\);/.test(page),
  );
  check(
    "No se ha borrado el mercado global: el panel sigue en el repositorio para Fase E",
    page.includes("function GlobalTab("),
  );
}

// ─────────────────────── 7. BUG-10 · filtros PostgREST ───────────────────────
console.log("\n## BUG-10 · filtros `.or()` construidos por concatenación");
{
  const market = read("src/lib/supabase/market.ts");
  check("`fetchMyTransactions` valida el UUID antes de interpolarlo", /!isUuid\(userId\)/.test(market));
  const engine = read("src/lib/esports/predict/engine.ts");
  check(
    "El motor de predicción valida los ids de equipo antes de interpolarlos",
    /test\(A\) \|\| !\/\^\[\\w\.-\]\+\$\/\.test\(B\)/.test(engine.replace(/\s+/g, " ")) ||
      engine.includes("if (!/^[\\w.-]+$/.test(A) || !/^[\\w.-]+$/.test(B)) return null;"),
  );
}

// ─────────────────────── 8. Higiene del build (BUG-03 / BUG-04) ───────────────────────
console.log("\n## BUG-03/04 · determinismo del build y del typecheck");
{
  const tsconfig = read("tsconfig.json");
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  // OJO: `next build` REESCRIBE tsconfig.json y vuelve a meter `"incremental": true` por su
  // cuenta. Por eso el invariante de BUG-04 no puede vivir en el fichero: vive en el script,
  // donde `--incremental false` gana siempre sobre lo que diga la configuración.
  check("`scripts` queda fuera del proyecto web", /"exclude":\s*\[[^\]]*"scripts"/s.test(tsconfig));
  check("Existe un proyecto de tipos propio para los scripts", existsSync(join(ROOT, "tsconfig.scripts.json")));
  check(
    "`npm run typecheck` es determinista y cubre ambos proyectos",
    pkg.scripts.typecheck.includes("--incremental false") &&
      pkg.scripts.typecheck.includes("tsconfig.scripts.json"),
  );
}

// ─────────────────────── 9. SEC-07 · cabeceras ───────────────────────
console.log("\n## SEC-07 · cabeceras de seguridad");
{
  const cfg = read("next.config.mjs");
  for (const h of [
    "Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options",
    "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security",
  ]) {
    check(`Se emite \`${h}\``, cfg.includes(h));
  }
  check("La CSP bloquea el encuadre en iframes de terceros", cfg.includes("frame-ancestors 'none'"));
  check("La CSP no permite scripts de otros dominios",
    /script-src 'self' 'unsafe-inline'(?!\s+https?:)/.test(cfg));
  // `'unsafe-eval'` es imprescindible para que React arranque en `next dev`, pero
  // dejarlo en producción anula buena parte de la protección contra XSS. La regresión
  // que hay que impedir es exactamente esa: que aparezca SIN la guarda de desarrollo.
  check("La CSP de producción NO permite `unsafe-eval`",
    !cfg.includes("'unsafe-eval'") || /dev \? " 'unsafe-eval'" : ""/.test(cfg));
  check("Las cabeceras no se emiten en el export estático de escritorio", /desktop\s*\?/.test(cfg));
}

// ─────────────────────── 10. Fase 9 §25 · la progresión no vive en el navegador ───────────────────────
console.log("\n## Fase 9 §25 · la economía y la progresión son del servidor");
{
  const store = read("src/store/useGameStore.ts");

  /*
   * La Fase 9E retiró `claimAchievement` del store. Sumaba créditos en `localStorage`,
   * que es exactamente lo que §25 prohíbe, y además se revertía en la siguiente
   * sincronización con el servidor. Los logros los concede ahora
   * `/api/game/progression`, con su asiento en `credit_transactions`. La regresión que
   * hay que impedir es que ese atajo vuelva.
   */
  check(
    "el store local ya no concede logros (ni sus créditos)",
    !/claimAchievement:\s*\(/.test(store),
  );

  // Las tres tablas de progresión tienen que denegar TODA escritura al cliente.
  const m16 = sqlCode(read("supabase/migrations/0016_progression.sql"))
    .toLowerCase()
    .replace(/\s+/g, " ");
  for (const t of ["user_pass", "user_achievements", "user_cosmetics"]) {
    check(
      `\`${t}\` tiene RLS activada`,
      m16.includes(`alter table public.${t} enable row level security`),
    );
    check(
      `\`${t}\` revoca la escritura a los roles de cliente`,
      new RegExp(`revoke [^;]*on public\\.${t} from [^;]*(anon|authenticated)`).test(m16),
    );
    check(
      `\`${t}\` no tiene ninguna política de escritura`,
      !new RegExp(`create policy [^;]*on public\\.${t} for (insert|update|delete)`).test(m16),
    );
  }

  /*
   * ═══ FASE 10 · LA RUTA ÚNICA DE RECOMPENSA ═══
   *
   * `app_grant_reward` pasó a conceder también PUNTOS COMPETITIVOS, CARTAS y COSMÉTICOS.
   * Es, con diferencia, la RPC más peligrosa del proyecto: quien pudiera llamarla se
   * concedería a sí mismo rango, saldo y colección. Estas comprobaciones existen para que
   * nadie la reconceda al cliente por descuido en una migración futura.
   */
  const m18 = sqlCode(read("supabase/migrations/0018_game_loop.sql"))
    .toLowerCase()
    .replace(/\s+/g, " ");
  check(
    "la RPC `app_grant_reward` está revocada al cliente",
    /revoke all on function public\.app_grant_reward\([^)]*\) from public, anon, authenticated/.test(m18),
  );
  check(
    "y solo la puede ejecutar el servidor (service_role)",
    /grant execute on function public\.app_grant_reward\([^)]*\) to service_role/.test(m18),
  );
  check(
    "una recompensa sin clave de idempotencia se rechaza",
    m18.includes("la recompensa necesita una clave de idempotencia"),
  );
  check(
    "la puerta de idempotencia sigue siendo el asiento del libro mayor",
    /select 1 from public\.credit_transactions where user_id = p_user and ref = p_ref/.test(m18),
  );
  check(
    "los puntos competitivos nunca quedan en negativo",
    /points *= *greatest\(0, points \+ coalesce\(p_points, 0\)\)/.test(m18),
  );

  /*
   * El ciclo de juego (`/api/game/loop`) es de SOLO LECTURA. Si algún día aceptara un
   * POST, sería una superficie de escritura nueva sin revisar.
   */
  const loopRoute = read("src/app/api/game/loop/route.ts");
  check("la ruta del ciclo de juego solo acepta lectura", !/export async function POST/.test(loopRoute));
  check("y exige sesión", /getSession\(req\)/.test(loopRoute) && /No autenticado/.test(loopRoute));

  /*
   * Los duelos pagan. El pago tiene que ir por la ruta única y con la partida como clave
   * de idempotencia: si alguien lo cambiara por una llamada directa a la RPC, se perdería
   * la validación de campos sin ruta de entrega.
   */
  const duels = read("src/server/services/duels.ts");
  check("el duelo paga por la ruta única de recompensa", /from "\.\/rewards"/.test(duels));
  check("y la clave de idempotencia del pago es la partida", /ref: `duel:\$\{matchId\}`/.test(duels));
  check(
    "abandonar una partida no puede pagar (se borra la fila)",
    /from\("duel_matches"\)\s*\.delete\(\)/.test(duels.replace(/\s+/g, " ")) || duels.includes(".delete().eq(\"id\", matchId)"),
  );

  /*
   * ═══ FASE 11 · ECONOMÍA, MERCADO Y DINERO REAL ═══
   *
   * Tres migraciones nuevas mueven valor. Estas comprobaciones existen para que ninguna
   * de sus RPC se conceda al cliente por descuido en una migración futura: quien pudiera
   * llamarlas se concedería saldo, cartas y listados ajenos.
   */
  const m19 = sqlCode(read("supabase/migrations/0019_economy_ledger.sql")).toLowerCase().replace(/\s+/g, " ");
  const m20 = sqlCode(read("supabase/migrations/0020_marketplace_v2.sql")).toLowerCase().replace(/\s+/g, " ");
  const m21 = sqlCode(read("supabase/migrations/0021_payments_prep.sql")).toLowerCase().replace(/\s+/g, " ");
  const m22 = sqlCode(read("supabase/migrations/0022_cosmetics_equip.sql")).toLowerCase().replace(/\s+/g, " ");

  /*
   * Se comprueba por SENTENCIA, no con una expresión regular sobre todo el fichero: la
   * firma de una RPC lleva paréntesis y comas, y escaparla dentro de una plantilla es la
   * clase de detalle que hace que la comprobación pase por accidente sin comprobar nada.
   */
  const revoked = (sql: string, fn: string): boolean =>
    sql.split(";").some((stmt) => {
      const t = stmt.trim();
      return t.startsWith(`revoke all on function public.${fn}(`)
        && t.endsWith("from public, anon, authenticated");
    });

  for (const fn of ["_ledger_apply", "app_salvage_cards", "app_buy_pack", "app_apply_pack_open"]) {
    check(`la RPC \`${fn}\` está revocada al cliente`, revoked(m19, fn));
  }
  for (const fn of ["app_market_list", "app_market_cancel", "app_market_buy", "app_market_expire"]) {
    check(`la RPC \`${fn}\` está revocada al cliente`, revoked(m20, fn));
  }
  check(
    "la RPC `app_equip_cosmetic` está revocada al cliente",
    revoked(m22, "app_equip_cosmetic"),
  );

  // El saldo solo se mueve por una puerta, y esa puerta corta en negativo.
  check("el saldo nunca puede quedar en negativo",
    m19.includes("raise exception 'saldo insuficiente'"));
  check("comprar un sobre EXIGE clave de idempotencia",
    m19.includes("una compra necesita clave de idempotencia"));
  check("desguazar EXIGE clave de idempotencia",
    m19.includes("un desguace necesita clave de idempotencia"));
  check("el registro de operaciones guarda el RESULTADO, para poder repetirlo",
    /create table if not exists public\.economy_ops/.test(m19) && m19.includes("result jsonb"));
  check("`economy_ops` no es escribible por el cliente",
    /revoke insert, update, delete on public\.economy_ops from anon, authenticated/.test(m19));

  // Mercado: propiedad, depósito y atomicidad.
  check("el mercado bloquea el listado antes de cobrar (doble compra)",
    /select \* into v from public\.market_listings where id = p_listing_id for update/.test(m20));
  check("el depósito en garantía es un BLOQUEO, no un traslado de la carta",
    m20.includes("update public.user_cards set locked = true"));
  check("un ejemplar no puede estar en dos listados vivos",
    /create unique index if not exists market_listings_uid_active_uniq/.test(m20));
  check("comprar tu propio listado se rechaza y se marca",
    m20.includes("no puedes comprar tu propio listado"));
  check("el dinero del mercado pasa por el libro mayor",
    m20.includes("public._ledger_apply"));
  check("`deposit_card` sigue SIN reconcederse (SEC-01)",
    !/grant execute on function public\.deposit_card/.test(m20));

  // Dinero real: la frontera existe y el cliente no la cruza.
  check("un pago no puede tener importe negativo",
    /amount_cents bigint not null check \(amount_cents > 0\)/.test(m21));
  check("la divisa tiene que ser ISO-4217",
    m21.includes("currency ~ '^[a-z]{3}$'"));
  check("el mismo cobro del proveedor no se liquida dos veces",
    /create unique index if not exists payments_provider_tx_uniq/.test(m21));
  check("una intención de pago se crea una sola vez",
    /create unique index if not exists payments_idem_uniq/.test(m21));
  check("`payments` no es escribible por el cliente",
    /revoke insert, update, delete on public\.payments from anon, authenticated/.test(m21));
  check("el cliente nombra un PRODUCTO, no una cantidad de créditos",
    m21.includes("product_id text not null") && !/credits bigint not null/.test(m21));
  check("`equipped` está en el trigger guardián de profiles",
    /new\.equipped is distinct from old\.equipped/.test(m22));

  /*
   * Y en Node: la ruta de economía NO puede aceptar un importe del cliente. Es la
   * comprobación que impide desguazar una común por novecientos mil créditos.
   */
  const econRoute = read("src/app/api/game/economy/route.ts");
  check("la ruta de economía no acepta ningún importe del cliente",
    !/body\.(total|amount|price|credits)/.test(econRoute));
  check("y exige sesión", /getSession\(req\)/.test(econRoute));

  const econService = read("src/server/services/economy.ts");
  check("el importe del desguace lo calcula el servidor con la tabla del dominio",
    /salvageValue/.test(econService) && /domain\/economy\/salvage/.test(econService));

  const marketRoute = read("src/app/api/game/market/route.ts");
  check("las escrituras del mercado están gobernadas por el interruptor",
    /GLOBAL_MARKET_ENABLED/.test(marketRoute) && /WRITES/.test(marketRoute));
  check("el mercado exige sesión", /getSession\(req\)/.test(marketRoute));

  // El precio del pase es configurable y no hay pasarela conectada (§12).
  const mon = read("src/config/monetization.ts");
  check("el precio del pase vive en la configuración de monetización", /PASS_PRODUCT/.test(mon));
  check("no hay pasarela de pago activada (§12)", /PAYMENTS_ENABLED\s*=\s*false/.test(mon));

  /*
   * Ninguna pantalla puede escribir un precio a mano: si el precio cambia, tiene que
   * cambiar en un solo sitio. Se busca cualquier cifra con símbolo de euro pegado.
   */
  const priceUi = ["src/app/logros/page.tsx", "src/app/tienda/page.tsx", "src/app/cuenta/page.tsx"];
  const hardcoded = priceUi.filter(
    (f) => existsSync(join(ROOT, f)) && /\d\s*€|€\s*\d/.test(read(f)),
  );
  check("ninguna pantalla escribe un precio a mano", hardcoded.length === 0, hardcoded.join(", "));
}


// ===========================================================================
// FASE 12 - EVENTOS EN VIVO, TIENDA HONESTA Y CERROJO DEL MERCADO
// ===========================================================================
{
  console.log("\n## Fase 12 - eventos, tienda y mercado");

  const route = read("src/app/api/game/events/route.ts");
  check("la ruta de eventos exige sesion", /getSession\(req\)/.test(route));
  check("solo admite la accion de cobrar", /b\.action !== "claim"/.test(route));

  /*
   * LA COMPROBACION CENTRAL DE LA FASE: el cuerpo de la peticion no puede nombrar dinero.
   * Si la ruta aceptara `credits`, `reward` o `amount`, el premio lo pondria el cliente.
   */
  const bodyFields = [...route.matchAll(/b\.(\w+)/g)].map((m) => m[1]);
  const forbidden = bodyFields.filter((f) =>
    /credit|reward|amount|xp|token|pack|points|price/i.test(f));
  check("el cuerpo NO acepta ninguna cantidad ni recompensa",
    forbidden.length === 0, forbidden.join(", ") || "solo action, eventId y challengeId");
  check("los identificadores se validan con una expresion estricta",
    /const ID = \/\^\[/.test(route));

  const svc = read("src/server/services/events.ts");
  check("las recompensas de evento pasan por la ruta unica",
    /from "\.\/rewards"/.test(svc) && /await award\(/.test(svc));
  check("no hay una segunda ruta de recompensa en eventos",
    !/app_grant_reward/.test(svc), "no llama a la RPC por su cuenta");
  check("la fase del evento se comprueba ANTES de pagar",
    svc.indexOf("canClaimInPhase") < svc.indexOf("await award("));
  check("el progreso se cuenta en el servidor, no llega del cliente",
    /eventMetricsFor\(admin, userId/.test(svc));
  check("un desafio ya reclamado se rechaza antes de pagar",
    svc.indexOf("Ya has reclamado") < svc.indexOf("await award("));

  /*
   * La hora la pone el servidor. Si la fase se calculara con una fecha del cliente,
   * bastaria con adelantar el reloj para reabrir un evento archivado.
   */
  const lifecycle = read("src/domain/events/lifecycle.ts");
  check("el ciclo de vida es puro y recibe el instante como parametro",
    /export function eventPhase\(ev: EventTiming, now: number\)/.test(lifecycle));
  check("un evento archivado no esta entre las fases que dejan cobrar",
    /CLAIMABLE_PHASES[^=]*=\s*\["live", "ending", "completed"\]/.test(lifecycle));

  // El cliente de eventos no decide nada: solo transporta dos identificadores.
  const client = read("src/lib/game/events.ts");
  check("el cliente de eventos no envia cantidades",
    !/credits|reward:|amount/.test(client.replace(/\/\*[\s\S]*?\*\//g, "")));

  /*
   * La tienda ensena el reparto MEDIDO, no el declarado. Ensenar los pesos de `data/packs`
   * seria anunciar una probabilidad que el sobre no cumple: la garantia de «rara o mejor»
   * ocupa una casilla y desplaza el reparto entero.
   */
  const card = read("src/components/packs/PackStoreCard.tsx");
  check("la tienda ensena el reparto medido, no los pesos declarados",
    /packStats\(pack\.id\)/.test(card) && /guidanceFor\(pack\.id\)/.test(card));

  // El cerrojo del mercado.
  const readiness = read("src/domain/economy/marketReadiness.ts");
  check("los criterios de apertura del mercado estan escritos y son comprobables",
    /MARKET_CRITERIA/.test(readiness) && /marketReady/.test(readiness));
  check("un criterio sin comprobar NO cuenta como cumplido",
    /every\(\(r\) => r\.status === "met"\)/.test(readiness));
  check("el mercado sigue cerrado",
    /GLOBAL_MARKET_ENABLED\s*=\s*false/.test(read("src/config/features.ts")));
}


// ===========================================================================
// FASE 13 - MAESTRIA, CONTENIDO Y SOBRES RETIRADOS
// ===========================================================================
{
  console.log("\n## Fase 13 - maestria y contenido");

  const route = read("src/app/api/game/mastery/route.ts");
  check("la ruta de maestria exige sesion", /getSession\(req\)/.test(route));
  check("solo admite la accion de cobrar", /b\.action !== "claim"/.test(route));

  /*
   * Igual que en eventos: el cuerpo no puede nombrar dinero. Aqui ademas importa que no
   * pueda nombrar PROGRESO, porque el progreso es lo que decide si se cobra.
   */
  const fields = [...route.matchAll(/b\.(\w+)/g)].map((m) => m[1]);
  const forbidden = fields.filter((f) =>
    /credit|reward|amount|xp|token|pack|points|price|owned|progress|cards/i.test(f));
  check("el cuerpo NO acepta cantidades, recompensas ni progreso",
    forbidden.length === 0, forbidden.join(", ") || "solo action, setId y at");

  const svc = read("src/server/services/mastery.ts");
  check("la maestria paga por la ruta unica de recompensa",
    /from "\.\/rewards"/.test(svc) && /await award\(/.test(svc));
  check("no llama a la RPC de recompensa por su cuenta", !/app_grant_reward/.test(svc));
  check("el progreso se cuenta en el servidor contra user_cards",
    /from\("user_cards"\)/.test(svc));

  /*
   * LA INVARIANTE ECONOMICA DE LA FASE 13: la maestria no reparte creditos. No es una
   * convencion, es un corte en el codigo que se ejecuta antes de pagar.
   */
  check("hay un corte que impide pagar cualquier cosa que no sea cosmetica",
    /function assertNoCredits/.test(svc) && /assertNoCredits\(tier\.reward/.test(svc));
  check("el corte se ejecuta ANTES de pagar",
    svc.indexOf("assertNoCredits(tier.reward") < svc.indexOf("await award("));
  check("un escalon ya cobrado se rechaza antes de pagar",
    svc.indexOf("Ya has reclamado") < svc.indexOf("await award("));

  // Los sobres retirados existen pero no se venden.
  const store = read("src/app/tienda/page.tsx");
  check("la tienda no vende los sobres retirados", /!p\.retired/.test(store));
  const packs = read("src/data/packs.ts");
  check("hay al menos un sobre retirado y sigue en el catalogo",
    /retired: true/.test(packs) && /id: "prime"/.test(packs));

  /*
   * Y la comprobacion que habria cazado el sobre China tres fases antes: ningun peso
   * declarado puede apuntar a una rareza que el sobre no tenga.
   */
  check("existe la verja de contenido", existsSync(join(ROOT, "scripts/content-verify.ts")));
  const cv = read("scripts/content-verify.ts");
  check("la verja cruza pesos declarados con el pool real",
    /buildPool/.test(cv) && /bucket vac/.test(cv));
  check("la verja tiene trinquete sobre lo pendiente",
    /KNOWN_BLOCKED/.test(cv) && /NO_HOLDER_VARIANTS/.test(cv));
}


// ===========================================================================
// FASE 14 - PRESTIGIO: EL PRIMER SUMIDERO QUE COBRA
// ===========================================================================
{
  console.log("\n## Fase 14 - prestigio (sumidero)");

  const route = read("src/app/api/game/prestige/route.ts");
  check("la ruta de prestigio exige sesion", /getSession\(req\)/.test(route));
  check("solo admite la accion de comprar", /b\.action !== "buy"/.test(route));

  /*
   * LA COMPROBACION CRITICA. Esta ruta COBRA, asi que un precio en el cuerpo seria un
   * precio que pone el cliente. Se comprueba que ningun campo leido del cuerpo suene a
   * dinero, a cantidad o a saldo.
   */
  const fields = [...route.matchAll(/b\.(\w+)/g)].map((m) => m[1]);
  const forbidden = fields.filter((f) =>
    /price|credit|cost|amount|balance|discount|qty|quantity/i.test(f));
  check("el cuerpo NO acepta precio, saldo ni cantidad",
    forbidden.length === 0, forbidden.join(", ") || "solo action, setId y tierId");

  const svc = read("src/server/services/prestige.ts");
  check("el precio lo pone el servidor desde PRESTIGE_TIERS",
    /p_price: tier\.price/.test(svc));
  check("el servicio no lee ningun precio de fuera",
    !/price\s*[:=]\s*(b|body|input)\./.test(svc));
  check("exige tener la insignia de pleno antes de cobrar",
    svc.indexOf("Primero hay que completar") < svc.indexOf("app_buy_cosmetic"));
  check("exige el escalon anterior antes de cobrar",
    svc.indexOf("escalon anterior") < svc.indexOf("app_buy_cosmetic")
    || svc.indexOf("Antes tienes que conseguir") < svc.indexOf("app_buy_cosmetic"));

  /*
   * El dinero pasa por la unica puerta que escribe `profiles.credits` desde la Fase 11.
   * Un UPDATE directo aqui seria una segunda contabilidad.
   */
  const mig = read("supabase/migrations/0024_prestige_sink.sql");
  check("cobra por _ledger_apply, no escribiendo el saldo",
    /_ledger_apply\(/.test(mig) && !/update public\.profiles/.test(mig));
  check("el cargo es NEGATIVO: es un sumidero, no un grifo",
    /-p_price/.test(mig));
  check("es idempotente por economy_ops",
    /from public\.economy_ops where ref = p_ref/.test(mig));
  check("rechaza comprar dos veces el mismo cosmetico",
    /Ya tienes ese cosm/.test(mig));
  check("comprueba el requisito DENTRO de la transaccion",
    mig.indexOf("escal") < mig.indexOf("_ledger_apply("));
  /*
   * `revoked` vive dentro del bloque de la Fase 11. Aqui se comprueba por LINEA, que ademas
   * es mas robusto: partir por `;` arrastra los comentarios de encima al mismo trozo.
   */
  /*
   * `revoked` vive dentro del bloque de la Fase 11. Aqui se comprueba LINEA a LINEA, que
   * ademas es mas robusto: partir por `;` arrastraria los comentarios de encima al mismo
   * trozo y el `startsWith` fallaria por ellos.
   */
  const migLines = mig.split("\n").map((l) => l.trim());
  const revokeLine = migLines.includes(
    "revoke all on function public.app_buy_cosmetic(uuid, text, bigint, text, text) from public, anon, authenticated;");
  const grantLine = migLines.includes(
    "grant execute on function public.app_buy_cosmetic(uuid, text, bigint, text, text) to service_role;");
  check("la RPC esta revocada al cliente y solo la ejecuta el servidor",
    revokeLine && grantLine, `revoke=${revokeLine} grant=${grantLine}`);

  // Y el prestigio no puede dar ninguna ventaja: es un color.
  const dom = read("src/domain/collection/prestige.ts");
  check("un escalon solo tiene id, nombre, precio, color y orden",
    !/(credits|xp|tokens|packId|cardId|ovr|stats)\s*:/.test(dom));
}


console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
