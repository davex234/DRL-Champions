/** F71 · TEMÁTICAS DE DUELO — servidor: autorización, guardado auditado, un solo default, concurrencia, fallback. */
import test from "node:test";
import assert from "node:assert/strict";
import { CmsMemSupabase, seedAsset } from "./testing/cmsMem";
import { duelThemesCmsHandlers, publicContentHandlers } from "./handlers";
import { assetUsage } from "./assets";
import { loadActiveDuelTheme, resetDuelThemeCache } from "./duelThemes";
import type { AdminDeps } from "@/server/admin/http";
import { ASSET_RULES } from "@/domain/cms/uploads";

const ADMIN = "00000000-0000-4000-8000-0000000a0071";
const USER = "00000000-0000-4000-8000-0000000b0071";

function world() {
  const db = new CmsMemSupabase();
  db.seedUser(ADMIN, 1000); db.seedUser(USER, 1000);
  for (const p of db.table("profiles")) p.is_admin = p.id === ADMIN;
  const deps: AdminDeps = {
    verify: async (req) => (req.headers.get("authorization") === "Bearer admin" ? { userId: ADMIN } : null),
    db: () => db.client,
  };
  resetDuelThemeCache();
  return { db, deps, h: duelThemesCmsHandlers(deps) };
}
type Who = "anon" | "user" | "admin";
const H = (w: Who): Record<string, string> => (w === "anon" ? {} : { authorization: `Bearer ${w}` });
const post = (w: Who, body: unknown) => new Request("http://t/api/admin/cms/duel-themes", { method: "POST", headers: { ...H(w), "content-type": "application/json" }, body: JSON.stringify(body) });
const J = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });
const theme = (over: Record<string, unknown> = {}) => ({ slug: "champions", name: "Champions 2026", status: "active", priority: 10, isDefault: false, ...over });

test("F71 THEMES S01 · anónimo y usuario normal: 401 al leer, crear, editar o activar", async () => {
  const { db, h } = world();
  const id = seedAsset(db, "background");
  for (const w of ["anon", "user"] as const) {
    assert.equal((await h.GET(new Request("http://t/api/admin/cms/duel-themes", { headers: H(w) }))).status, 401);
    assert.equal((await h.POST(post(w, { action: "save", assetId: id, theme: theme() }))).status, 401);
    assert.equal((await h.POST(post(w, { action: "remove", assetId: id, expectedRev: 1 }))).status, 401);
  }
  assert.equal((db.table("assets").find((a) => a.id === id) as { meta: Record<string, unknown> }).meta.duelTheme, undefined, "nada escrito");
});

test("F71 THEMES S02 · admin crea, edita y retira; cada paso auditado; mass assignment rechazado", async () => {
  const { db, h } = world();
  const id = seedAsset(db, "background");
  const c = await J(await h.POST(post("admin", { action: "save", assetId: id, theme: theme() })));
  assert.equal(c.status, 200, JSON.stringify(c.body)); assert.equal(c.body.rev, 1);
  const e = await J(await h.POST(post("admin", { action: "save", assetId: id, expectedRev: 1, theme: theme({ priority: 20 }) })));
  assert.equal(e.body.rev, 2);
  const list = await J(await h.GET(new Request("http://t/api/admin/cms/duel-themes", { headers: H("admin") })));
  assert.equal(list.body.themes[0].priority, 20);
  assert.equal(list.body.active.slug, "champions");
  const r = await J(await h.POST(post("admin", { action: "remove", assetId: id, expectedRev: 2 })));
  assert.equal(r.status, 200);
  const actions = db.table("content_audit_log").map((a) => a.action);
  for (const a of ["duel_theme_create", "duel_theme_update", "duel_theme_remove"]) assert.ok(actions.includes(a), a);
  assert.equal((await h.POST(post("admin", { action: "save", assetId: id, theme: theme(), path: "/etc/passwd" }))).status, 400, "campo fuera de lista blanca");
});

test("F71 THEMES S03 · solo fondos aprobados de tipo background; ids con forma de uuid (sin rutas)", async () => {
  const { db, h } = world();
  const pack = seedAsset(db, "pack_art");
  assert.equal((await h.POST(post("admin", { action: "save", assetId: pack, theme: theme() }))).status, 404);
  assert.equal((await h.POST(post("admin", { action: "save", assetId: "../../x", theme: theme() }))).status, 400);
  const arch = seedAsset(db, "background");
  (db.table("assets").find((a) => a.id === arch) as { status: string }).status = "archived";
  assert.equal((await h.POST(post("admin", { action: "save", assetId: arch, theme: theme() }))).status, 409);
  assert.equal(ASSET_RULES.background.subject, "none");
  assert.ok(ASSET_RULES.background.maxBytes <= 8 * 1024 * 1024 && ASSET_RULES.background.minW >= 1280);
});

test("F71 THEMES S04 · un solo tema por defecto; revisión obsoleta → 409; slug duplicado → 409", async () => {
  const { db, h } = world();
  const a = seedAsset(db, "background"), b = seedAsset(db, "background");
  await h.POST(post("admin", { action: "save", assetId: a, theme: theme({ slug: "base-a", isDefault: true, priority: 0 }) }));
  await h.POST(post("admin", { action: "save", assetId: b, theme: theme({ slug: "base-b", isDefault: true, priority: 0 }) }));
  const defaults = (db.table("assets") as { id: string; meta?: { duelTheme?: { isDefault?: boolean } } }[]).filter((x) => x.meta?.duelTheme?.isDefault);
  assert.equal(defaults.length, 1); assert.equal(defaults[0].id, b);
  assert.equal((await h.POST(post("admin", { action: "save", assetId: a, expectedRev: 0, theme: theme({ slug: "base-a" }) }))).status, 409, "revisión vieja");
  assert.equal((await h.POST(post("admin", { action: "save", assetId: a, expectedRev: 2, theme: theme({ slug: "base-b" }) }))).status, 409, "slug ocupado");
});

test("F71 THEMES S05 · endpoint público: tema vigente; sin BD o sin temas → DEFAULT; un fondo-tema está EN USO", async () => {
  const { db, h } = world();
  const empty = await J(await publicContentHandlers(() => db.client).duelTheme(new Request("http://t/api/content/duel-theme")));
  assert.equal(empty.body.theme.source, "code-default");
  assert.equal((await loadActiveDuelTheme(null)).source, "code-default");
  const id = seedAsset(db, "background");
  await h.POST(post("admin", { action: "save", assetId: id, theme: theme() }));
  resetDuelThemeCache();
  const pub = await J(await publicContentHandlers(() => db.client).duelTheme(new Request("http://t/api/content/duel-theme")));
  assert.equal(pub.body.theme.slug, "champions");
  assert.deepEqual(Object.keys(pub.body.theme).sort(), ["id", "name", "narrow", "slug", "source", "wide"], "solo lo necesario para pintar");
  const use = await assetUsage(db.client);
  assert.deepEqual(use.get(id), [{ type: "duel_theme", id: "champions" }]);
});
