/**
 * F58 · ADMIN CONTROL CENTER — autorización, validación y comportamiento de las rutas `/api/admin/*` nuevas.
 *
 * Verificador falso: `Bearer admin-token` ⇒ admin · `Bearer user-token` ⇒ usuario normal (verifyAdmin devuelve null,
 * como en producción) · sin cabecera ⇒ anónimo. BD = `MemSupabase` con las RPC de 0055 reproducidas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MemSupabase } from "@/server/services/testing/memSupabase";
import type { AdminDeps } from "./http";
import { auditHandlers, catalogHandlers, dashboardHandlers, eventsHandlers, moderationHandlers, packsHandlers, searchHandlers, systemHandlers, usersHandlers } from "./handlers";
import { activeSanctionFor, invalidateSanctionCache } from "@/server/services/sanctionGate";
import { isGatedRequest, parseSanctionInput, sanctionStatus } from "@/domain/admin/sanctions";
import { parseCreditAdjust, previewAdjust } from "@/domain/admin/credits";
import { parseEventDraft, draftState } from "@/domain/admin/events";
import { redactSecrets, REDACTED } from "@/domain/admin/redact";
import { economyHealth, whatIf } from "@/domain/admin/packAdmin";
import { getPack } from "@/data/packs";

const ADMIN = "00000000-0000-4000-8000-00000000000a";
const OTHER_ADMIN = "00000000-0000-4000-8000-00000000000b";
const USER = "00000000-0000-4000-8000-000000000001";
const VICTIM = "00000000-0000-4000-8000-000000000002";

function world() {
  const db = new MemSupabase();
  db.seedUser(ADMIN, 1000); db.seedUser(OTHER_ADMIN, 1000); db.seedUser(USER, 5000); db.seedUser(VICTIM, 2500);
  for (const p of db.table("profiles")) { p.username = `u_${String(p.id).slice(-2)}`; p.is_admin = p.id === ADMIN || p.id === OTHER_ADMIN; p.email = `${p.username}@test.local`; }
  const deps: AdminDeps = {
    verify: async (req) => (req.headers.get("authorization") === "Bearer admin-token" ? { userId: ADMIN } : null),
    db: () => db.client,
  };
  return { db, deps };
}
const H = (who: "anon" | "user" | "admin"): Record<string, string> =>
  who === "anon" ? {} : { authorization: `Bearer ${who === "admin" ? "admin-token" : "user-token"}` };
const get = (path: string, who: "anon" | "user" | "admin") => new Request(`http://t${path}`, { headers: H(who) });
const post = (path: string, who: "anon" | "user" | "admin", body: unknown) =>
  new Request(`http://t${path}`, { method: "POST", headers: { ...H(who), "content-type": "application/json" }, body: JSON.stringify(body) });
const body = async (r: Response) => r.json() as Promise<Record<string, unknown>>;

/* ───────────── AUTORIZACIÓN: anónimo y usuario normal NUNCA pasan ───────────── */
test("AUTH · anónimo y usuario normal reciben 401 en TODAS las rutas (lectura y escritura); admin pasa", async () => {
  const { db, deps } = world();
  const gets: [string, (r: Request) => Promise<Response>][] = [
    ["/api/admin/dashboard", dashboardHandlers(deps).GET], ["/api/admin/search?q=ab", searchHandlers(deps).GET],
    ["/api/admin/users", usersHandlers(deps).GET], [`/api/admin/users?id=${VICTIM}`, usersHandlers(deps).GET],
    ["/api/admin/moderation", moderationHandlers(deps).GET], ["/api/admin/events", eventsHandlers(deps).GET],
    ["/api/admin/audit", auditHandlers(deps).GET], ["/api/admin/system", systemHandlers(deps).GET],
    ["/api/admin/catalog?view=teams", catalogHandlers(deps).GET], ["/api/admin/packs", packsHandlers(deps).GET],
  ];
  for (const [path, h] of gets) {
    for (const who of ["anon", "user"] as const) assert.equal((await h(get(path, who))).status, 401, `${who} ${path}`);
    assert.equal((await h(get(path, "admin"))).status, 200, `admin ${path}`);
  }
  const posts: [string, (r: Request) => Promise<Response>, unknown][] = [
    ["/api/admin/users", usersHandlers(deps).POST, { action: "adjust_credits", userId: VICTIM, direction: "add", amount: 100, reason: "compensación de prueba", expectedBalance: 2500, ref: "gesture-0001" }],
    ["/api/admin/users", usersHandlers(deps).POST, { action: "grant", userId: VICTIM, kind: "pack", packId: "estandar", count: 1, reason: "compensación de prueba", ref: "gesture-0002" }],
    ["/api/admin/moderation", moderationHandlers(deps).POST, { action: "sanction", userId: VICTIM, type: "ban", reason: "trampas reiteradas", hours: null }],
    ["/api/admin/events", eventsHandlers(deps).POST, { action: "create", name: "Evento", type: "masters", startsAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }],
    ["/api/admin/packs", packsHandlers(deps).POST, { action: "simulate", packId: "estandar", price: 1200, n: 500 }],
  ];
  const before = JSON.stringify(db.tables);
  for (const [path, h, b] of posts) for (const who of ["anon", "user"] as const) assert.equal((await h(post(path, who, b))).status, 401, `${who} POST ${path}`);
  assert.equal(JSON.stringify(db.tables), before, "ninguna petición denegada escribió nada");
});

test("AUTH · las rutas REALES usan verifyAdmin: sin token → 401 (sin configuración de servidor, fallo cerrado)", async () => {
  const dir = join(process.cwd(), "src/app/api/admin");
  const routes = ["dashboard", "search", "users", "moderation", "events", "audit", "system", "catalog", "packs"];
  for (const r of routes) {
    const src = readFileSync(join(dir, r, "route.ts"), "utf8");
    assert.match(src, /DEFAULT_DEPS/, `${r} monta las dependencias reales`);
    const mod = await import(`@/app/api/admin/${r}/route`);
    const res: Response = await mod.GET(get(`/api/admin/${r}`, "user"));
    assert.equal(res.status, 401, r);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/, `${r} no cacheable`);
  }
  // Y ninguna ruta de /api/admin/** queda sin verificación (F60: también las anidadas, p. ej. /api/admin/cms/*).
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : e.name === "route.ts" ? [join(d, e.name)] : []);
  const all = walk(dir);
  assert.ok(all.length >= routes.length + 6, "se recorren también las rutas anidadas");
  for (const f of all) {
    const src = readFileSync(f, "utf8");
    assert.ok(/verifyAdmin|DEFAULT_DEPS/.test(src), `${f} sin verificación de admin`);
  }
});

/* ───────────── IDOR / MASS ASSIGNMENT / VALIDACIÓN ───────────── */
test("IDOR · un usuario normal no obtiene la ficha de otro ni cambiando el id; el admin sí, sin secretos", async () => {
  const { deps } = world();
  const h = usersHandlers(deps).GET;
  assert.equal((await h(get(`/api/admin/users?id=${VICTIM}`, "user"))).status, 401);
  const ok = await h(get(`/api/admin/users?id=${VICTIM}`, "admin"));
  assert.equal(ok.status, 200);
  const txt = JSON.stringify(await body(ok));
  assert.ok(!/password|hash|refresh|token/i.test(txt), "sin secretos en la ficha");
  assert.equal((await h(get("/api/admin/users?id=../../etc", "admin"))).status, 400);
});

test("MASS ASSIGNMENT · un campo fuera de la lista blanca es 400 y no escribe (p. ej. actor o balance)", async () => {
  const { db, deps } = world();
  const before = JSON.stringify(db.tables);
  const r = await usersHandlers(deps).POST(post("/api/admin/users", "admin", { action: "adjust_credits", userId: VICTIM, direction: "add", amount: 10, reason: "compensación de prueba", expectedBalance: 2500, ref: "gesture-0003", actor: USER }));
  assert.equal(r.status, 400);
  const r2 = await moderationHandlers(deps).POST(post("/api/admin/moderation", "admin", { action: "sanction", userId: VICTIM, type: "ban", reason: "trampas reiteradas", created_by: USER }));
  assert.equal(r2.status, 400);
  assert.equal(JSON.stringify(db.tables), before);
});

test("VALIDACIÓN · sanción, créditos y evento se validan en servidor (no en el formulario)", () => {
  assert.equal(parseSanctionInput({ userId: VICTIM, type: "kill", reason: "motivo largo", hours: 1 }).ok, false);
  assert.equal(parseSanctionInput({ userId: VICTIM, type: "suspension", reason: "motivo largo", hours: null }).ok, false, "suspensión sin duración");
  assert.equal(parseSanctionInput({ userId: VICTIM, type: "ban", reason: "corto" }).ok, false);
  assert.equal(parseSanctionInput({ userId: "x' or 1=1", type: "ban", reason: "motivo largo" }).ok, false);
  assert.equal(parseSanctionInput({ userId: VICTIM, type: "ban", reason: "motivo largo", hours: 24 * 400 }).ok, false);
  assert.equal(parseCreditAdjust({ userId: VICTIM, direction: "add", amount: 1e9, reason: "motivo largo", expectedBalance: 0, ref: "gesture-0004" }).ok, false, "tope por operación");
  assert.equal(parseCreditAdjust({ userId: VICTIM, direction: "add", amount: -5, reason: "motivo largo", expectedBalance: 0, ref: "gesture-0004" }).ok, false);
  assert.equal(parseCreditAdjust({ userId: VICTIM, direction: "add", amount: 5, reason: "motivo largo", ref: "gesture-0004" }).ok, false, "sin saldo esperado");
  assert.deepEqual(previewAdjust(100, { direction: "remove", amount: 150 }), { before: 100, delta: -150, after: -50, ok: false });
  const now = Date.now();
  assert.equal(parseEventDraft({ name: "X", type: "masters", startsAt: new Date(now).toISOString(), endsAt: new Date(now + 3_600_000 * 2).toISOString() }, now).ok, false, "nombre corto");
  assert.equal(parseEventDraft({ name: "Evento", type: "masters", startsAt: new Date(now + 5e6).toISOString(), endsAt: new Date(now + 1e6).toISOString() }, now).ok, false, "fin antes que inicio");
  assert.equal(parseEventDraft({ name: "Evento", type: "masters", imageUrl: "javascript:alert(1)", startsAt: new Date(now).toISOString(), endsAt: new Date(now + 1e7).toISOString() }, now).ok, false, "imagen peligrosa");
  const xss = parseEventDraft({ name: "<img src=x onerror=alert(1)>", type: "regional", startsAt: new Date(now).toISOString(), endsAt: new Date(now + 1e7).toISOString() }, now);
  assert.ok(xss.ok, "el texto se guarda como texto (React lo escapa al pintar)");
});

/* ───────────── MODERACIÓN + ENFORCEMENT ───────────── */
test("MODERACIÓN · ban → activo, auditado, enforcement; auto-ban y ban a otro admin prohibidos; revocar lo levanta", async () => {
  const { db, deps } = world();
  const h = moderationHandlers(deps).POST;
  assert.equal((await h(post("/api/admin/moderation", "admin", { action: "sanction", userId: ADMIN, type: "ban", reason: "me baneo sin querer" }))).status, 409, "auto-ban");
  assert.equal((await h(post("/api/admin/moderation", "admin", { action: "sanction", userId: OTHER_ADMIN, type: "ban", reason: "ban a otro admin" }))).status, 409, "admin");
  const r = await h(post("/api/admin/moderation", "admin", { action: "sanction", userId: VICTIM, type: "suspension", reason: "toxicidad en duelos", hours: 24 }));
  assert.equal(r.status, 200);
  const s = await body(r);
  assert.equal(s.type, "suspension"); assert.equal(s.created_by, ADMIN, "el autor sale del token");
  assert.equal((await h(post("/api/admin/moderation", "admin", { action: "sanction", userId: VICTIM, type: "ban", reason: "segunda sanción" }))).status, 409, "una activa por usuario");
  assert.ok(db.table("content_audit_log").some((a) => a.action === "user_sanction" && a.entity_id === VICTIM && a.actor === ADMIN));

  invalidateSanctionCache();
  assert.ok(await activeSanctionFor(db.client, VICTIM), "enforcement ve la sanción");
  assert.equal(await activeSanctionFor(db.client, USER), null);
  assert.equal(isGatedRequest("POST", "/api/game/packs"), true);
  assert.equal(isGatedRequest("POST", "/api/game/duel/matchmaking"), true);
  assert.equal(isGatedRequest("POST", "/api/pickems"), true);
  assert.equal(isGatedRequest("GET", "/api/game/state"), false, "las lecturas siguen");
  assert.equal(isGatedRequest("POST", "/api/telemetry"), false);
  assert.equal(isGatedRequest("POST", "/api/admin/users"), false, "el panel no es superficie del juego");

  const rv = await h(post("/api/admin/moderation", "admin", { action: "revoke", sanctionId: s.id, reason: "apelación aceptada" }));
  assert.equal(rv.status, 200);
  assert.equal(await activeSanctionFor(db.client, VICTIM), null, "revocar invalida la caché y levanta el bloqueo");
  assert.equal((await h(post("/api/admin/moderation", "admin", { action: "revoke", sanctionId: s.id, reason: "apelación aceptada" }))).status, 409, "doble revocación");
  assert.ok(db.table("content_audit_log").some((a) => a.action === "user_sanction_revoke"));
  assert.equal(sanctionStatus({ revoked_at: null, expires_at: new Date(Date.now() - 1000).toISOString() }, Date.now()), "EXPIRED");
});

test("ENFORCEMENT · getSession niega las mutaciones del juego a una cuenta sancionada (código fuente)", () => {
  const src = readFileSync(join(process.cwd(), "src/server/services/session.ts"), "utf8");
  assert.match(src, /isGatedRequest\(req\.method, pathOf\(req\)\) && await activeSanctionFor\(admin, userId\)\) return null/);
  const mw = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
  // F67 · el matcher pasó a cubrir TODAS las /api ("/api/:path*"), que incluye las mutaciones del juego.
  assert.match(mw, /"\/api\/(game\/)?:path\*"/); assert.match(mw, /status: 403/);
});

/* ───────────── CRÉDITOS ───────────── */
test("CRÉDITOS · añadir/retirar por el libro mayor, idempotente, con saldo esperado y sin negativos; todo auditado", async () => {
  const { db, deps } = world();
  const h = usersHandlers(deps).POST;
  const req = (o: Record<string, unknown>) => post("/api/admin/users", "admin", { action: "adjust_credits", userId: VICTIM, reason: "compensación por incidencia", ...o });
  const a = await h(req({ direction: "add", amount: 500, expectedBalance: 2500, ref: "gesture-1001" }));
  assert.equal(a.status, 200);
  assert.equal((await body(a)).balanceAfter, 3000);
  const again = await body(await h(req({ direction: "add", amount: 500, expectedBalance: 2500, ref: "gesture-1001" })));
  assert.equal(again.repeated, true, "doble clic / reintento: no aplica dos veces");
  assert.equal(db.table("profiles").find((p) => p.id === VICTIM)!.credits, 3000);
  assert.equal((await h(req({ direction: "remove", amount: 100, expectedBalance: 2500, ref: "gesture-1002" }))).status, 409, "saldo cambiado desde la revisión");
  assert.equal((await h(req({ direction: "remove", amount: 5000, expectedBalance: 3000, ref: "gesture-1003" }))).status, 409, "no deja saldo negativo");
  const tx = db.table("credit_transactions").filter((t) => t.user_id === VICTIM && String(t.ref ?? "").startsWith("admin:"));
  assert.equal(tx.length, 1); assert.equal(tx[0].ref, "admin:credits:gesture-1001");
  assert.ok(db.table("content_audit_log").some((x) => x.action === "user_credits_adjust" && x.actor === ADMIN));
});

test("CONCESIONES · sobre y carta por award() (idempotente), sobre inválido o DRAFT rechazado, auditado", async () => {
  const { db, deps } = world();
  const h = usersHandlers(deps).POST;
  const g = (o: Record<string, unknown>) => post("/api/admin/users", "admin", { action: "grant", userId: VICTIM, reason: "compensación por incidencia", ...o });
  assert.equal((await h(g({ kind: "pack", packId: "team-loud", count: 1, ref: "grant-0001" }))).status, 400, "DRAFT no se concede");
  assert.equal((await h(g({ kind: "pack", packId: "no-existe", count: 1, ref: "grant-0002" }))).status, 400);
  assert.equal((await h(g({ kind: "pack", packId: "estandar", count: 99, ref: "grant-0003" }))).status, 400, "tope de cantidad");
  const r = await h(g({ kind: "pack", packId: "estandar", count: 2, ref: "grant-0004" }));
  assert.equal(r.status, 200);
  assert.equal((await body(r)).applied, true);
  assert.equal((await body(await h(g({ kind: "pack", packId: "estandar", count: 2, ref: "grant-0004" })))).applied, false, "idempotente");
  assert.ok(db.table("content_audit_log").some((x) => x.action === "user_grant_pack" && x.entity_id === VICTIM));
});

/* ───────────── EVENTOS ───────────── */
test("EVENTOS · crear = BORRADOR (no llega a public.events); editar con versión; publicar inserta la fila canónica y audita", async () => {
  const { db, deps } = world();
  const h = eventsHandlers(deps).POST;
  const base = { name: "Masters de prueba", type: "masters", region: "EMEA", startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 9 * 86_400_000).toISOString() };
  const c = await h(post("/api/admin/events", "admin", { action: "create", ...base }));
  assert.equal(c.status, 200);
  const d = await body(c);
  assert.equal(d.status, "draft");
  assert.equal(db.table("events").length, 0, "un borrador no aparece al juego");
  assert.equal(draftState(d as never, Date.now()), "DRAFT");
  const stale = await h(post("/api/admin/events", "admin", { action: "update", id: d.id, ...base, name: "Otro nombre", expectedUpdatedAt: "1999-01-01T00:00:00.000Z" }));
  assert.equal(stale.status, 409, "concurrencia: versión vieja");
  const pub = await h(post("/api/admin/events", "admin", { action: "publish", id: d.id, expectedUpdatedAt: d.updated_at }));
  assert.equal(pub.status, 200);
  const ev = db.table("events")[0];
  assert.equal(ev.source, "admin"); assert.equal(ev.status, "upcoming");
  assert.ok(db.table("content_audit_log").some((x) => x.action === "event_publish"));
  assert.equal((await h(post("/api/admin/events", "admin", { action: "publish", id: d.id, expectedUpdatedAt: d.updated_at }))).status, 409, "no se publica dos veces");
  const prev = await body(await h(post("/api/admin/events", "admin", { action: "preview", ...base })));
  assert.equal((prev.rewards as { setId: string }).setId, "internacional", "recompensas del motor existente");
});

/* ───────────── SOBRES / ECONOMÍA: solo lectura ───────────── */
test("SOBRES · la simulación es de solo lectura: no escribe, no cambia precios y avisa de la congelación", async () => {
  const { db, deps } = world();
  const price = getPack("estandar")!.price;
  const writes0 = db.writes;
  const r = await packsHandlers(deps).POST(post("/api/admin/packs", "admin", { action: "simulate", packId: "estandar", price: 700, n: 500 }));
  assert.equal(r.status, 200);
  const out = await body(r) as { before: { price: number }; after: { price: number; salvageOverPrice: number }; warnings: string[] };
  assert.equal(out.before.price, price); assert.equal(out.after.price, 700);
  assert.ok(out.warnings.some((w) => /congelada/.test(w)));
  assert.equal(getPack("estandar")!.price, price, "el precio canónico no cambia");
  assert.equal(db.writes, writes0, "cero escrituras");
  // Pack Opening 3.0 · el desguace medio de un Bronce bajó a ~76 créditos: un precio de 60 deja el desguace por encima.
  const loop = whatIf("estandar", { price: 60 }, 500)!;
  assert.ok(loop.warnings.some((w) => /NO válida/.test(w)), "un precio que crea bucle se marca inválido");
  assert.equal((await packsHandlers(deps).POST(post("/api/admin/packs", "admin", { action: "simulate", packId: "estandar", price: -1 }))).status, 400);
});

test("SALUD · la economía actual está sana (checks reales) y el sistema no expone secretos", async () => {
  // Pack Opening 3.1: los especiales dejan de dominar la línea (F80 lo había aceptado como aviso) y la compuerta económica
  // está en verde: TODO sano.
  const health = economyHealth();
  assert.ok(health.every((c) => c.level === "HEALTHY"), JSON.stringify(health.filter((c) => c.level !== "HEALTHY")));
  assert.ok(health.some((c) => c.id === "economy-gate"), "la compuerta económica está en la salud del panel");
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJlLXRlc3Q";
  const { deps } = world();
  const r = await systemHandlers(deps).GET(get("/api/admin/system", "admin"));
  const txt = JSON.stringify(await body(r));
  assert.ok(!txt.includes(process.env.SUPABASE_SERVICE_ROLE_KEY!), "la clave nunca sale");
  assert.ok(/GLOBAL_MARKET_ENABLED.*false/.test(txt) && /PAYMENTS_ENABLED.*false/.test(txt));
  assert.deepEqual(redactSecrets({ reason: "ok", token: "abc", nested: { authorization: "Bearer x" }, v: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl" }),
    { reason: "ok", token: REDACTED, nested: { authorization: REDACTED }, v: REDACTED });
});

test("AUDITORÍA · lectura paginada y filtrada; no hay ruta de edición ni borrado; la tabla es append-only", async () => {
  const { db, deps } = world();
  await moderationHandlers(deps).POST(post("/api/admin/moderation", "admin", { action: "sanction", userId: VICTIM, type: "ban", reason: "trampas reiteradas" }));
  const r = await body(await auditHandlers(deps).GET(get(`/api/admin/audit?entityType=user&entityId=${VICTIM}`, "admin")));
  assert.ok((r.rows as unknown[]).length >= 1);
  assert.equal((await auditHandlers(deps).GET(get("/api/admin/audit?action=%27;drop", "admin"))).status, 400, "filtro con inyección rechazado");
  assert.equal(typeof (auditHandlers(deps) as Record<string, unknown>).POST, "undefined", "no existe escritura HTTP del registro");
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0055_admin_control_center.sql"), "utf8");
  assert.match(sql, /before update or delete on public\.content_audit_log/);
  assert.ok(db.table("content_audit_log").length > 0);
});

test("BÚSQUEDA · agrupa usuarios, cartas, sobres y equipos; enmascara el email; rechaza entradas raras", async () => {
  const { deps } = world();
  const r = await body(await searchHandlers(deps).GET(get("/api/admin/search?q=u_02", "admin")));
  const hits = r.hits as { group: string; sub: string; href: string }[];
  const u = hits.find((h) => h.group === "Usuarios");
  assert.ok(u && u.href === `/admin/users/${VICTIM}`);
  assert.ok(!u.sub.includes("u_02@test.local"), "email enmascarado en la búsqueda");
  const packs = (await body(await searchHandlers(deps).GET(get("/api/admin/search?q=bronce", "admin")))).hits as { group: string }[];
  assert.ok(packs.some((h) => h.group === "Sobres"));
  assert.equal((await searchHandlers(deps).GET(get("/api/admin/search?q=%3Cscript%3E", "admin"))).status, 400);
});

/* ───────────── SHELL, PALETA Y SESIÓN ───────────── */
test("RUTAS · cada sección del panel tiene su página; la paleta solo navega o crea borradores (nunca sanciona, borra ni concede)", async () => {
  const { ADMIN_SECTIONS, PALETTE_ACTIONS } = await import("@/domain/admin/nav");
  const { existsSync } = await import("node:fs");
  for (const s of ADMIN_SECTIONS) {
    const dir = s.href === "/admin" ? "" : s.href.replace(/^\/admin\//, "");
    assert.ok(existsSync(join(process.cwd(), "src/app/admin", dir, "page.tsx")), `${s.href} sin página`);
  }
  for (const a of PALETTE_ACTIONS) assert.ok(!/(ban|banear|suspender|sancionar|borrar|eliminar|delete|cr[eé]ditos|conceder|grant)/i.test(`${a.id} ${a.label}`), a.label);
});

test("SESIÓN ADMIN · un refresco de token NO desmonta el panel; cerrar sesión o cambiar de usuario sí", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/supabase/useAdminSession.ts"), "utf8");
  // F58.2 · además anula las comprobaciones en vuelo (`seq++`) antes de denegar.
  assert.match(src, /event === "SIGNED_OUT" \|\| !uid\) \{ seq\+\+; setGate\("denied"\)/);
  assert.match(src, /if \(!sameUser\) setGate\("checking"\);/);
  assert.ok(!/onAuthStateChange\(\(\) => \{\s*if \(!alive\) return;\s*setGate\("checking"\)/.test(src), "ya no pasa a checking en cualquier evento");
});
