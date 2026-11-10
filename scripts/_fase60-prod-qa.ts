/**
 * F60 · QA DE PRODUCCIÓN DEL CMS (instrumento `_`, fuera de CI). Ejecuta los CICLOS de agente, carta, sobre y asset
 * con los HANDLERS REALES (runAdmin, lista blanca, RPC de 0057), `sharp` real y Storage real, como la cuenta QA
 * (admin temporal; NUNCA la cuenta del usuario). Nada QA se publica; todo se limpia y se comprueba que no quedan residuos.
 *
 *   npx tsx scripts/_fase60-prod-qa.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

for (const l of readFileSync(join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const QA = "8c326e52-776a-43f4-ba05-3ad7945c40c3";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase60-admin-cms");
mkdirSync(OUT, { recursive: true });

type Step = { flow: string; step: string; ok: boolean; detail?: unknown };
const steps: Step[] = [];
const rec = (flow: string, step: string, ok: boolean, detail?: unknown) => { steps.push({ flow, step, ok, detail }); console.log(`${ok ? "✓" : "✗"} ${flow} · ${step}${detail !== undefined ? ` · ${JSON.stringify(detail).slice(0, 160)}` : ""}`); };

async function img(w: number, h: number, color: string, alpha = true): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${alpha ? "none" : "#101820"}"/><circle cx="${w / 2}" cy="${h / 2.4}" r="${Math.min(w, h) / 3}" fill="${color}"/><text x="50%" y="92%" font-size="${Math.round(w / 12)}" text-anchor="middle" fill="#fff">QA F60</text></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

(async () => {
  const { agentsCmsHandlers, assetsCmsHandlers, cardsCmsHandlers, packsCmsHandlers, publicContentHandlers } = await import("@/server/cms/handlers");
  const { loadAgentCatalog, resetAgentCatalogCache } = await import("@/server/cms/agents");
  const { loadPackCatalog, resetPackCatalogCache } = await import("@/server/cms/packs");
  const { serverCatalog, resetServerCatalog } = await import("@/server/catalog");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const deps = { verify: async () => ({ userId: QA }), db: () => sb };
  const A = agentsCmsHandlers(deps), P = packsCmsHandlers(deps), C = cardsCmsHandlers(deps), S = assetsCmsHandlers(deps);
  const post = async (h: { POST: (r: Request) => Promise<Response> }, url: string, body: unknown) => {
    const r = await h.POST(new Request(`http://qa${url}`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer qa" }, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() as Record<string, unknown> };
  };
  const get = async (h: { GET: (r: Request) => Promise<Response> }, url: string) => { const r = await h.GET(new Request(`http://qa${url}`, { headers: { authorization: "Bearer qa" } })); return { status: r.status, body: await r.json() as Record<string, unknown> }; };
  const upload = async (kind: string, name: string, bytes: Uint8Array, extra: Record<string, string> = {}) => {
    const form = new FormData(); form.set("action", "upload"); form.set("kind", kind); form.set("file", new File([bytes], name, { type: "image/png" }));
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    const res = new Response(form); const buf = new Uint8Array(await res.arrayBuffer());
    const r = await S.POST(new Request("http://qa/api/admin/cms/assets", { method: "POST", headers: { authorization: "Bearer qa", "content-type": res.headers.get("content-type")!, "content-length": String(buf.byteLength) }, body: buf }));
    return { status: r.status, body: await r.json() as { asset?: { id: string; url: string; runtimeUrl: string; smallUrl: string | null; version: number }; error?: string; deduplicated?: boolean } };
  };
  const httpStatus = async (url: string | null | undefined) => (url ? (await fetch(url, { method: "GET" })).status : null);
  const created: string[] = [];
  const snapshotCounts = async () => {
    const [cards, agents, packs, assets] = await Promise.all([
      sb.from("content_cards").select("card_id", { count: "exact", head: true }).eq("lifecycle", "PUBLISHED"),
      sb.from("agents").select("id", { count: "exact", head: true }),
      sb.from("content_packs").select("id", { count: "exact", head: true }),
      sb.from("assets").select("id", { count: "exact", head: true }),
    ]);
    return { publishedCards: cards.count, agents: agents.count, cmsPacks: packs.count, assets: assets.count };
  };
  const before = await snapshotCounts();
  rec("baseline", "recuentos antes", true, before);

  // ════════════ AGENTE ════════════
  const AG = "qaf60agent";
  const abilities = [{ slot: "C", name: "Pulso QA" }, { slot: "Q", name: "Salto QA" }, { slot: "E", name: "Muro QA" }, { slot: "X", name: "Final QA" }];
  let r = await post(A, "/api/admin/cms/agents", { action: "save", id: AG, patch: { name: "QA F60", role: "initiator", code: "QAF", abilities }, reason: "QA F60 alta" });
  rec("agent", "crear borrador", r.status === 200 && r.body.lifecycle === "DRAFT", r.body);
  const face = await upload("agent_face", "qa-face.png", await img(512, 512, "#19e3ff"), { subjectId: AG });
  const full = await upload("agent_full", "qa-full.png", await img(704, 940, "#ff2e63"), { subjectId: AG });
  rec("agent", "subir cara (sharp real, Storage real)", face.status === 200, { status: face.status, err: face.body.error });
  rec("agent", "subir cuerpo entero", full.status === 200, { status: full.status, err: full.body.error });
  if (face.body.asset) created.push(face.body.asset.id); if (full.body.asset) created.push(full.body.asset.id);
  rec("agent", "Storage sirve original y derivados", (await httpStatus(face.body.asset?.url)) === 200 && (await httpStatus(face.body.asset?.runtimeUrl)) === 200 && (await httpStatus(face.body.asset?.smallUrl)) === 200);
  r = await post(A, "/api/admin/cms/agents", { action: "save", id: AG, expectedVersion: 1, patch: { faceAssetId: face.body.asset?.id, fullAssetId: full.body.asset?.id, name: "QA F60 Editado" }, reason: "QA F60 arte + edición" });
  rec("agent", "asignar arte + editar", r.status === 200 && r.body.version === 2, r.body);
  const stale = await post(A, "/api/admin/cms/agents", { action: "save", id: AG, expectedVersion: 1, patch: { name: "Pisada" } });
  rec("agent", "concurrencia: versión vieja ⇒ 409", stale.status === 409);
  const det = await get(A, `/api/admin/cms/agents?id=${AG}`);
  rec("agent", "ficha: checklist completo (listo para publicar, NO se publica)", det.status === 200 && (det.body.checklist as { ok: boolean }[]).every((c) => c.ok));
  resetAgentCatalogCache();
  const cat = await loadAgentCatalog(sb);
  rec("agent", "borrador NO aparece en el runtime (cargador)", !!cat && !cat.agents.some((a) => a.id === AG) && cat.agents.length === 29);
  const pubRes = await publicContentHandlers(() => sb).agents(new Request("http://qa/api/content/agents"));
  const pubBody = await pubRes.json() as { agents: { id: string }[] };
  rec("agent", "borrador NO aparece en /api/content/agents", !pubBody.agents.some((a) => a.id === AG) && pubBody.agents.length === 29);
  const anon = await sb.storage.from("assets").getPublicUrl("x"); void anon;
  r = await post(A, "/api/admin/cms/agents", { action: "deleteDraft", id: AG, expectedVersion: 2, reason: "QA F60 limpieza", confirm: AG });
  rec("agent", "borrar borrador (sin referencias)", r.status === 200, r.body);

  // ════════════ CARTA ════════════
  const { data: cps } = await sb.from("content_players").select("id").eq("status", "active").order("id").limit(200);
  const { data: existing } = await sb.from("content_cards").select("card_id");
  const have = new Set(((existing ?? []) as { card_id: string }[]).map((x) => x.card_id));
  const player = ((cps ?? []) as { id: string }[]).map((p) => p.id).find((id) => !have.has(`${id}__moments`))!;
  const cardId = `${player}__moments`;
  const art = await upload("card_artwork", "qa-card.png", await img(750, 1048, "#ffd35c", false), { subjectId: cardId });
  rec("card", "subir arte de carta", art.status === 200, { status: art.status, err: art.body.error });
  if (art.body.asset) created.push(art.body.asset.id);
  const body = { playerId: player, variantId: "moments", role: "Flex", ovr: 77, stats: { dmg: 70, scr: 71, fks: 72, hs: 73, ast: 74, clu: 75 }, team: "QA", imageAssetId: art.body.asset?.id };
  const prev = await post(C, "/api/admin/cms/cards", { action: "preview", ...body });
  rec("card", "vista previa exacta (no escribe)", prev.status === 200 && prev.body.valid === true, { economy: prev.body.economy, err: prev.body.errors });
  r = await post(C, "/api/admin/cms/cards", { action: "create", ...body, reason: "QA F60 carta borrador" });
  rec("card", "crear BORRADOR atómico", r.status === 200 && r.body.lifecycle === "DRAFT", r.body);
  resetServerCatalog();
  const sc = await serverCatalog(sb);
  rec("card", "borrador fuera del catálogo público y de sobres", !sc.card(cardId));
  const cd = await get(C, `/api/admin/cms/cards?id=${encodeURIComponent(cardId)}`);
  rec("card", "ficha: imagen de Storage renderizable", cd.status === 200 && (await httpStatus((cd.body.card as { image?: string })?.image)) === 200, { image: (cd.body.card as { image?: string })?.image });
  r = await post(C, "/api/admin/cms/cards", { action: "deleteDraft", cardId, reason: "QA F60 limpieza", confirm: cardId, expectedRev: cd.body.presentationRev });
  rec("card", "borrar borrador sin historia", r.status === 200, r.body);

  // ════════════ SOBRE ════════════
  const PK = "cms-qa-f60";
  r = await post(P, "/api/admin/cms/packs", { action: "save", id: PK, patch: { name: "QA F60 Sobre", templatePackId: "estandar", description: "Prueba del CMS: no se publica." }, reason: "QA F60 sobre borrador" });
  rec("pack", "crear borrador (economía heredada de Bronce)", r.status === 200 && r.body.lifecycle === "DRAFT", r.body);
  r = await post(P, "/api/admin/cms/packs", { action: "ensurePool", id: PK });
  rec("pack", "pool de elegibilidad pack-<id> (DRAFT) enlazado", r.status === 200 && r.body.bound === true, r.body);
  const { data: someCards } = await sb.from("content_cards").select("card_id").eq("lifecycle", "PUBLISHED").eq("variant_id", "base").order("ordinal").limit(30);
  r = await post(P, "/api/admin/cms/packs", { action: "pool", id: PK, op: "add", cardIds: ((someCards ?? []) as { card_id: string }[]).map((c) => c.card_id), expectedRevision: r.body.revision, reason: "QA F60 pool" });
  rec("pack", "añadir 30 cartas (selección múltiple)", r.status === 200 && (r.body.entries as unknown[]).length === 30, { status: r.status, n: (r.body.entries as unknown[] | undefined)?.length, err: r.body.error });
  const packArt = await upload("pack_art", "qa-pack.png", await img(780, 1140, "#a78bfa"), { subjectId: PK });
  rec("pack", "subir arte del sobre", packArt.status === 200, { status: packArt.status, err: packArt.body.error });
  if (packArt.body.asset) created.push(packArt.body.asset.id);
  r = await post(P, "/api/admin/cms/packs", { action: "save", id: PK, expectedVersion: 1, patch: { artAssetId: packArt.body.asset?.id }, reason: "QA F60 arte" });
  rec("pack", "asignar arte", r.status === 200, r.body);
  const sim = await post(P, "/api/admin/cms/packs", { action: "simulate", id: PK, n: 2000 });
  rec("pack", "simulación de servidor (no escribe)", sim.status === 200, { summary: sim.body.summary, gate: sim.body.gate });
  resetPackCatalogCache();
  rec("pack", "borrador fuera del runtime (ni tienda ni apertura)", !(await loadPackCatalog(sb))!.some((d) => d.id === PK));
  const d = await get(P, `/api/admin/cms/packs?id=${PK}`);
  r = await post(P, "/api/admin/cms/packs", { action: "deleteDraft", id: PK, expectedVersion: (d.body.pack as { version: number }).version, reason: "QA F60 limpieza", confirm: PK });
  rec("pack", "borrar borrador + su pool dedicado", r.status === 200 && r.body.poolDeleted === true, r.body);

  // ════════════ ASSET: versionado y limpieza explícita ════════════
  const v1 = await upload("event_art", "qa-event.png", await img(1200, 600, "#3fc07a", false));
  const v2 = await upload("event_art", "qa-event-2.png", await img(1200, 600, "#ffd35c", false), { replaceOf: v1.body.asset?.id ?? "" });
  rec("asset", "subir + reemplazar = versión 2 del grupo", v1.status === 200 && v2.status === 200 && v2.body.asset?.version === 2);
  const dup = await upload("event_art", "qa-event-2-copia.png", await img(1200, 600, "#ffd35c", false));
  rec("asset", "duplicado ⇒ el mismo asset (idempotente)", dup.body.deduplicated === true && dup.body.asset?.id === v2.body.asset?.id);
  if (v1.body.asset) created.push(v1.body.asset.id); if (v2.body.asset) created.push(v2.body.asset.id);
  const orphans = await get(S, "/api/admin/cms/assets?orphan=1&pageSize=60");
  const orphanIds = new Set(((orphans.body.rows ?? []) as { id: string }[]).map((x) => x.id));
  rec("asset", "huérfanos detectados (todo lo QA quedó sin uso)", [face, full, art, packArt, v2].every((x) => x.body.asset && orphanIds.has(x.body.asset.id)));

  // Limpieza explícita de TODOS los assets QA (y comprobación de que Storage ya no los sirve)
  const urls: string[] = [];
  for (const id of [...new Set(created)]) {
    const det2 = await get(S, `/api/admin/cms/assets?id=${id}`);
    const a = det2.body.asset as { url?: string; runtimeUrl?: string; smallUrl?: string } | undefined;
    if (a) urls.push(...[a.url, a.runtimeUrl, a.smallUrl].filter((u): u is string => !!u));
    const del = await post(S, "/api/admin/cms/assets", { action: "deleteOrphan", id, reason: "QA F60 limpieza", confirm: id });
    rec("cleanup", `borrar asset ${id.slice(0, 8)}`, del.status === 200, del.body.error);
  }
  const gone = await Promise.all([...new Set(urls)].map(httpStatus));
  rec("cleanup", "Storage ya no sirve ningún fichero QA", gone.every((s) => s !== 200), gone);

  const after = await snapshotCounts();
  rec("cleanup", "sin residuos: recuentos iguales que antes", JSON.stringify(before) === JSON.stringify(after), { before, after });
  const leftovers = await Promise.all([
    sb.from("agents").select("id").eq("id", AG), sb.from("content_cards").select("card_id").eq("card_id", cardId),
    sb.from("content_packs").select("id").eq("id", PK), sb.from("content_pools").select("id").eq("id", `pack-${PK}`),
    sb.from("content_pack_pools").select("pack_id").eq("pack_id", PK),
  ]);
  rec("cleanup", "ni agente, ni carta, ni sobre, ni pool, ni enlace QA", leftovers.every((x) => (x.data ?? []).length === 0));
  const { count: audits } = await sb.from("content_audit_log").select("id", { count: "exact", head: true }).eq("actor", QA);
  rec("audit", "cada escritura QA quedó auditada con el actor QA (registro inmutable)", (audits ?? 0) >= 12, { rows: audits });

  writeFileSync(join(OUT, "prod-qa-lifecycles.json"), JSON.stringify({ at: new Date().toISOString(), actor: "cuenta QA (admin temporal)", steps, ok: steps.every((s) => s.ok) }, null, 1) + "\n");
  console.log(`FIN · ${steps.filter((s) => s.ok).length}/${steps.length}`);
})();
