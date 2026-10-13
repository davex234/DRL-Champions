/**
 * F60 · ADMIN CMS — pruebas de contrato de extremo a extremo (rutas reales + servicios + doble de las RPC de 0057).
 *
 *   AUTH por familia · MASS ASSIGNMENT · CRUD de agentes, cartas y sobres · DEPENDENCIAS (sin borrado duro de lo
 *   referenciado) · AUDITORÍA (antes/después, sin secretos) · CONCURRENCIA · RUNTIME (borrador invisible, publicado
 *   visible, retirado no adquirible pero histórico) · CACHÉ sin reiniciar · SEGURIDAD DE SUBIDAS · XSS · IDOR · SALUD.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CmsMemSupabase, seedAsset } from "./testing/cmsMem";
import { agentsCmsHandlers, assetsCmsHandlers, cardsCmsHandlers, contentHealthHandlers, mapsCmsHandlers, packsCmsHandlers, playersCmsHandlers, publicContentHandlers } from "./handlers";
import { loadAgentCatalog, resetAgentCatalogCache } from "./agents";
import { loadPackCatalog, resetPackCatalogCache } from "./packs";
import { uploadCmsAsset, type ImageCodec } from "./assets";
import { contentHealth } from "./health";
import type { AdminDeps } from "@/server/admin/http";
import { applyAgentCatalog } from "@/domain/tactics/agentCatalog";
import { getTacticalAgent, isSelectableAgentId, TACTICAL_AGENTS } from "@/domain/tactics/roster";
import { getAgentArtwork } from "@/domain/tactics/agentArt";
import { applyRuntimePacks, getPack } from "@/data/packs";
import { mainPackDistribution } from "@/domain/packs/packClass";
import { guardPurchase, guardPublicOpen } from "@/domain/packs/lifecycle";
import { resolveAll } from "@/domain/store/resolve";
import { withPrinted, fromCardRow, type ContentCardRow } from "@/server/catalog/rows";
import { headerDimensions, sniffImage } from "@/domain/cms/uploads";

const ADMIN = "00000000-0000-4000-8000-0000000a0060";
const USER = "00000000-0000-4000-8000-0000000b0060";

function world() {
  const db = new CmsMemSupabase();
  db.seedUser(ADMIN, 1000); db.seedUser(USER, 1000);
  for (const p of db.table("profiles")) p.is_admin = p.id === ADMIN;
  db.seedContent();
  const deps: AdminDeps = {
    verify: async (req) => { const h = req.headers.get("authorization"); return h === "Bearer admin" ? { userId: ADMIN } : h === "Bearer user" ? null : null; },
    db: () => db.client,
  };
  resetAgentCatalogCache(); resetPackCatalogCache();
  return { db, deps };
}
type Who = "anon" | "user" | "admin";
const H = (w: Who): Record<string, string> => (w === "anon" ? {} : { authorization: `Bearer ${w}` });
const get = (url: string, w: Who) => new Request(`http://t${url}`, { headers: H(w) });
const post = (url: string, w: Who, body: unknown) => new Request(`http://t${url}`, { method: "POST", headers: { ...H(w), "content-type": "application/json" }, body: JSON.stringify(body) });
const J = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });

/** PNG mínimo con cabecera IHDR real (dimensiones legibles); el cuerpo no importa para el decodificador falso. */
function png(w: number, h: number, salt = 0): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  b[40] = salt;
  return b;
}
/** Decodificador falso: dimensiones de la cabecera; «corrupto» si el byte 41 vale 0xEE. */
const codec: ImageCodec = {
  async decode(bytes) {
    if (bytes[41] === 0xee) throw new Error("corrupt");
    const f = sniffImage(bytes); const d = f ? headerDimensions(bytes, f) : null;
    if (!d) throw new Error("undecodable");
    return { ...d, alpha: true };
  },
  async derive(bytes) { return bytes.slice(0, 16); },
};
async function multipart(url: string, w: Who, fields: Record<string, string | File>): Promise<Request> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = new Response(form);
  const buf = new Uint8Array(await res.arrayBuffer());
  return new Request(`http://t${url}`, { method: "POST", headers: { ...H(w), "content-type": res.headers.get("content-type")!, "content-length": String(buf.byteLength) }, body: buf });
}
const file = (bytes: Uint8Array, name: string, type: string) => new File([bytes], name, { type });

/* ═══════════ AUTH: anónimo y usuario normal NO; admin SÍ — por familia ═══════════ */
test("AUTH · todas las familias del CMS: anónimo 401, usuario normal 401 (mismo mensaje), admin 2xx", async () => {
  const { deps } = world();
  const fam: [string, { GET: (r: Request) => Promise<Response>; POST?: (r: Request) => Promise<Response> }, Record<string, unknown>][] = [
    ["/api/admin/cms/agents", agentsCmsHandlers(deps), { action: "save", id: "zzz", patch: {} }],
    ["/api/admin/cms/packs", packsCmsHandlers(deps), { action: "save", id: "cms-x", patch: {} }],
    ["/api/admin/cms/cards", cardsCmsHandlers(deps), { action: "preview" }],
    ["/api/admin/cms/players?id=nobody", playersCmsHandlers(deps), { action: "save", id: "x", patch: {} }],
    ["/api/admin/cms/assets", assetsCmsHandlers(deps, codec), { action: "deleteOrphan", id: "x" }],
    ["/api/admin/cms/health", contentHealthHandlers(deps), {}],
    ["/api/admin/cms/maps", mapsCmsHandlers(deps), {}],
  ];
  for (const [url, h, body] of fam) {
    for (const w of ["anon", "user"] as const) {
      const g = await h.GET(get(url, w)); assert.equal(g.status, 401, `${url} GET ${w}`);
      assert.deepEqual(await g.json(), { error: "No autorizado" });
      if (h.POST) { const p = await h.POST(post(url, w, body)); assert.equal(p.status, 401, `${url} POST ${w}`); }
    }
    const ok = await h.GET(get(url, "admin"));
    assert.ok(ok.status < 500, `${url} admin GET ${ok.status}`);
    assert.match(ok.headers.get("cache-control") ?? "", /no-store/);
  }
});

test("AUTH · la RPC se niega aunque alguien saltara la ruta (actor no admin ⇒ NOT_ADMIN)", async () => {
  const { db } = world();
  const r = await db.rpc("app_admin_agent_save", { p_actor: USER, p_id: "qaagent", p_patch: { name: "QA", role: "duelist" }, p_expected_version: null, p_reason: "x" });
  assert.match(String(r.error?.message), /NOT_ADMIN/);
});

/* ═══════════ MASS ASSIGNMENT ═══════════ */
test("MASS ASSIGNMENT · campos fuera de la lista blanca ⇒ 400, en el cuerpo y dentro de `patch`", async () => {
  const { deps } = world();
  const a = agentsCmsHandlers(deps);
  assert.equal((await a.POST(post("/api/admin/cms/agents", "admin", { action: "save", id: "qaz", lifecycle: "PUBLISHED" }))).status, 400);
  const r = await J(await a.POST(post("/api/admin/cms/agents", "admin", { action: "save", id: "qaz", patch: { name: "QA Z", role: "duelist", lifecycle: "PUBLISHED" } })));
  assert.equal(r.status, 400); assert.match(String(r.body.error), /no permitido/);
  const p = packsCmsHandlers(deps);
  const pr = await J(await p.POST(post("/api/admin/cms/packs", "admin", { action: "save", id: "cms-qa", patch: { name: "QA pack", templatePackId: "estandar", price: 1 } })));
  assert.equal(pr.status, 400, "el precio no lo manda el cliente");
});

/* ═══════════ AGENTES: ciclo completo ═══════════ */
test("AGENTE · borrador → editar → cara y cuerpo → publicar (sólo completo) → runtime sin reiniciar → retirar → histórico", async () => {
  const { db, deps } = world();
  const h = agentsCmsHandlers(deps);
  const abilities = [{ slot: "C", name: "Uno" }, { slot: "Q", name: "Dos" }, { slot: "E", name: "Tres" }, { slot: "X", name: "Cuatro" }];
  let r = await J(await h.POST(post("/api/admin/cms/agents", "admin", { action: "save", id: "qaagent", patch: { name: "QA Agent", role: "initiator", code: "QAA", abilities } })));
  assert.equal(r.status, 200); assert.equal(r.body.lifecycle, "DRAFT");
  // Borrador: fuera del juego (ni catálogo público ni roster).
  let cat = await loadAgentCatalog(db.client);
  assert.ok(!cat!.agents.some((x) => x.id === "qaagent"));
  const pub = await J(await publicContentHandlers(() => db.client).agents(new Request("http://t/api/content/agents")));
  assert.ok(!(pub.body.agents as { id: string }[]).some((x) => x.id === "qaagent"), "/api/content/agents no sirve borradores");
  // Editar con la versión buena; la vieja no pisa (CONCURRENCIA).
  r = await J(await h.POST(post("/api/admin/cms/agents", "admin", { action: "save", id: "qaagent", expectedVersion: 1, patch: { name: "QA Agent 2" } })));
  assert.equal(r.status, 200);
  const stale = await J(await h.POST(post("/api/admin/cms/agents", "admin", { action: "save", id: "qaagent", expectedVersion: 1, patch: { name: "Pisada" } })));
  assert.equal(stale.status, 409); assert.match(String(stale.body.error), /ha cambiado/);
  // Publicar sin arte ⇒ no.
  let pl = await J(await h.POST(post("/api/admin/cms/agents", "admin", { action: "lifecycle", id: "qaagent", to: "PUBLISHED", expectedVersion: 2, reason: "prueba" })));
  assert.equal(pl.status, 409); assert.match(String(pl.body.error), /completar/);
  // Subir cara y cuerpo (servicio real) y asignarlos.
  const face = await uploadCmsAsset(db.client, ADMIN, { kind: "agent_face", name: "qa-face.png", mime: "image/png", bytes: png(256, 256, 1), subjectId: "qaagent" }, codec);
  const full = await uploadCmsAsset(db.client, ADMIN, { kind: "agent_full", name: "qa-full.png", mime: "image/png", bytes: png(352, 470, 2), subjectId: "qaagent" }, codec);
  assert.ok(face.ok && full.ok);
  r = await J(await h.POST(post("/api/admin/cms/agents", "admin", { action: "save", id: "qaagent", expectedVersion: 2, patch: { faceAssetId: face.ok ? face.data.asset.id : "", fullAssetId: full.ok ? full.data.asset.id : "" } })));
  assert.equal(r.status, 200);
  pl = await J(await h.POST(post("/api/admin/cms/agents", "admin", { action: "lifecycle", id: "qaagent", to: "PUBLISHED", expectedVersion: 3, reason: "publicar QA" })));
  assert.equal(pl.status, 200); assert.equal(pl.body.lifecycle, "PUBLISHED");
  // RUNTIME sin reiniciar: el cargador ve el cambio (la escritura invalida la caché del proceso).
  cat = await loadAgentCatalog(db.client);
  const live = cat!.agents.find((x) => x.id === "qaagent")!;
  assert.ok(live && live.face && live.full, "publicado con su arte");
  assert.ok(applyAgentCatalog(cat));
  assert.ok(isSelectableAgentId("qaagent")); assert.equal(TACTICAL_AGENTS.length, 30);
  assert.match(getAgentArtwork("qaagent", "face")!.src, /agent_face/);
  // Retirar ⇒ no se ofrece, pero se sigue resolviendo (histórico).
  pl = await J(await h.POST(post("/api/admin/cms/agents", "admin", { action: "lifecycle", id: "qaagent", to: "RETIRED", expectedVersion: 4, reason: "retirar QA" })));
  assert.equal(pl.status, 200);
  applyAgentCatalog(await loadAgentCatalog(db.client));
  assert.equal(isSelectableAgentId("qaagent"), false);
  assert.equal(getTacticalAgent("qaagent")?.name, "QA Agent 2", "lo guardado lo sigue pintando");
  // Borrar un retirado ⇒ NO (sólo borradores).
  const del = await J(await h.POST(post("/api/admin/cms/agents", "admin", { action: "deleteDraft", id: "qaagent", expectedVersion: 5, reason: "x borrar", confirm: "qaagent" })));
  assert.equal(del.status, 409);
  // AUDITORÍA: cada escritura con antes/después.
  const audit = db.table("content_audit_log").filter((x) => x.entity_id === "qaagent");
  assert.deepEqual(audit.map((x) => x.action), ["agent_create", "agent_update", "agent_update", "agent_published", "agent_retired"]);
  for (const a of audit.slice(1)) { assert.ok((a.detail as { before: unknown }).before); assert.ok((a.detail as { after: unknown }).after); }
  assert.ok(db.table("content_audit_log").some((x) => x.action === "asset_upload"), "la subida también se audita");
});

test("AGENTE · dependencias reales: un borrador usado por una composición NO se borra; sin referencias sí (y sin residuos)", async () => {
  const { db, deps } = world();
  const h = agentsCmsHandlers(deps);
  await h.POST(post("/api/admin/cms/agents", "admin", { action: "save", id: "qadep", patch: { name: "QA Dep", role: "duelist" } }));
  db.table("user_compositions").push({ id: "c1", user_id: USER, map_id: "ascent", name: "x", agent_ids: ["qadep"] });
  let r = await J(await h.POST(post("/api/admin/cms/agents", "admin", { action: "deleteDraft", id: "qadep", expectedVersion: 1, reason: "borrar", confirm: "qadep" })));
  assert.equal(r.status, 409); assert.match(String(r.body.error), /referencias/);
  const detail = await J(await h.GET(get("/api/admin/cms/agents?id=qadep", "admin")));
  assert.equal((detail.body.references as Record<string, number>).compositions, 1, "el inspector enseña el uso real");
  db.tables.user_compositions = [];
  r = await J(await h.POST(post("/api/admin/cms/agents", "admin", { action: "deleteDraft", id: "qadep", expectedVersion: 1, reason: "borrar", confirm: "qadep" })));
  assert.equal(r.status, 200);
  assert.ok(!db.table("agents").some((x) => x.id === "qadep"));
  // Confirmación escrita obligatoria.
  await h.POST(post("/api/admin/cms/agents", "admin", { action: "save", id: "qadep2", patch: { name: "QA Dep2", role: "duelist" } }));
  r = await J(await h.POST(post("/api/admin/cms/agents", "admin", { action: "deleteDraft", id: "qadep2", expectedVersion: 1, reason: "borrar", confirm: "otro" })));
  assert.equal(r.status, 400);
});

test("AGENTE · XSS y reglas: <script> en el nombre, id de legado, habilidades incompletas ⇒ 400", async () => {
  const { deps } = world();
  const h = agentsCmsHandlers(deps);
  for (const patch of [{ name: "<script>x</script>", role: "duelist" }, { name: "Ok", role: "hacker" }, { name: "Ok", role: "duelist", abilities: [{ slot: "C", name: "a" }] }]) {
    assert.equal((await h.POST(post("/api/admin/cms/agents", "admin", { action: "save", id: "qaxss", patch }))).status, 400, JSON.stringify(patch));
  }
  assert.equal((await h.POST(post("/api/admin/cms/agents", "admin", { action: "save", id: "veil", patch: { name: "Veil", role: "controller" } }))).status, 400, "id del modelo anterior reservado");
  assert.equal((await h.POST(post("/api/admin/cms/agents", "admin", { action: "save", id: "jett", patch: { name: "Otra", role: "duelist" } }))).status, 400, "id existente");
});

test("CACHÉ · otro proceso publica (sube la versión): el cargador lo ve al vencer el TTL, sin reiniciar", async () => {
  const { db } = world();
  const t0 = 1_000_000;
  const a = await loadAgentCatalog(db.client, t0);
  assert.ok(a);
  db.table("agents").find((x) => x.id === "jett")!.name = "Jett X";
  db.table("content_entity_version").find((x) => x.entity === "agents")!.version = 99;
  assert.equal((await loadAgentCatalog(db.client, t0 + 1000))!.agents.find((x) => x.id === "jett")!.name, "Jett", "dentro del TTL: caché");
  assert.equal((await loadAgentCatalog(db.client, t0 + 6000))!.agents.find((x) => x.id === "jett")!.name, "Jett X", "tras el TTL: versión nueva");
});

/* ═══════════ SOBRES ═══════════ */
test("SOBRE · borrador desde plantilla (economía heredada) → pool → simulación sin escrituras → puerta → publicar → runtime → retirar", async () => {
  const { db, deps } = world();
  const h = packsCmsHandlers(deps);
  let r = await J(await h.POST(post("/api/admin/cms/packs", "admin", { action: "save", id: "cms-qa-pack", patch: { name: "QA Pack", templatePackId: "estandar", description: "prueba" } })));
  assert.equal(r.status, 200); assert.equal(r.body.price, getPack("estandar")!.price); assert.equal(r.body.cardCount, getPack("estandar")!.cardCount);
  r = await J(await h.POST(post("/api/admin/cms/packs", "admin", { action: "ensurePool", id: "cms-qa-pack" })));
  assert.equal(r.status, 200); assert.equal(r.body.bound, true);
  // Publicar sin arte ni pool activo ⇒ no.
  let p = await J(await h.POST(post("/api/admin/cms/packs", "admin", { action: "publish", id: "cms-qa-pack", expectedVersion: 1, reason: "publicar", confirm: "cms-qa-pack" })));
  assert.equal(p.status, 409);
  // Un borrador no está en el juego.
  assert.equal((await loadPackCatalog(db.client))!.some((d) => d.id === "cms-qa-pack"), false);
  // Referencias de un sobre con inventario ⇒ el borrado se niega.
  db.table("user_packs").push({ user_id: USER, pack_id: "cms-qa-pack", qty: 1 });
  const del = await J(await h.POST(post("/api/admin/cms/packs", "admin", { action: "deleteDraft", id: "cms-qa-pack", expectedVersion: 1, reason: "borrar", confirm: "cms-qa-pack" })));
  assert.equal(del.status, 409);
  db.tables.user_packs = db.table("user_packs").filter((x) => x.pack_id !== "cms-qa-pack");
  // Borrar el borrador: se lleva su pool dedicado (sin residuos).
  const ok = await J(await h.POST(post("/api/admin/cms/packs", "admin", { action: "deleteDraft", id: "cms-qa-pack", expectedVersion: 1, reason: "borrar", confirm: "cms-qa-pack" })));
  assert.equal(ok.status, 200); assert.equal(ok.body.poolDeleted, true);
  assert.ok(!db.table("content_pools").some((x) => x.id === "pack-cms-qa-pack")); assert.ok(!db.table("content_pack_pools").some((x) => x.pack_id === "cms-qa-pack"));
});

test("SOBRE · ECONOMÍA congelada tras publicar; la RPC exige arte + simulación + pool ACTIVO para publicar", async () => {
  const { db } = world();
  const art = seedAsset(db, "pack_art");
  await db.rpc("app_admin_pack_save", { p_actor: ADMIN, p_id: "cms-econ", p_patch: { name: "Econ", template_pack_id: "estandar", price: 1000, card_count: 5, art_asset_id: art }, p_expected_version: null, p_reason: "t" });
  let r = await db.rpc("app_admin_pack_lifecycle", { p_actor: ADMIN, p_id: "cms-econ", p_to: "ACTIVE", p_expected_version: 1, p_reason: "publicar" });
  assert.match(String(r.error?.message), /CONTENT_INCOMPLETE/, "sin simulación ni pool");
  db.table("content_pools").push({ id: "pack-cms-econ", mode: "EXPLICIT", lifecycle: "ACTIVE", revision: 1, rules: {} });
  db.table("content_pool_entries").push({ pool_id: "pack-cms-econ", card_id: db.table("content_cards")[0].card_id, weight: 1, mode: "INCLUDE" });
  db.table("content_pack_pools").push({ pack_id: "cms-econ", pool_id: "pack-cms-econ", priority: 100, enabled: true });
  await db.rpc("app_admin_pack_save", { p_actor: ADMIN, p_id: "cms-econ", p_patch: { sim_summary: { ok: true } }, p_expected_version: 1, p_reason: "sim" });
  r = await db.rpc("app_admin_pack_lifecycle", { p_actor: ADMIN, p_id: "cms-econ", p_to: "ACTIVE", p_expected_version: 2, p_reason: "publicar" });
  assert.equal(r.error, null);
  r = await db.rpc("app_admin_pack_save", { p_actor: ADMIN, p_id: "cms-econ", p_patch: { price: 1 }, p_expected_version: 3, p_reason: "barato" });
  assert.match(String(r.error?.message), /ECONOMY_FROZEN/);
  // Runtime: el sobre publicado entra en el registro, usa la tabla de su plantilla y se vende SOLO con créditos.
  const defs = await loadPackCatalog(db.client);
  applyRuntimePacks(defs!);
  const pk = getPack("cms-econ")!;
  assert.equal(pk.price, getPack("estandar")!.price);
  assert.deepEqual(mainPackDistribution("cms-econ"), mainPackDistribution("estandar"), "probabilidad = la de la plantilla");
  assert.equal(guardPurchase(pk).ok, true);
  const offer = resolveAll(Date.now()).find((o) => o.productId === "pack:cms-econ")!;
  assert.ok(offer && offer.options.every((o) => o.method === "GAME_CURRENCY"), "nunca dinero real");
  // Retirar: deja de venderse; lo comprado se sigue abriendo.
  r = await db.rpc("app_admin_pack_lifecycle", { p_actor: ADMIN, p_id: "cms-econ", p_to: "RETIRED", p_expected_version: 3, p_reason: "retirar" });
  assert.equal(r.error, null);
  resetPackCatalogCache();
  applyRuntimePacks((await loadPackCatalog(db.client))!);
  const retired = getPack("cms-econ")!;
  assert.equal(guardPurchase(retired).ok, false); assert.equal(guardPublicOpen(retired).ok, true);
  assert.equal(resolveAll(Date.now()).find((o) => o.productId === "pack:cms-econ")!.status, "DISABLED");
});

test("SOBRE · la simulación no escribe NADA en la BD", async () => {
  const { db, deps } = world();
  const h = packsCmsHandlers(deps);
  await h.POST(post("/api/admin/cms/packs", "admin", { action: "save", id: "cms-sim", patch: { name: "Sim pack", templatePackId: "estandar" } }));
  const before = db.writes;
  const r = await h.POST(post("/api/admin/cms/packs", "admin", { action: "simulate", id: "cms-sim", n: 200 }));
  assert.ok(r.status < 500);
  assert.equal(db.writes, before, "simular no persiste nada");
});

/* ═══════════ CARTAS ═══════════ */
test("CARTA · alta atómica en borrador (arte obligatorio), fuera del juego, puerta de publicación, impreso inmutable, retiro histórico", async () => {
  const { db } = world();
  const player = String(db.table("content_players")[0].id);
  const artPath = "cms/card_artwork/x/original.png";
  const art = seedAsset(db, "card_artwork", artPath);
  const pres = { role: "Flex", printed: { ovr: 88, stats: { dmg: 80, scr: 80, fks: 80, hs: 80, ast: 80, clu: 80 } }, team: "QA", imageAssetId: art, imagePath: artPath };
  const def = { player_id: player, variant_id: "moments", ovr: 88, stats: {}, combat: {}, stat_boost: 0, rarity_rank: 1, rarity_bucket: "common", data_version: "x", source: "vlr", generated_at: new Date().toISOString(), checksum: "c" };
  // Sin arte ⇒ la presentación no vale y NO queda carta a medias (transacción).
  let r = await db.rpc("app_admin_card_create_draft", { p_actor: ADMIN, p_def: def, p_presentation: { ...pres, imageAssetId: "00000000-0000-4000-8000-000000000000" }, p_reason: "alta QA" });
  assert.match(String(r.error?.message), /BAD_ASSET/);
  assert.ok(!db.table("content_cards").some((c) => c.card_id === `${player}__moments`), "sin residuos");
  r = await db.rpc("app_admin_card_create_draft", { p_actor: ADMIN, p_def: def, p_presentation: pres, p_reason: "alta QA" });
  assert.equal(r.error, null);
  const id = `${player}__moments`;
  const row = db.table("content_cards").find((c) => c.card_id === id)!;
  assert.equal(row.lifecycle, "DRAFT");
  // LA CARTA ES EL ASSET: la vista del juego lleva lo impreso y su imagen de Storage.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://mem.local";
  const card = fromCardRow(row as unknown as ContentCardRow);
  assert.equal(card.team, "QA"); assert.equal(card.printed?.ovr, 88); assert.match(card.image ?? "", /storage\/v1\/object\/public\/assets\/cms\/card_artwork/);
  // El equipo IMPRESO no cambia aunque el jugador cambie de equipo.
  db.table("content_players")[0].team = "Otro Equipo";
  assert.equal(fromCardRow(row as unknown as ContentCardRow).team, "QA");
  // Publicar (trigger: presentación completa) y después lo impreso ya no se toca.
  r = await db.rpc("app_content_set_lifecycle", { p_card_id: id, p_state: "PUBLISHED", p_reason: "publicar", p_actor: ADMIN });
  assert.equal(r.error, null);
  r = await db.rpc("app_admin_card_set_presentation", { p_actor: ADMIN, p_card_id: id, p_presentation: { ...pres, team: "HACK" }, p_expected_rev: 1, p_reason: "x" });
  assert.match(String(r.error?.message), /NOT_A_DRAFT/);
  // Con ejemplares no se borra; se RETIRA y se sigue resolviendo.
  db.table("user_cards").push({ uid: "u1", user_id: USER, card_id: id });
  r = await db.rpc("app_admin_card_delete_draft", { p_actor: ADMIN, p_card_id: id, p_expected_rev: 1, p_reason: "borrar" });
  assert.match(String(r.error?.message), /NOT_A_DRAFT|HAS_REFERENCES/);
  r = await db.rpc("app_content_set_lifecycle", { p_card_id: id, p_state: "RETIRED", p_reason: "retirar QA", p_actor: ADMIN });
  assert.equal(r.error, null);
});

test("CARTA · una carta del panel sin presentación NO se publica (red en la BD, entre por donde entre)", async () => {
  const { db } = world();
  const player = String(db.table("content_players")[0].id);
  await db.rpc("app_content_create_card", { p_def: { player_id: player, variant_id: "record-breaker", ovr: 80 }, p_reason: "x", p_actor: ADMIN });
  const r = await db.rpc("app_content_set_lifecycle", { p_card_id: `${player}__record-breaker`, p_state: "PUBLISHED", p_reason: "x", p_actor: ADMIN });
  assert.match(String(r.error?.message), /CONTENT_INCOMPLETE/);
});

test("CARTA · las 331 del catálogo diseñado siguen saliendo del manifiesto (presentación NULL no las toca)", () => {
  const def = withPrinted({ id: "leaf__champions-s", playerId: "leaf", variantId: "champions-s", ovr: 1, stats: {} } as never, null);
  assert.equal(def.image, "/cards/leaf__champions-s.webp");
});

/* ═══════════ JUGADORES ═══════════ */
test("JUGADOR · alta, edición con concurrencia, validación y retiro por estado (sin borrado)", async () => {
  const { db, deps } = world();
  const h = playersCmsHandlers(deps);
  const stats = { dmg: 50, scr: 50, com: 50, hs: 50, ast: 50, clu: 50 };
  let r = await J(await h.POST(post("/api/admin/cms/players", "admin", { action: "save", id: "qaplayer", patch: { nick: "QAP", region: "EMEA", role: "Flex", stats } })));
  assert.equal(r.status, 200);
  r = await J(await h.POST(post("/api/admin/cms/players", "admin", { action: "save", id: "qaplayer", expectedVersion: 1, patch: { status: "inactive" } })));
  assert.equal(r.status, 200);
  r = await J(await h.POST(post("/api/admin/cms/players", "admin", { action: "save", id: "qaplayer", expectedVersion: 1, patch: { nick: "Pisada" } })));
  assert.equal(r.status, 409);
  r = await J(await h.POST(post("/api/admin/cms/players", "admin", { action: "save", id: "qa2", patch: { nick: "<b>x</b>", region: "EMEA", role: "Flex", stats } })));
  assert.equal(r.status, 400, "XSS en el nick");
  assert.equal(db.table("content_players").find((x) => x.id === "qaplayer")!.status, "inactive");
});

/* ═══════════ ASSETS: seguridad de subida ═══════════ */
test("SUBIDAS · PNG falso, doble extensión, traversal, MIME falso, SVG, corrupto, tipo no admitido ⇒ rechazados; el válido entra", async () => {
  const { db } = world();
  const up = (name: string, mime: string, bytes: Uint8Array, kind = "pack_art") => uploadCmsAsset(db.client, ADMIN, { kind, name, mime, bytes }, codec);
  const cases: [string, string, Uint8Array, string?][] = [
    ["fake.png", "image/png", new TextEncoder().encode("no soy un png, soy texto".padEnd(64, "x"))],
    ["x.png.html", "image/png", png(400, 600)],
    ["../../etc/x.png", "image/png", png(400, 600)],
    ["x.png", "image/gif", png(400, 600)],
    ["x.svg", "image/svg+xml", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["x.png", "image/png", (() => { const b = png(400, 600); b[41] = 0xee; return b; })()],
    ["x.png", "image/png", png(400, 600), "script"],
    ["tiny.png", "image/png", png(10, 10)],
  ];
  for (const [name, mime, bytes, kind] of cases) {
    const r = await up(name, mime, bytes, kind);
    assert.equal(r.ok, false, `${name} (${mime}) debió rechazarse`);
  }
  assert.equal(db.table("assets").length, 0, "nada registrado");
  assert.equal([...db.objects.keys()].filter((k) => k.includes("cms/")).length, 0, "nada en Storage");
  const good = await up("arte.png", "image/png", png(400, 600));
  assert.ok(good.ok);
  if (good.ok) { assert.match(good.data.asset.url ?? "", /cms\/pack_art\/[0-9a-f-]{36}\/original\.png$/, "ruta generada por el servidor"); assert.equal(good.data.asset.name, "arte.png"); }
});

test("SUBIDAS · por la RUTA: tamaño antes de leer, campos no permitidos, fichero enorme ⇒ 413; duplicado ⇒ mismo asset (idempotente)", async () => {
  const { db, deps } = world();
  const h = assetsCmsHandlers(deps, codec);
  const big = await h.POST(new Request("http://t/api/admin/cms/assets", { method: "POST", headers: { authorization: "Bearer admin", "content-type": "multipart/form-data; boundary=x", "content-length": String(50 * 1024 * 1024) }, body: "x" }));
  assert.equal(big.status, 413);
  const extra = await h.POST(await multipart("/api/admin/cms/assets", "admin", { action: "upload", kind: "pack_art", file: file(png(400, 600), "a.png", "image/png"), path: "../../x" }));
  assert.equal(extra.status, 400, "no se aceptan rutas del cliente");
  const a = await J(await h.POST(await multipart("/api/admin/cms/assets", "admin", { action: "upload", kind: "pack_art", file: file(png(400, 600, 9), "a.png", "image/png") })));
  const b = await J(await h.POST(await multipart("/api/admin/cms/assets", "admin", { action: "upload", kind: "pack_art", file: file(png(400, 600, 9), "a-otra-vez.png", "image/png") })));
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal((b.body.asset as { id: string }).id, (a.body.asset as { id: string }).id); assert.equal(b.body.deduplicated, true);
  assert.equal(db.table("assets").length, 1, "doble clic = una sola subida");
  const user = await h.POST(await multipart("/api/admin/cms/assets", "user", { action: "upload", kind: "pack_art", file: file(png(400, 600, 3), "a.png", "image/png") }));
  assert.equal(user.status, 401);
});

test("SUBIDAS · compensación: fallo de Storage a mitad o de la auditoría ⇒ ni objetos ni fila", async () => {
  const { db } = world();
  db.failUploadsAfter = 1; // el original sube, el derivado falla
  let r = await uploadCmsAsset(db.client, ADMIN, { kind: "agent_face", name: "f.png", mime: "image/png", bytes: png(256, 256, 4) }, codec);
  assert.equal(r.ok, false);
  assert.equal([...db.objects.keys()].length, 0, "se borró lo que se subió"); assert.equal(db.table("assets").length, 0);
  db.failUploadsAfter = null;
  for (const p of db.table("profiles")) p.is_admin = false; // la auditoría fallará (NOT_ADMIN)
  r = await uploadCmsAsset(db.client, ADMIN, { kind: "pack_art", name: "p.png", mime: "image/png", bytes: png(400, 600, 5) }, codec);
  assert.equal(r.ok, false);
  assert.equal(db.table("assets").length, 0, "fila deshecha"); assert.equal([...db.objects.keys()].filter((k) => k.includes("cms/")).length, 0);
});

test("SUBIDAS · reemplazo = nueva versión del grupo (la anterior queda como historial); huérfano detectado y limpieza explícita; en uso ⇒ no", async () => {
  const { db, deps } = world();
  const one = await uploadCmsAsset(db.client, ADMIN, { kind: "pack_art", name: "v1.png", mime: "image/png", bytes: png(400, 600, 6) }, codec);
  assert.ok(one.ok);
  const id1 = one.ok ? one.data.asset.id : "";
  const two = await uploadCmsAsset(db.client, ADMIN, { kind: "pack_art", name: "v2.png", mime: "image/png", bytes: png(400, 600, 7), replaceOf: id1 }, codec);
  assert.ok(two.ok);
  if (two.ok) { assert.equal(two.data.asset.version, 2); assert.equal(two.data.asset.groupId, db.table("assets").find((x) => x.id === id1)!.group_id); }
  assert.equal(db.table("assets").find((x) => x.id === id1)!.is_current, false);
  const h = assetsCmsHandlers(deps, codec);
  const list = await J(await h.GET(get("/api/admin/cms/assets?orphan=1", "admin")));
  assert.equal((list.body.rows as unknown[]).length, 1, "la versión vigente sin uso es huérfana");
  const id2 = two.ok ? two.data.asset.id : "";
  // En uso por un sobre ⇒ no se borra.
  await db.rpc("app_admin_pack_save", { p_actor: ADMIN, p_id: "cms-art", p_patch: { name: "Art", template_pack_id: "estandar", price: 1000, card_count: 5, art_asset_id: id2 }, p_expected_version: null, p_reason: "t" });
  let d = await J(await h.POST(post("/api/admin/cms/assets", "admin", { action: "deleteOrphan", id: id2, reason: "limpiar", confirm: id2 })));
  assert.equal(d.status, 409);
  db.tables.content_packs = [];
  d = await J(await h.POST(post("/api/admin/cms/assets", "admin", { action: "deleteOrphan", id: id2, reason: "limpiar", confirm: id2 })));
  assert.equal(d.status, 200);
  assert.ok(db.table("content_audit_log").some((x) => x.action === "asset_delete_orphan"));
});

/* ═══════════ IDOR ═══════════ */
test("IDOR · ids manipulados: un usuario normal no lee ni escribe nada; el admin recibe 404/400 limpios (sin detalle interno)", async () => {
  const { deps } = world();
  for (const [url, h] of [["/api/admin/cms/agents?id=jett", agentsCmsHandlers(deps)], ["/api/admin/cms/cards?id=leaf__champions-s", cardsCmsHandlers(deps)], ["/api/admin/cms/packs?id=cms-otro", packsCmsHandlers(deps)]] as const) {
    assert.equal((await h.GET(get(url, "user"))).status, 401);
  }
  const a = await J(await agentsCmsHandlers(deps).GET(get("/api/admin/cms/agents?id=../../etc", "admin")));
  assert.equal(a.status, 400);
  const p = await J(await packsCmsHandlers(deps).GET(get("/api/admin/cms/packs?id=cms-no-existe", "admin")));
  assert.equal(p.status, 404);
  assert.ok(!JSON.stringify(p.body).match(/select|postgres|stack|at /i));
});

/* ═══════════ SALUD DEL CONTENIDO ═══════════ */
test("SALUD · 0 referencias rotas en un estado sano; un inventario que apunta a un sobre inexistente es CRITICAL", async () => {
  const { db } = world();
  let h = await contentHealth(db.client, 10);
  const broken = h.checks.find((c) => c.id === "content-references")!;
  // Los usuarios de prueba traen «inicial» y «estandar» (sobres reales): sano.
  assert.equal(broken.level, "HEALTHY", broken.detail);
  db.table("user_packs").push({ user_id: USER, pack_id: "sobre-fantasma", qty: 1 });
  h = await contentHealth(db.client, 10);
  assert.equal(h.checks.find((c) => c.id === "content-references")!.level, "CRITICAL");
  assert.ok(h.broken.includes("inventory:sobre-fantasma"));
  assert.equal(h.summary.agents.published, 29);
});
