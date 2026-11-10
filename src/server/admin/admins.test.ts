/**
 * 0067 · GESTIÓN DE ADMINISTRADORES — `/api/admin/admins` con el verificador real sustituido (como el resto del panel) y
 * `MemSupabase` con el espejo de `app_admin_set_admin`. Lo que NO se puede probar aquí (guardia de escritura en la BD,
 * suelo, carreras con cerrojo real, RLS) se prueba sobre Postgres real en `scripts/ops/_admin-dryrun.sh` y en producción.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MemSupabase } from "@/server/services/testing/memSupabase";
import type { AdminDeps } from "./http";
import { adminsHandlers, normalizeAdminQuery } from "./admins";
import { ADMIN_SECTIONS } from "@/domain/admin/nav";

const ADMIN = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-000000000011";
const OTHER = "00000000-0000-4000-8000-000000000022";
const BANNED = "00000000-0000-4000-8000-000000000033";
const GHOST = "00000000-0000-4000-8000-0000000000ff";
/** 0068 · tags QA SYNTHETIC (formato canónico). La confirmación de alta/baja de admin se hace con ellos, no con el nombre. */
const TAGS: Record<string, string> = { [ADMIN]: "ADM7NAA", [USER]: "USR2KQB", [OTHER]: "XTH3RZZ", [BANNED]: "BNN9DDD" };
const T = (id: string) => `#${TAGS[id]}`;

function world(admins: string[] = [ADMIN]) {
  const db = new MemSupabase();
  for (const id of [ADMIN, USER, OTHER, BANNED]) db.seedUser(id, 1000);
  for (const p of db.table("profiles")) { p.username = `qa_${String(p.id).slice(-2)}`; p.avatar = "🎮"; p.is_admin = admins.includes(String(p.id)); p.email = `${p.username}@secret.test`; p.public_tag = TAGS[String(p.id)]; }
  db.table("user_sanctions").push({ id: "s1", user_id: BANNED, type: "ban", reason: "sanción de prueba", created_at: new Date().toISOString(), created_by: ADMIN, expires_at: null, revoked_at: null });
  // El verificador real lee `profiles.is_admin` EN CADA PETICIÓN: aquí igual (un admin revocado deja de pasar al instante).
  const deps: AdminDeps = {
    verify: async (req) => {
      const id = req.headers.get("authorization")?.replace(/^Bearer tok-/, "") ?? "";
      return db.table("profiles").some((p) => p.id === id && p.is_admin) ? { userId: id } : null;
    },
    db: () => db.client,
  };
  const h = adminsHandlers(deps);
  const auth = (who: string | null): Record<string, string> => (who ? { authorization: `Bearer tok-${who}` } : {});
  const get = (who: string | null, q = "") => h.GET(new Request(`http://t/api/admin/admins${q}`, { headers: auth(who) }));
  const post = (who: string | null, body: unknown, headers: Record<string, string> = {}) =>
    h.POST(new Request("http://t/api/admin/admins", { method: "POST", headers: { ...auth(who), "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const isAdmin = (id: string) => db.table("profiles").some((p) => p.id === id && p.is_admin);
  const audits = () => db.table("content_audit_log").filter((a) => a.action === "GRANT_ADMIN" || a.action === "REVOKE_ADMIN");
  return { db, get, post, isAdmin, audits };
}
const grant = (userId: string, confirm: string) => ({ action: "grant", userId, confirm });
const revoke = (userId: string, confirm: string) => ({ action: "revoke", userId, confirm });

test("ADM-1 · anónimo y usuario normal: 401 idéntico en lectura, búsqueda y escritura; el admin pasa", async () => {
  const w = world();
  for (const who of [null, USER]) {
    assert.equal((await w.get(who)).status, 401);
    assert.equal((await w.get(who, "?q=qa")).status, 401);
    assert.equal((await w.post(who, grant(USER, T(USER)))).status, 401, "un usuario normal no se da admin a sí mismo");
    assert.equal((await w.post(who, grant(OTHER, T(OTHER)))).status, 401);
  }
  assert.equal(w.isAdmin(USER), false);
  assert.equal((await w.get(ADMIN)).status, 200);
});

test("ADM-2 · sesión manipulada: token inventado, Bearer vacío, cabeceras de identidad y campos extra no sirven", async () => {
  const w = world();
  assert.equal((await w.post(null, grant(USER, T(USER)), { authorization: "Bearer tok-" })).status, 401);
  assert.equal((await w.post(null, grant(USER, T(USER)), { authorization: "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9." })).status, 401);
  assert.equal((await w.post(USER, grant(USER, T(USER)), { "x-user-id": ADMIN, "x-is-admin": "true" })).status, 401);
  // Un admin real tampoco puede colar campos: el actor sale del token, nunca del cuerpo (mass assignment → 400).
  for (const extra of [{ is_admin: true }, { actor: USER }, { p_actor: USER }, { role: "admin" }]) {
    const r = await w.post(ADMIN, { ...grant(OTHER, T(OTHER)), ...extra });
    assert.equal(r.status, 400, JSON.stringify(extra));
  }
  assert.equal(w.isAdmin(OTHER), false);
  assert.equal(w.audits().length, 0);
});

test("ADM-3 · conceder: confirmación = TAG EXACTO (0068; lo compara el servidor); el NOMBRE ya no confirma; auditoría con actor, afectado, tag y hora", async () => {
  const w = world();
  assert.equal((await w.post(ADMIN, grant(OTHER, "qa_22"))).status, 400, "el nombre ya no confirma: puede cambiar, el tag no");
  assert.equal((await w.post(ADMIN, grant(OTHER, "#XTH3RZA"))).status, 400, "un tag casi igual no confirma");
  assert.equal((await w.post(ADMIN, grant(OTHER, T(USER)))).status, 400, "el tag de OTRA cuenta no confirma");
  assert.equal((await w.post(ADMIN, { action: "grant", userId: OTHER })).status, 400, "sin confirmación no hay cambio");
  assert.equal(w.isAdmin(OTHER), false);
  const r = await w.post(ADMIN, { ...grant(OTHER, T(OTHER)), reason: "nuevo moderador" });
  assert.equal(r.status, 200);
  const b = await r.json() as Record<string, unknown>;
  assert.equal(b.code, "GRANTED"); assert.equal(b.admins, 2);
  assert.equal(w.isAdmin(OTHER), true);
  const a = w.audits().at(-1)!;
  assert.equal(a.action, "GRANT_ADMIN"); assert.equal(a.actor, ADMIN); assert.equal(a.entity_id, OTHER); assert.ok(a.at);
  assert.deepEqual({ name: (a.detail as Record<string, unknown>).target_username, tag: (a.detail as Record<string, unknown>).target_tag, reason: (a.detail as Record<string, unknown>).reason }, { name: "qa_22", tag: "XTH3RZZ", reason: "nuevo moderador" });
  assert.equal(a.entity_id, OTHER, "la identidad técnica de la auditoría sigue siendo el id interno; el tag es contexto humano");
  // El nuevo admin entra al instante (el verificador relee is_admin).
  assert.equal((await w.get(OTHER)).status, 200);
});

test("ADM-4 · doble clic / dos pestañas: 10 concesiones a la vez → UN cambio y UNA auditoría; el resto ALREADY_ADMIN", async () => {
  const w = world();
  const rs = await Promise.all(Array.from({ length: 10 }, () => w.post(ADMIN, grant(OTHER, T(OTHER)))));
  const codes = await Promise.all(rs.map(async (r) => (await r.json() as Record<string, unknown>).code));
  assert.equal(codes.filter((c) => c === "GRANTED").length, 1);
  assert.equal(codes.filter((c) => c === "ALREADY_ADMIN").length, 9);
  assert.equal(w.audits().length, 1);
});

test("ADM-5 · quitar: REVOKE_ADMIN auditado; el revocado deja de entrar en su siguiente petición", async () => {
  const w = world([ADMIN, OTHER]);
  assert.equal((await w.get(OTHER)).status, 200);
  const r = await w.post(ADMIN, revoke(OTHER, T(OTHER)));
  assert.equal((await r.json() as Record<string, unknown>).code, "REVOKED");
  assert.equal(w.audits().at(-1)!.action, "REVOKE_ADMIN");
  assert.equal((await w.get(OTHER)).status, 401, "revocado = fuera del panel");
  assert.equal((await w.post(OTHER, grant(OTHER, T(OTHER)))).status, 401, "y no puede volver a dárselo");
  assert.equal(((await (await w.post(ADMIN, revoke(OTHER, T(OTHER)))).json()) as Record<string, unknown>).code, "ALREADY_NOT_ADMIN", "repetir no escribe");
  assert.equal(w.audits().length, 1);
});

test("ADM-6 · ÚLTIMO ADMIN: no se puede quitar (tampoco a uno mismo); con otro admin, la autorretirada sí", async () => {
  const w = world([ADMIN]);
  const last = await w.post(ADMIN, revoke(ADMIN, T(ADMIN)));
  assert.equal(last.status, 409);
  assert.match(String((await last.json() as Record<string, unknown>).error), /ningún administrador/);
  assert.equal(w.isAdmin(ADMIN), true);
  await w.post(ADMIN, grant(OTHER, T(OTHER)));
  const self = await w.post(ADMIN, revoke(ADMIN, T(ADMIN)));
  assert.equal((await self.json() as Record<string, unknown>).code, "REVOKED");
  assert.equal((w.audits().at(-1)!.detail as Record<string, unknown>).self, true);
  // Ahora OTHER es el último: tampoco puede irse.
  assert.equal((await w.post(OTHER, revoke(OTHER, T(OTHER)))).status, 409);
});

test("ADM-7 · IDOR y entradas inválidas: inexistente 404, id no válido 400, acción desconocida 400, cuenta sancionada 409", async () => {
  const w = world();
  assert.equal((await w.post(ADMIN, grant(GHOST, "nadie"))).status, 404);
  assert.equal((await w.post(ADMIN, grant("no-es-un-uuid", "x"))).status, 400);
  assert.equal((await w.post(ADMIN, { action: "promote", userId: OTHER, confirm: T(OTHER) })).status, 400);
  assert.equal((await w.post(ADMIN, { action: "grant", userId: OTHER, confirm: T(OTHER), reason: "x".repeat(301) })).status, 400);
  assert.equal((await w.post(ADMIN, grant(BANNED, T(BANNED)))).status, 409);
  assert.equal(w.audits().length, 0);
});

test("ADM-8 · búsqueda por nombre público: sin correo, sin comodines, sin «@», mínimo 2 letras", async () => {
  const w = world();
  const r = await w.get(ADMIN, "?q=qa_");
  assert.equal(r.status, 200);
  const raw = await r.text();
  assert.ok(!/@secret\.test|email/i.test(raw), "nunca sale el correo");
  const b = JSON.parse(raw) as { accounts: { username: string; isAdmin: boolean }[] };
  assert.ok(b.accounts.some((a) => a.username === "qa_aa" && a.isAdmin) && b.accounts.some((a) => a.username === "qa_11" && !a.isAdmin));
  assert.equal((await w.get(ADMIN, "?q=a")).status, 400);
  assert.equal((await w.get(ADMIN, `?q=${encodeURIComponent("qa@secret.test")}`)).status, 400, "no se busca por correo");
  assert.equal(normalizeAdminQuery("%%"), null);
  assert.equal(normalizeAdminQuery(" qa_1 "), "qa_1");
  const list = await (await w.get(ADMIN)).text();
  assert.ok(!/@secret\.test|email/i.test(list), "la lista de admins tampoco lleva correo");
});

test("ADM-9 · TODAS las rutas /api/admin/* están protegidas en servidor (runAdmin o verifyAdmin en cada método)", () => {
  const root = join(process.cwd(), "src", "app", "api", "admin");
  const routes: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === "route.ts") routes.push(p); } };
  walk(root);
  assert.ok(routes.length >= 29);
  for (const p of routes) {
    const src = readFileSync(p, "utf8");
    const viaHandlers = /Handlers\(DEFAULT_DEPS\)/.test(src);
    if (viaHandlers) continue;
    const methods = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]);
    assert.ok(methods.length > 0, p);
    for (const m of methods) {
      const body = src.slice(src.indexOf(`export async function ${m}(`)).split(/\nexport /)[0];
      assert.ok(/verifyAdmin\(|requireAdmin\(|runAdmin\(/.test(body), `${p} ${m} sin verificación de admin`);
    }
  }
});

test("ADM-10 · la escritura de is_admin SOLO va por la RPC: ningún código hace update de is_admin; 0067 pone guardia y suelo", () => {
  const offenders: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f) && !/\.test\.|testing/.test(p)) { const s = readFileSync(p, "utf8"); if (/\.update\(\{[^}]*is_admin/.test(s) || /\.(insert|upsert)\(\{[^}]*is_admin\s*:\s*true/.test(s)) offenders.push(p); } } };
  walk(join(process.cwd(), "src"));
  assert.deepEqual(offenders, []);
  const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "0067_admin_management.sql"), "utf8");
  assert.ok(sql.includes("before insert or update of is_admin on public.profiles"));
  assert.ok(sql.includes("current_setting('drl.admin_writer', true)"));
  assert.ok(sql.includes("raise exception 'LAST_ADMIN"));
  assert.ok(sql.includes("pg_advisory_xact_lock(hashtext('drl:admin_roster'))"));
  assert.ok(sql.includes("revoke all on function public.app_admin_set_admin(uuid, uuid, boolean, text) from public, anon, authenticated;"));
  assert.ok(ADMIN_SECTIONS.some((s) => s.href === "/admin/admins"));
});

test("ADM-11 · la página: confirmación escribiendo el TAG exacto (cuenta + tag en el diálogo) y cerrojo SÍNCRONO contra el doble clic", () => {
  const page = readFileSync(join(process.cwd(), "src", "app", "admin", "admins", "page.tsx"), "utf8");
  assert.ok(page.includes("typeToConfirm={pending ? confirmText(pending.account) : undefined}") && page.includes("const confirmText = (a: Account): string => (a.tag ? `#${a.tag}` : a.username);"), "el diálogo exige escribir el #TAG");
  assert.ok(page.includes("confirm: confirmText(pending.account)"), "y el servidor lo vuelve a comparar");
  assert.ok(page.includes('data-testid="confirm-account"'), "el diálogo enseña Cuenta y Tag");
  assert.ok(page.includes("if (!pending || busy || inFlight.current) return;") && page.includes("inFlight.current = true;") && page.includes("finally { inFlight.current = false;"), "dos clics en el mismo fotograma = una petición");
  assert.ok(!/email/i.test(page), "la página no pide ni pinta correos");
});

test("ADM-12 · #TAG: búsqueda EXACTA (minúsculas normalizadas, sin difuso), tag en resultados y lista; confirmar con el tag en minúsculas también vale", async () => {
  const w = world();
  const exact = await (await w.get(ADMIN, `?q=${encodeURIComponent("#xth3rzz")}`)).json() as { query: string; accounts: { username: string; tag: string }[] };
  assert.equal(exact.query, "#XTH3RZZ");
  assert.deepEqual(exact.accounts.map((a) => [a.username, a.tag]), [["qa_22", "XTH3RZZ"]]);
  const partial = await (await w.get(ADMIN, `?q=${encodeURIComponent("#XTH3")}`)).json() as { error?: string };
  assert.ok(partial.error, "un tag incompleto no es una búsqueda por prefijo: 400");
  assert.equal((await w.get(ADMIN, `?q=${encodeURIComponent("#ZZZZZZZ")}`)).status, 200);
  assert.deepEqual(((await (await w.get(ADMIN, `?q=${encodeURIComponent("#ZZZZZZZ")}`)).json()) as { accounts: unknown[] }).accounts, [], "tag sin cuenta: vacío");
  assert.equal((await w.get(ADMIN, `?q=${encodeURIComponent("#0OIL0OI")}`)).status, 400, "símbolos ambiguos (0/O/1/I/L) no forman un tag");
  const list = await (await w.get(ADMIN)).json() as { admins: { tag: string }[] };
  assert.deepEqual(list.admins.map((a) => a.tag), ["ADM7NAA"]);
  const r = await w.post(ADMIN, grant(OTHER, "#xth3rzz"));
  assert.equal(((await r.json()) as { code: string }).code, "GRANTED", "el servidor normaliza mayúsculas y «#»");
  // La búsqueda por tag sigue tras runAdmin: un usuario normal recibe 401.
  assert.equal((await w.get(USER, `?q=${encodeURIComponent("#XTH3RZZ")}`)).status, 401);
});
