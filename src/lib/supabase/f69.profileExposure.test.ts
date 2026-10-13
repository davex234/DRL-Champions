/**
 * FASE 69 · EXPOSICIÓN DE `profiles` (contrato de perfil público + 0058 v3). El navegador ya no lee columnas privadas
 * de `profiles` por REST: el perfil propio llega por `GET /api/game/me` (service_role, filtrado por el Bearer). Así la
 * migración 0058 puede dejar a `authenticated` solo las columnas públicas sin romper la interfaz, y la lista de la
 * migración es la MISMA que la del código.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AUTHENTICATED_PROFILE_COLUMNS, OWN_PROFILE_COLUMNS, PRIVATE_PROFILE_COLUMNS } from "./profileExposure";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(join(ROOT, dir))) {
    const p = `${dir}/${n}`;
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
/** Código que corre en el NAVEGADOR con el rol `authenticated` (el servidor usa service_role). */
const CLIENT_DIRS = ["src/lib/supabase", "src/lib/game", "src/app", "src/components", "src/store", "src/lib"];

test("F69 · contrato: lo público y lo privado no se solapan; el perfil propio no incluye internos", () => {
  for (const c of AUTHENTICATED_PROFILE_COLUMNS) assert.ok(!(PRIVATE_PROFILE_COLUMNS as readonly string[]).includes(c), c);
  for (const c of ["credits", "xp", "is_admin", "last_seen_at", "equipped"]) assert.ok((PRIVATE_PROFILE_COLUMNS as readonly string[]).includes(c), c);
  for (const c of ["last_seen_at", "equipped", "taxes_paid", "tokens"]) assert.ok(!(OWN_PROFILE_COLUMNS as readonly string[]).includes(c), `el perfil propio no expone ${c}`);
});

test("F69 · ningún código de cliente lee `profiles` por REST salvo columnas públicas (select explícito, nunca *)", () => {
  const files = [...new Set(CLIENT_DIRS.flatMap((d) => walk(d)))].filter((f) => !f.startsWith("src/app/api/") && !f.startsWith("src/server/"));
  const offenders: string[] = [];
  for (const f of files) {
    const s = code(read(f));
    if (/getSupabaseAdmin\(\)/.test(s)) continue; // servidor con service_role (p. ej. verifyAdmin)
    for (const m of s.matchAll(/\.from\("profiles"\)\s*\.select\(\s*"([^"]*)"/g)) {
      const cols = m[1].split(",").map((x) => x.trim()).filter(Boolean);
      if (cols.some((c) => c === "*" || !(AUTHENTICATED_PROFILE_COLUMNS as readonly string[]).includes(c))) offenders.push(`${f}: select("${m[1]}")`);
    }
  }
  assert.deepEqual(offenders, [], "lecturas privadas de profiles desde el navegador");
});

test("F69 · auth.tsx y el acceso de admin leen el perfil propio por /api/game/me (una lectura compartida)", () => {
  const auth = code(read("src/lib/supabase/auth.tsx"));
  assert.ok(!/from\("profiles"\)\.select/.test(auth), "auth.tsx ya no lee profiles por REST");
  assert.match(auth, /fetchOwnProfile\(token, uid, force\)/);
  const admin = code(read("src/lib/supabase/useAdminSession.ts"));
  assert.ok(!/from\("profiles"\)/.test(admin));
  assert.match(admin, /fetchOwnProfile\(session\.access_token, session\.user\.id\)/);
  assert.match(admin, /fetch\("\/api\/admin\/session"/, "la autoridad sigue siendo el servidor");
  const own = code(read("src/lib/supabase/ownProfile.ts"));
  assert.match(own, /fetch\("\/api\/game\/me"/);
  assert.match(own, /Date\.now\(\) - cur\.at < 2_000/, "una lectura en vuelo se comparte");
  assert.match(own, /body\.profile\.id === uid/, "en plena transición de cuenta no se pinta la fila de otro");
});

test("F69 · GET /api/game/me: userId del Bearer, columnas del contrato, 401 sin sesión, sin parámetros, error neutro", () => {
  const r = code(read("src/app/api/game/me/route.ts"));
  assert.match(r, /const session = await getSession\(req\);/);
  assert.match(r, /status: 401/);
  assert.match(r, /select\(OWN_PROFILE_COLUMNS\.join\(", "\)\)\.eq\("id", session\.userId\)/);
  assert.match(r, /internalError\("api\/game\/me", e, req\)/);
  assert.match(r, /\[\.\.\.q\.keys\(\)\]\.length > 0/);
  assert.ok(!/searchParams\.get\(/.test(r), "ningún id por parámetro");
});

test("F69 · 0058 v3 concede a authenticated EXACTAMENTE las columnas públicas del contrato y la guardia lo comprueba", () => {
  const sql = read("docs/operations/proposals/0058_hardening_grants.PROPOSAL.sql");
  const m = sql.match(/grant select \(([^)]+)\) on public\.profiles to authenticated;/);
  assert.ok(m, "grant de columnas");
  assert.deepEqual(m![1].split(",").map((x) => x.trim()), [...AUTHENTICATED_PROFILE_COLUMNS]);
  assert.match(sql, /revoke select, references, trigger on public\.profiles from authenticated;/);
  assert.match(sql, /revoke all on public\.profiles from anon;/);
  for (const c of ["credits", "is_admin", "last_seen_at"]) assert.match(sql, new RegExp(`has_column_privilege\\('authenticated', 'public\\.profiles', '${c}', 'SELECT'\\) then raise exception`));
  assert.match(sql, /^begin;[\s\S]*^commit;/m, "una sola transacción");
  const back = read("docs/operations/proposals/0058_hardening_grants.ROLLBACK.sql");
  assert.match(back, /grant select, insert, delete, truncate, references, trigger on public\.profiles to authenticated;/, "el rollback devuelve el SELECT de tabla");
});

test("PRE-F70 · 0058 APLICADA (autorizada, 2026-09-28): la migración canónica es BYTE A BYTE la v3 validada y es la cabeza", () => {
  const ms = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
  // F73 añade 0059 (crafteo y misiones) y 0060 (desguace atómico, última copia): AUTORIZADAS y APLICADAS el 2026-09-30.
  assert.equal(ms[ms.length - 1], "0074_collection_scale.sql"); // COLECCIONES ILIMITADAS · 0074 (índices de cursor y resumen por carta; aditiva y opcional: el servidor funciona igual sin ella) es la última; antes F87.2 · 0073 (launch guard de Pick'ems: elegibilidad y puerta de tiempo) es la última; antes F87.1 · 0072, F87 · 0071 (Pick'ems 2.0: cuadros de predicción, cierre por partido, liquidación y reclamos; aditiva) es la última; antes F86.2 · 0070 (feedback de la Closed Alpha + embudo derivado) es la última; antes F86 · 0069 (torneos de jugadores) es la última del repositorio (cabeza = 0069; 0068 tag público de cuenta; 0067 gestión de admins, F85 añadió 0066, F84 añadió 0065, F83 0064, ops/release). F82 añadió 0062 y F89 0063.
  assert.equal(ms.filter((f) => f.startsWith("0058")).length, 1, "una sola 0058 (ni v2 ni 0059)");
  const applied = readFileSync(join(ROOT, "supabase/migrations/0058_hardening_grants.sql"));
  const validated = readFileSync(join(ROOT, "docs/operations/proposals/0058_hardening_grants.PROPOSAL.sql"));
  assert.ok(applied.equals(validated), "lo aplicado = lo validado en el dry-run");
  assert.equal(createHash("sha256").update(applied).digest("hex"), "ad5f9e5a911fe0a2aa43ddedd07cd5978b294f5065a5b3350da1db95106bc26c");
});

test("F69 → F85 · la hora EXACTA de conexión no sale nunca; la presencia (gruesa) solo la ven los amigos", () => {
  const s = code(read("src/server/services/social.ts"));
  // F85 endurece F69: ni siquiera los amigos reciben la hora («sin visto hace…»).
  assert.match(s, /lastSeenAt: null,/);
  // Solo el mapa INTERNO de perfiles (servidor) conoce la hora; ninguna vista exportada la copia.
  assert.equal((s.match(/lastSeenAt: msOrNull\(/g) ?? []).length, 1, "ninguna vista publica la hora del latido");
  assert.ok(!/lastSeenAt: p\.lastSeenAt/.test(s));
  assert.match(s, /presence: relation === "FRIENDS" \|\| relation === "SELF"/);
  // 0068 · el resultado añade SOLO el tag público (sin hora, sin correo, sin nada privado).
  assert.match(s, /export interface SearchHit extends SocialPlayer, SocialBadges \{ relation: RelationState; presence: Presence \| null; rating: RatingSummary \| null; tag: string \| null \}/);
});
