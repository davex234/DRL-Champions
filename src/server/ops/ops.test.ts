/**
 * F67 · PRODUCTION READINESS — validación de configuración, logs sin secretos, salud, borde y secretos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateEnv, describeEnv, isPublicRelease, gotruePublicProblems } from "./env";
import { newErrorId, scrub, internalError, safeServerMessage, errorText } from "./log";
import { summarize, cachedReadiness, readiness, __resetReadinessCache, type Readiness } from "./health";
import { secretMatches } from "./secret";
import { bodyLimitFor, tooLarge, qaHarnessBlocked, BODY_LIMIT } from "@/domain/ops/edge";
import { EXPECTED_SCHEMA_KEYS, MIGRATION_HEAD } from "./release";

const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.y`;
const GOOD = { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"), SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"), SYNC_SECRET: "0123456789abcdef0123" };

test("F67 env · configuración completa: ok, sin valores en el informe", () => {
  const r = validateEnv(GOOD);
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r).includes(GOOD.SYNC_SECRET), "nunca devuelve valores");
});

test("F67 env · falta Supabase o la clave de servicio: CRÍTICO (en producción impide arrancar)", () => {
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const r = validateEnv({ ...GOOD, [k]: "" });
    assert.equal(r.ok, false, k);
    assert.ok(r.issues.some((i) => i.name === k && i.level === "CRITICAL"));
    assert.match(describeEnv(r), new RegExp(k));
  }
});

test("F67 env · la clave PÚBLICA no puede ser service_role; URL rota es crítica", () => {
  assert.equal(validateEnv({ ...GOOD, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("service_role") }).ok, false);
  assert.equal(validateEnv({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: jwt("anon") }).ok, false);
  assert.equal(validateEnv({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: "no-es-url" }).ok, false);
});

test("F67 env · interruptores de QA/sandbox encendidos en producción se señalan", () => {
  const r = validateEnv({ ...GOOD, NEXUS_SANDBOX_CREDITS: "1", NEXUS_QA_HARNESS: "1", NEXT_PUBLIC_TELEGRAM_WEBHOOK: "https://x" });
  assert.equal(r.ok, true);
  for (const k of ["NEXUS_SANDBOX_CREDITS", "NEXUS_QA_HARNESS", "NEXT_PUBLIC_TELEGRAM_WEBHOOK"]) assert.ok(r.issues.some((i) => i.name === k), k);
});

test("F67 log · códigos de error legibles, contexto sin secretos, 500 sin detalles internos", async () => {
  const id = newErrorId();
  assert.match(id, /^[A-HJ-NP-Z2-9]{6}$/);
  const s = scrub({ token: "abc", password: "p", matchId: "m", authorization: "Bearer x", email: "a@b.c" });
  assert.deepEqual(s, { token: "[redactado]", password: "[redactado]", matchId: "m", authorization: "[redactado]", email: "[redactado]" });
  const orig = console.error; const lines: string[] = []; console.error = (l: string) => lines.push(l);
  try {
    const res = internalError("test", new Error('relation "secret_table" does not exist at /srv/app/x.ts'));
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(body), /relation|secret_table|\/srv/);
    assert.match(body.error, new RegExp(body.errorId));
    assert.match(lines[0], new RegExp(body.errorId), "el mismo código está en el log");
    assert.equal(errorText({ message: "boom", code: "42P01" }), "boom [42P01]");
    assert.deepEqual(safeServerMessage("t", 409, "Ya reclamado"), { error: "Ya reclamado" });
    assert.doesNotMatch(safeServerMessage("t", 500, "column x does not exist").error, /column/);
  } finally { console.error = orig; }
});

test("F67 salud · agregación: crítico caído = not_ready; opcional caído = degraded", () => {
  assert.equal(summarize([{ id: "database", ok: true, critical: true }, { id: "storage", ok: true, critical: false }]), "ready");
  assert.equal(summarize([{ id: "database", ok: true, critical: true }, { id: "storage", ok: false, critical: false }]), "degraded");
  assert.equal(summarize([{ id: "database", ok: false, critical: true }]), "not_ready");
});

test("F67 salud · sin cliente de servidor: not_ready, y el resultado no lleva hosts ni valores", async () => {
  const r = await readiness(null, { cards: 331 }, {});
  assert.equal(r.status, "not_ready");
  assert.equal(r.migrationHead, MIGRATION_HEAD);
  assert.doesNotMatch(JSON.stringify(r), /https?:\/\//);
});

test("F67 salud · caché de un solo vuelo: diez lecturas simultáneas = una sonda", async () => {
  __resetReadinessCache();
  let runs = 0;
  const fake = async (): Promise<Readiness> => { runs++; await new Promise((r) => setTimeout(r, 5)); return { status: "ready", checkedAt: "", migrationHead: MIGRATION_HEAD, checks: [] }; };
  await Promise.all(Array.from({ length: 10 }, () => cachedReadiness(fake)));
  await cachedReadiness(fake);
  assert.equal(runs, 1);
  __resetReadinessCache();
});

test("F67 borde · tamaño de cuerpo por grupo de rutas y arneses de QA ocultos en producción", () => {
  assert.equal(bodyLimitFor("/api/game/packs"), BODY_LIMIT.game);
  assert.equal(bodyLimitFor("/api/admin/pools"), BODY_LIMIT.admin);
  assert.equal(bodyLimitFor("/api/admin/cms/assets"), BODY_LIMIT.upload);
  assert.equal(bodyLimitFor("/jugar"), null);
  assert.equal(tooLarge("/api/game/packs", "POST", String(BODY_LIMIT.game + 1)), true);
  assert.equal(tooLarge("/api/game/packs", "POST", "1000"), false);
  assert.equal(tooLarge("/api/game/packs", "GET", "99999999"), false);
  assert.equal(tooLarge("/api/game/packs", "POST", null), false);
  assert.equal(qaHarnessBlocked("/design-system/fase62", { NODE_ENV: "production" }), true);
  assert.equal(qaHarnessBlocked("/design-system/fase62", { NODE_ENV: "production", NEXUS_QA_HARNESS: "1" }), false);
  assert.equal(qaHarnessBlocked("/design-system", { NODE_ENV: "development" }), false);
  assert.equal(qaHarnessBlocked("/jugar", { NODE_ENV: "production" }), false);
});

test("F67 secretos · comparación en tiempo constante que falla cerrado", () => {
  assert.equal(secretMatches("abc", "abc"), true);
  assert.equal(secretMatches("abd", "abc"), false);
  assert.equal(secretMatches("abc", "abcd"), false);
  assert.equal(secretMatches(null, "abc"), false);
  assert.equal(secretMatches("abc", undefined), false);
});

test("F67 contratos · rutas sin mensajes internos en 500, secretos con secretMatches, middleware con tamaño e id", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  for (const r of ["credits", "economy", "events", "loop", "market", "mastery", "prestige", "state", "strats"]) {
    const src = read(`src/app/api/game/${r}/route.ts`);
    assert.doesNotMatch(src, /e instanceof Error \? e\.message[^\n]*\n[^\n]*status: 500/, r);
    assert.doesNotMatch(src, /\{ error: (error|e1)\.message \}, \{ status: 500/, r);
  }
  for (const p of ["src/app/api/esports/sync/route.ts", "src/app/api/esports/predict/route.ts", "src/app/api/market/sync-reference/route.ts"]) {
    assert.match(read(p), /secretMatches\(/, p);
    assert.doesNotMatch(read(p), /!== secret/, p);
  }
  const mw = read("src/middleware.ts");
  assert.match(mw, /tooLarge\(/); assert.match(mw, /x-request-id/); assert.match(mw, /qaHarnessBlocked\(/);
  assert.match(read("next.config.mjs"), /poweredByHeader: false/);
  assert.match(read("package.json"), /"sharp": "\^0\.35/);
  for (const r of ["packs", "store", "credits", "progression", "prestige", "mastery", "economy"]) assert.match(read(`src/app/api/game/${r}/route.ts`), /"economy_write"/, r);
});

/* ───────────── PRE-F70 · 0058 aplicada: la readiness comprueba su EFECTO (anon no lee profiles) ───────────── */
function fakeSb(): import("@supabase/supabase-js").SupabaseClient {
  const q = (v: unknown) => { const o: Record<string, unknown> = { select: () => o, neq: () => o, then: (res: (x: unknown) => unknown) => Promise.resolve(v).then(res) }; return o; };
  return {
    from: (t: string) => q(t === "content_cards" ? { count: 331 } : { count: 30 }),
    // 0067 · la sonda llama a `app_admin_set_admin` con actor nulo: la RPC real responde NOT_ADMIN (existe, sin efectos).
    rpc: async (fn: string) => (fn === "app_admin_set_admin"
      ? { data: null, error: { code: "42501", message: "NOT_ADMIN" } }
      : { data: Object.fromEntries(EXPECTED_SCHEMA_KEYS.map((k) => [k, true])) }),
    storage: { listBuckets: async () => ({ data: [] }) },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}
const statusFetch = (status: number, seen: string[] = []) => (async (u: string | URL | Request) => { seen.push(String(u)); return new Response(null, { status }); }) as typeof fetch;

test("PRE-F70 0058 → F73 0059 → 0060 → F79.1 0061 → F82 0062 → F89 0063 → F83 0064 → F84 0065 → F85 0066 → 0067 → 0068 → F86 0069 → F86.2 0070 → F87 0071 → F87.1 0072 → F87.2 0073 · la cabeza que espera el código es 0073_pickems_launch_guard", () => {
  assert.equal(MIGRATION_HEAD, "0073_pickems_launch_guard");
});

test("0068 · por ESTADO REAL: con 0067 pero sin profiles.public_tag → cabeza 0067, check «account_tag» falla y readiness «degraded»", async () => {
  const base = fakeSb() as unknown as { from: (t: string) => unknown };
  const no68 = { ...base, from: (t: string) => (t === "account_tag_registry"
    ? { select: () => Promise.resolve({ data: null, error: { code: "42P01", message: `relation "public.${t}" does not exist` } }) }
    : base.from(t)) } as unknown as import("@supabase/supabase-js").SupabaseClient;
  const r = await readiness(no68, { cards: 331 }, GOOD, statusFetch(401));
  assert.equal(r.migrationHead, "0067_admin_management");
  assert.equal(r.checks.find((c) => c.id === "account_tag")?.detail, "0068 no aplicada");
  assert.equal(r.status, "degraded");
  assert.equal((await readiness(fakeSb(), { cards: 331 }, GOOD, statusFetch(401))).checks.find((c) => c.id === "account_tag")?.ok, true);
});

test("0067 · por ESTADO REAL: con 0066 pero sin app_admin_set_admin → cabeza 0066, check «admins» falla y readiness «degraded»", async () => {
  const base = fakeSb() as unknown as { rpc: (fn: string) => Promise<unknown> };
  const no67 = { ...base, rpc: (fn: string) => (fn === "app_admin_set_admin"
    ? Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function public.app_admin_set_admin" } })
    : base.rpc(fn)) } as unknown as import("@supabase/supabase-js").SupabaseClient;
  const r = await readiness(no67, { cards: 331 }, GOOD, statusFetch(401));
  assert.equal(r.migrationHead, "0066_social_2");
  assert.equal(r.checks.find((c) => c.id === "admins")?.detail, "0067 no aplicada");
  assert.equal(r.status, "degraded");
  const ok = await readiness(fakeSb(), { cards: 331 }, GOOD, statusFetch(401));
  assert.equal(ok.checks.find((c) => c.id === "admins")?.ok, true, "con la RPC (responde NOT_ADMIN al actor nulo) → aplicada");
});

test("F85 · 0066 por ESTADO REAL: con 0065 pero sin social_blocks → cabeza 0065, check «social» falla y readiness «degraded»", async () => {
  const base = fakeSb() as unknown as { from: (t: string) => unknown };
  const no66 = { ...base, from: (t: string) => (t === "social_blocks"
    ? { select: () => Promise.resolve({ data: null, error: { code: "42P01", message: `relation "public.${t}" does not exist` } }) }
    : base.from(t)) } as unknown as import("@supabase/supabase-js").SupabaseClient;
  const r = await readiness(no66, { cards: 331 }, GOOD, statusFetch(401));
  assert.equal(r.migrationHead, "0065_ranked_competitive");
  assert.equal(r.checks.find((c) => c.id === "social")?.detail, "0066 no aplicada");
  assert.equal(r.status, "degraded");
});

test("F84 · 0065 por ESTADO REAL: con 0064 pero sin competitive_seasons → cabeza 0064, check «ranked» falla y readiness «degraded»", async () => {
  const base = fakeSb() as unknown as { from: (t: string) => unknown };
  const no65 = { ...base, from: (t: string) => (t === "competitive_seasons" || t === "competitive_ladder"
    ? { select: () => Promise.resolve({ data: null, error: { code: "42P01", message: `relation "public.${t}" does not exist` } }) }
    : base.from(t)) } as unknown as import("@supabase/supabase-js").SupabaseClient;
  const r = await readiness(no65, { cards: 331 }, GOOD, statusFetch(401));
  assert.equal(r.migrationHead, "0064_season_track");
  assert.equal(r.checks.find((c) => c.id === "ranked")?.detail, "0065 no aplicada");
  assert.equal(r.status, "degraded");
});

test("F83 · 0064 por ESTADO REAL: con 0063 pero sin game_seasons → cabeza 0063, check «seasons» falla y readiness «degraded»", async () => {
  const base = fakeSb() as unknown as { from: (t: string) => unknown };
  const no64 = { ...base, from: (t: string) => (t === "game_seasons"
    ? { select: () => Promise.resolve({ data: null, error: { code: "42P01", message: `relation "public.${t}" does not exist` } }) }
    : base.from(t)) } as unknown as import("@supabase/supabase-js").SupabaseClient;
  const r = await readiness(no64, { cards: 331 }, GOOD, statusFetch(401));
  assert.equal(r.migrationHead, "0063_profile_favorite_team");
  assert.equal(r.checks.find((c) => c.id === "seasons")?.detail, "0064 no aplicada");
  assert.equal(r.status, "degraded");
});

test("F89 · 0063 por ESTADO REAL: con 0062 pero sin favorite_team_id → cabeza 0062, check «profile» falla y readiness «degraded»", async () => {
  const base = fakeSb() as unknown as { from: (t: string) => unknown };
  const no63 = { ...base, from: (t: string) => (t === "player_profile_customization"
    ? { select: () => Promise.resolve({ data: null, error: { code: "42703", message: "column player_profile_customization.favorite_team_id does not exist" } }) }
    : base.from(t)) } as unknown as import("@supabase/supabase-js").SupabaseClient;
  const r = await readiness(no63, { cards: 331 }, GOOD, statusFetch(401));
  assert.equal(r.migrationHead, "0062_collection_sets");
  assert.equal(r.checks.find((c) => c.id === "profile")?.detail, "0063 no aplicada");
  assert.equal(r.status, "degraded");
});

test("F82 · 0062 por ESTADO REAL: con 0061 pero sin collection_sets → cabeza 0061, check «collections» falla y readiness «degraded»", async () => {
  const base = fakeSb() as unknown as { from: (t: string) => unknown };
  const no62 = { ...base, from: (t: string) => (t === "collection_sets"
    ? { select: () => Promise.resolve({ data: null, error: { code: "42P01", message: `relation "public.${t}" does not exist` } }) }
    : base.from(t)) } as unknown as import("@supabase/supabase-js").SupabaseClient;
  const r = await readiness(no62, { cards: 331 }, GOOD, statusFetch(401));
  assert.equal(r.migrationHead, "0061_forge_progression");
  assert.equal(r.checks.find((c) => c.id === "collections")?.detail, "0062 no aplicada");
  assert.equal(r.status, "degraded");
});

test("F79.1 · 0061 por ESTADO REAL: con 0059 pero sin forge_config → cabeza 0060, check «forge» falla y readiness «degraded»", async () => {
  const base = fakeSb() as unknown as { from: (t: string) => unknown };
  const no61 = { ...base, from: (t: string) => (t === "forge_config"
    ? { select: () => Promise.resolve({ data: null, error: { code: "42P01", message: `relation "public.${t}" does not exist` } }) }
    : base.from(t)) } as unknown as import("@supabase/supabase-js").SupabaseClient;
  const r = await readiness(no61, { cards: 331 }, GOOD, statusFetch(401));
  assert.equal(r.migrationHead, "0060_salvage_last_copy_atomic");
  assert.equal(r.checks.find((c) => c.id === "forge")?.detail, "0061 no aplicada");
  assert.equal(r.status, "degraded");
});

test("PRE-F70 0058 · anon rechazado por REST (401) → privacy ok y readiness «ready», sin hosts en la respuesta", async () => {
  const seen: string[] = [];
  const r = await readiness(fakeSb(), { cards: 331 }, GOOD, statusFetch(401, seen));
  const p = r.checks.find((c) => c.id === "privacy");
  assert.ok(p?.ok, "la sonda de privacidad pasa");
  assert.equal(r.status, "ready");
  assert.equal(r.migrationHead, "0073_pickems_launch_guard", "las tablas de 0059, forge_config, collection_sets, favorite_team_id, game_seasons, competitive_seasons, social_blocks, la RPC de 0067, el tag de 0068, las copas de 0069, el feedback de 0070 y los cuadros de 0071 existen en la BD (fake): cabeza = la última aplicada");
  assert.equal(r.checks.find((c) => c.id === "pickems")?.ok, true);
  assert.equal(r.checks.find((c) => c.id === "pickems_cutover")?.ok, true);
  assert.equal(r.checks.find((c) => c.id === "pickems_launch_guard")?.ok, true);
  assert.equal(r.checks.find((c) => c.id === "crafting")?.ok, true);
  assert.match(seen[0], /\/rest\/v1\/profiles\?select=id&limit=1$/, "lee profiles como anon");
  assert.doesNotMatch(JSON.stringify(r), /https?:\/\//);
});

test("PRE-F70 0058 · si anon vuelve a leer profiles (200), la readiness lo delata: privacy FALLA y estado «degraded»", async () => {
  const r = await readiness(fakeSb(), { cards: 331 }, GOOD, statusFetch(200));
  const p = r.checks.find((c) => c.id === "privacy");
  assert.equal(p?.ok, false);
  assert.match(p?.detail ?? "", /0058 no vigente/);
  assert.equal(r.status, "degraded");
});

/* ── F70 · modo público (DRL_PUBLIC_RELEASE=1) ── */
const PUB = { ...GOOD, NEXT_PUBLIC_SUPABASE_URL: "https://db.drl.example", NEXT_PUBLIC_SITE_URL: "https://play.drl.example" };

test("F70 público · apagado: el informe es idéntico con o sin NEXT_PUBLIC_SITE_URL local (modo local intacto)", () => {
  const local = { ...GOOD, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54521" };
  assert.deepEqual(validateEnv(local), validateEnv({ ...local, NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3005", DRL_PUBLIC_RELEASE: "0" }));
  assert.equal(isPublicRelease({ DRL_PUBLIC_RELEASE: "true" }), false, "solo `1` exacto");
  assert.equal(isPublicRelease({ DRL_PUBLIC_RELEASE: " 1 " }), true);
});

test("F70 público · encendido: origen canónico https público obligatorio (CRÍTICO)", () => {
  assert.equal(validateEnv({ ...PUB, DRL_PUBLIC_RELEASE: "1" }).ok, true);
  for (const [site, why] of [[undefined, /falta/], ["http://play.drl.example", /no es https/], ["https://127.0.0.1:3005", /localhost/], ["https://localhost", /localhost/], ["nope", /válida/]] as const) {
    const r = validateEnv({ ...PUB, NEXT_PUBLIC_SITE_URL: site, DRL_PUBLIC_RELEASE: "1" });
    assert.equal(r.ok, false, String(site));
    assert.match(r.issues.find((i) => i.name === "NEXT_PUBLIC_SITE_URL")?.problem ?? "", why);
  }
  const sb = validateEnv({ ...PUB, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54521", DRL_PUBLIC_RELEASE: "1" });
  assert.equal(sb.ok, false);
  assert.ok(sb.issues.some((i) => i.name === "NEXT_PUBLIC_SUPABASE_URL" && i.level === "CRITICAL"));
  assert.equal(validateEnv({ ...PUB, NEXUS_QA_HARNESS: "1", DRL_PUBLIC_RELEASE: "1" }).ok, false);
  assert.ok(!JSON.stringify(validateEnv({ ...PUB, DRL_PUBLIC_RELEASE: "1" })).includes("play.drl.example"), "nunca devuelve valores");
});

test("F70 público · GoTrue: buzón local, SITE_URL local, allow-list local y autoconfirmación bloquean", () => {
  const today = { GOTRUE_SITE_URL: "http://127.0.0.1:3000", GOTRUE_URI_ALLOW_LIST: "https://127.0.0.1:3000", GOTRUE_SMTP_HOST: "supabase_inbucket_DRLCards", GOTRUE_MAILER_AUTOCONFIRM: "true" };
  assert.equal(gotruePublicProblems(today).length, 4);
  const ok = { GOTRUE_SITE_URL: "https://play.drl.example", GOTRUE_URI_ALLOW_LIST: "https://play.drl.example/cuenta,https://play.drl.example/**", GOTRUE_SMTP_HOST: "smtp.proveedor.example", GOTRUE_MAILER_AUTOCONFIRM: "false" };
  assert.deepEqual(gotruePublicProblems(ok, "https://play.drl.example"), []);
  assert.deepEqual(gotruePublicProblems(ok, "https://otro.example"), ["GOTRUE_SITE_URL ≠ NEXT_PUBLIC_SITE_URL"]);
  for (const host of ["mailpit", "localhost", "127.0.0.1", ""]) assert.match(gotruePublicProblems({ ...ok, GOTRUE_SMTP_HOST: host }).join(), /SMTP=/);
  assert.match(gotruePublicProblems({ ...ok, GOTRUE_URI_ALLOW_LIST: "" }).join(), /vacía/);
});

test("F73 · la cabeza se informa por ESTADO REAL: sin las tablas de 0059 → cabeza 0058 y readiness «degraded» (nunca 0059 por decreto)", async () => {
  const base = fakeSb() as unknown as { from: (t: string) => unknown };
  const missing = { ...base, from: (t: string) => (t === "craft_recipes" || t === "mission_events"
    ? { select: () => Promise.resolve({ data: null, error: { code: "42P01", message: `relation "public.${t}" does not exist` } }) }
    : base.from(t)) } as unknown as import("@supabase/supabase-js").SupabaseClient;
  const r = await readiness(missing, { cards: 331 }, GOOD, statusFetch(401));
  assert.equal(r.migrationHead, "0058_hardening_grants");
  assert.equal(r.checks.find((c) => c.id === "crafting")?.ok, false);
  assert.equal(r.checks.find((c) => c.id === "crafting")?.detail, "0059 no aplicada");
  assert.equal(r.status, "degraded");
});

test("F79.2 · cabeza REAL desde el estado de la BD: cada hito por su huella; estados a medias = «inconsistente», nunca una cabeza", async () => {
  const { headFromDbState, parseMigrationState } = await import("./release");
  const s = (o: Partial<import("./release").DbMigrationState> = {}) => ({ craftTables0059: true, salvageLastCopy0060: true, forgeConfig0061: true, guardedRpcs0061: true, craftCardUnlocked0061: true, ...o });
  assert.equal(headFromDbState(s()), "0061_forge_progression");
  assert.equal(headFromDbState(s({ forgeConfig0061: false, guardedRpcs0061: false, craftCardUnlocked0061: false })), "0060_salvage_last_copy_atomic", "producción ANTES de F79.1");
  assert.equal(headFromDbState(s({ salvageLastCopy0060: false, forgeConfig0061: false, guardedRpcs0061: false, craftCardUnlocked0061: false })), "0059_crafting_missions");
  assert.equal(headFromDbState({ craftTables0059: false, salvageLastCopy0060: false, forgeConfig0061: false, guardedRpcs0061: false, craftCardUnlocked0061: false }), "0058_hardening_grants");
  for (const half of [{ guardedRpcs0061: false }, { forgeConfig0061: false }, { craftCardUnlocked0061: false }]) assert.equal(headFromDbState(s(half)), "inconsistente", JSON.stringify(half));
  assert.equal(headFromDbState(s({ salvageLastCopy0060: false })), "inconsistente", "0061 sin 0060 no es ninguna cabeza");
  // La salida del script: solo «=t» cuenta; cualquier otra cosa (error, vacío, f) es false.
  const out = "CRAFT_TABLES_0059=t\nSALVAGE_LAST_COPY_0060=t\nFORGE_CONFIG_0061=t\nGUARDED_RPCS_0061=t\nCRAFT_CARD_UNLOCKED_0061=t\n";
  assert.equal(headFromDbState(parseMigrationState(out)), "0061_forge_progression");
  assert.equal(headFromDbState(parseMigrationState(out.replace("GUARDED_RPCS_0061=t", "GUARDED_RPCS_0061=ERROR"))), "inconsistente");
  assert.equal(headFromDbState(parseMigrationState("")), "0058_hardening_grants");
  // F82 · 0062: tabla + RPC; a medias = inconsistente; 0062 sin 0061 completa = inconsistente.
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true })), "0062_collection_sets");
  // F89 · 0063: la columna + su RPC; sin 0062 completa = inconsistente.
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, favoriteTeam0063: true })), "0063_profile_favorite_team");
  // F83 · 0064 sobre 0063; sin 0063 = inconsistente.
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, favoriteTeam0063: true, seasonTrack0064: true })), "0064_season_track");
  // F84 · 0065 sobre 0064; sin 0064 = inconsistente.
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, favoriteTeam0063: true, seasonTrack0064: true, ranked0065: true })), "0065_ranked_competitive");
  // F85 · 0066 sobre 0065; sin 0065 = inconsistente.
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, favoriteTeam0063: true, seasonTrack0064: true, ranked0065: true, social0066: true })), "0066_social_2");
  // 0067 sobre 0066; sin 0066 = inconsistente.
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, favoriteTeam0063: true, seasonTrack0064: true, ranked0065: true, social0066: true, admin0067: true })), "0067_admin_management");
  // 0068 sobre 0067; sin 0067 = inconsistente.
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, favoriteTeam0063: true, seasonTrack0064: true, ranked0065: true, social0066: true, admin0067: true, accountTag0068: true })), "0068_public_account_tag");
  // F86 · 0069 sobre 0068; sin 0068 = inconsistente.
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, favoriteTeam0063: true, seasonTrack0064: true, ranked0065: true, social0066: true, admin0067: true, accountTag0068: true, cups0069: true })), "0069_player_cups");
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, favoriteTeam0063: true, seasonTrack0064: true, ranked0065: true, social0066: true, admin0067: true, cups0069: true })), "inconsistente");
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, favoriteTeam0063: true, seasonTrack0064: true, ranked0065: true, social0066: true, accountTag0068: true })), "inconsistente");
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, favoriteTeam0063: true, seasonTrack0064: true, ranked0065: true, admin0067: true })), "inconsistente");
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, favoriteTeam0063: true, seasonTrack0064: true, social0066: true })), "inconsistente");
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, favoriteTeam0063: true, ranked0065: true })), "inconsistente");
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, seasonTrack0064: true })), "inconsistente");
  assert.equal(headFromDbState(s({ favoriteTeam0063: true })), "inconsistente");
  assert.equal(headFromDbState(s({ collectionSets0062: true, favoriteTeam0063: true })), "inconsistente");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\n")), "0063_profile_favorite_team");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\nSEASON_TRACK_0064=t\n")), "0064_season_track");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\nSEASON_TRACK_0064=t\nRANKED_0065=t\n")), "0065_ranked_competitive");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\nSEASON_TRACK_0064=t\nRANKED_0065=t\nSOCIAL_0066=t\n")), "0066_social_2");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\nSEASON_TRACK_0064=t\nRANKED_0065=t\nSOCIAL_0066=t\nADMIN_0067=t\n")), "0067_admin_management");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\nSEASON_TRACK_0064=t\nRANKED_0065=t\nSOCIAL_0066=t\nADMIN_0067=t\nACCOUNT_TAG_0068=t\n")), "0068_public_account_tag");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\nSEASON_TRACK_0064=t\nRANKED_0065=t\nSOCIAL_0066=t\nADMIN_0067=t\nACCOUNT_TAG_0068=t\nCUPS_0069=t\n")), "0069_player_cups");
  // F86.2 · 0070 sobre 0069; 0070 sin 0069 = inconsistente.
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\nSEASON_TRACK_0064=t\nRANKED_0065=t\nSOCIAL_0066=t\nADMIN_0067=t\nACCOUNT_TAG_0068=t\nCUPS_0069=t\nALPHA_0070=t\n")), "0070_alpha_feedback");
  // F87 · con 0071 la cabeza es 0071; 0071 sin 0070 es inconsistente (nunca se adivina).
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\nSEASON_TRACK_0064=t\nRANKED_0065=t\nSOCIAL_0066=t\nADMIN_0067=t\nACCOUNT_TAG_0068=t\nCUPS_0069=t\nALPHA_0070=t\nPICKEMS_0071=t\n")), "0071_pickems_bracket");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\nSEASON_TRACK_0064=t\nRANKED_0065=t\nSOCIAL_0066=t\nADMIN_0067=t\nACCOUNT_TAG_0068=t\nCUPS_0069=t\nALPHA_0070=t\nPICKEMS_0071=t\nCUTOVER_0072=t\n")), "0072_pickems_reward_cutover");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\nSEASON_TRACK_0064=t\nRANKED_0065=t\nSOCIAL_0066=t\nADMIN_0067=t\nACCOUNT_TAG_0068=t\nCUPS_0069=t\nALPHA_0070=t\nPICKEMS_0071=t\nCUTOVER_0072=t\nGUARD_0073=t\n")), "0073_pickems_launch_guard");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\nSEASON_TRACK_0064=t\nRANKED_0065=t\nSOCIAL_0066=t\nADMIN_0067=t\nACCOUNT_TAG_0068=t\nCUPS_0069=t\nALPHA_0070=t\nPICKEMS_0071=t\nGUARD_0073=t\n")), "inconsistente");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\nSEASON_TRACK_0064=t\nRANKED_0065=t\nSOCIAL_0066=t\nADMIN_0067=t\nACCOUNT_TAG_0068=t\nCUPS_0069=t\nALPHA_0070=t\nCUTOVER_0072=t\n")), "inconsistente");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\nFAVORITE_TEAM_0063=t\nSEASON_TRACK_0064=t\nRANKED_0065=t\nSOCIAL_0066=t\nADMIN_0067=t\nACCOUNT_TAG_0068=t\nCUPS_0069=t\nPICKEMS_0071=t\n")), "inconsistente");
  assert.equal(headFromDbState(s({ collectionSets0062: true, collectionClaim0062: true, favoriteTeam0063: true, seasonTrack0064: true, ranked0065: true, social0066: true, admin0067: true, accountTag0068: true, alpha0070: true })), "inconsistente");
  assert.equal(headFromDbState(s({ collectionSets0062: true })), "inconsistente");
  assert.equal(headFromDbState(s({ collectionClaim0062: true })), "inconsistente");
  assert.equal(headFromDbState(s({ forgeConfig0061: false, collectionSets0062: true, collectionClaim0062: true })), "inconsistente");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=t\n")), "0062_collection_sets");
  assert.equal(headFromDbState(parseMigrationState(out + "COLLECTION_SETS_0062=t\nCOLLECTION_CLAIM_0062=f\n")), "inconsistente");
});

test("F79.2 · production:check compara la cabeza que INFORMA la app y la REAL de la BD con la esperada (sin PASS fijo)", () => {
  const src = readFileSync(`${process.cwd()}/scripts/ops/production-check.ts`, "utf8");
  assert.match(src, /add\("app-migration-head", appHead === MIGRATION_HEAD \? "PASS" : "FAIL"/);
  assert.match(src, /add\("db-migration-head", dbHead === MIGRATION_HEAD \? "PASS" : "FAIL"/);
  assert.match(src, /add\("app-vs-db-head", appHead === dbHead \? "PASS" : "FAIL"/);
  const sh = readFileSync(`${process.cwd()}/scripts/ops/migration-state.sh`, "utf8");
  assert.match(sh, /default_transaction_read_only=on/, "solo lectura");
});
