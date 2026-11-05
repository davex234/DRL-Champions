/**
 * F60 · reglas PURAS del CMS: firmas y dimensiones de imagen, reglas por tipo de asset, puerta económica de sobres,
 * validación de agentes/cartas, registro vivo del roster y de sobres, sincronización del cliente y matriz de fuentes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { checkUpload, headerDimensions, sniffImage, safeDisplayName, cmsStoragePath, ASSET_RULES } from "./uploads";
import { packPublishGate, inheritedEconomy, packTemplates, packDefFromCms, validatePackDraft, suggestPackId, type CmsSimSummary, type CmsPackRow } from "./packs";
import { validateAgentDraft, agentPublishChecklist, defaultAgentCode, suggestAgentId } from "./agents";
import { validateCardDraft, economicClass } from "./cards";
import { SOURCE_MATRIX } from "./sourceMatrix";
import { applyRuntimeRoster, getTacticalAgent, isSelectableAgentId, isKnownAgentId, TACTICAL_AGENTS, getRosterVersion } from "@/domain/tactics/roster";
import { VALORANT_ROSTER } from "@/domain/tactics/valorantRoster";
import { AGENTS as ESPORTS_AGENTS } from "@/data/esports/agents";
import { agentName } from "@/importer-vlr/agents";
import { applyRuntimePacks, getPack, PACKS } from "@/data/packs";
import { packArtwork } from "@/data/packArtwork";
import { syncContent } from "@/components/layout/ContentSync";

const png = (w: number, h: number) => { const b = new Uint8Array(40); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
const jpeg = (w: number, h: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

test("FIRMAS · se detecta por BYTES (PNG/WEBP/JPEG/AVIF); texto, SVG y HTML no son imágenes", () => {
  assert.equal(sniffImage(png(10, 10)), "png");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF1234WEBPVP8 ")), "webp");
  assert.equal(sniffImage(jpeg(10, 10)), "jpeg");
  assert.equal(sniffImage(new Uint8Array([0, 0, 0, 28, ...new TextEncoder().encode("ftypavif")])), "avif");
  for (const t of ["<svg></svg>", "<!doctype html>", "GIF89a......", "hola"]) assert.equal(sniffImage(new TextEncoder().encode(t.padEnd(16))), null, t);
  assert.deepEqual(headerDimensions(png(352, 470), "png"), { width: 352, height: 470 });
  assert.deepEqual(headerDimensions(jpeg(640, 320), "jpeg"), { width: 640, height: 320 });
});

test("REGLAS DE SUBIDA · tamaño, doble extensión, MIME, formato por tipo, dimensiones y proporción", () => {
  assert.equal(checkUpload("agent_face", "cara.png", "image/png", png(256, 256)).ok, true);
  assert.equal(checkUpload("agent_face", "cara.png", "image/png", png(100, 100)).ok, false, "demasiado pequeña");
  assert.equal(checkUpload("agent_face", "cara.png", "image/png", png(256, 600)).ok, false, "proporción de cara");
  assert.equal(checkUpload("card_artwork", "c.jpg", "image/jpeg", jpeg(750, 1048)).ok, false, "las cartas sólo PNG/WEBP");
  assert.equal(checkUpload("pack_art", "a.PNG.exe", "image/png", png(400, 600)).ok, false);
  assert.equal(checkUpload("pack_art", "a.svg.png", "image/png", png(400, 600)).ok, false, "doble extensión peligrosa");
  assert.equal(checkUpload("pack_art", "a.jpg", "image/jpeg", png(400, 600)).ok, false, "extensión ≠ contenido");
  assert.equal(checkUpload("pack_art", "a.png", "text/html", png(400, 600)).ok, false, "MIME ≠ contenido");
  assert.equal(checkUpload("pack_art", "a.png", "image/png", new Uint8Array(ASSET_RULES.pack_art.maxBytes + 1)).ok, false, "pesa demasiado");
  assert.equal(checkUpload("pack_art", "a.png", "image/png", new Uint8Array(0)).ok, false, "vacío");
  assert.equal(safeDisplayName("../../x<script>.png"), "xscript.png", "sin rutas ni < >");
  assert.equal(cmsStoragePath("agent_face", "11111111-1111-4111-8111-111111111111", "w96", "webp"), "cms/agent_face/11111111-1111-4111-8111-111111111111/w96.webp");
});

test("PUERTA ECONÓMICA · usa los invariantes EXISTENTES: liquidación < 70 %, sin dominar la banda, sin clases vacías", () => {
  const band = { lo: 0.9, hi: 1.1 };
  const base: CmsSimSummary = { n: 3000, seed: "s", ev: 1000, evOverPrice: 1.0, salvageEV: 60, salvageOverPrice: 0.06, classes: {}, ovr: { p10: 70, p50: 75, p90: 80, max: 90 }, primePct: 0, iconPct: 0, eligibleCards: 40, poolKey: "k", error: null, at: "" };
  assert.equal(packPublishGate(base, band, "estandar").ok, true);
  assert.equal(packPublishGate({ ...base, evOverPrice: 1.3 }, band, "estandar").ok, false, "dominaría la línea principal");
  assert.equal(packPublishGate({ ...base, evOverPrice: 1.3 }, band, "icon").ok, true, "como el propio Icon");
  assert.equal(packPublishGate({ ...base, salvageOverPrice: 0.7 }, band, "estandar").ok, false, "bucle de liquidación");
  assert.equal(packPublishGate({ ...base, error: "clase vacía" }, band, "estandar").ok, false);
  assert.equal(packPublishGate({ ...base, eligibleCards: 0 }, band, "estandar").ok, false);
  assert.equal(packPublishGate(null, band, "estandar").ok, false);
});

test("SOBRES · la economía la pone la plantilla (sobres de código activos y de pago); ids cms-…", () => {
  const t = packTemplates();
  assert.ok(t.length > 5 && t.every((p) => p.price > 0 && !p.cms));
  assert.ok(!t.some((p) => p.id === "inicial" || p.lifecycle === "DRAFT"));
  assert.deepEqual(inheritedEconomy("premium"), { price: getPack("premium")!.price, cardCount: getPack("premium")!.cardCount });
  assert.equal(inheritedEconomy("no-existe"), null);
  assert.equal(suggestPackId("Sobre Épico de Prueba"), "cms-sobre-epico-de-prueba");
  assert.ok(validatePackDraft({ id: "estandar", name: "Xxx", templatePackId: "estandar" }, { creating: true }).id, "no se reutiliza un id de código");
  assert.ok(validatePackDraft({ id: "cms-ok", name: "<img src=x onerror=alert(1)>", templatePackId: "estandar" }, { creating: true }).name, "XSS en el nombre");
});

test("REGISTRO DE SOBRES · sólo entran sobres cms- ACTIVE/RETIRED; los de código no se tocan; el arte sale del propio sobre", () => {
  const codeCount = PACKS.length;
  const row = (id: string, lifecycle: CmsPackRow["lifecycle"]): CmsPackRow => ({ id, name: "Prueba", description: "", template_pack_id: "premium", price: 2500, card_count: 5, art_asset_id: null, accent: null, lifecycle, available_from: null, available_to: null, sim_summary: null, version: 1, created_at: "", updated_at: "", published_at: null, retired_at: null });
  const draft = packDefFromCms(row("cms-draft", "DRAFT"), "http://x/a.webp")!;
  const live = packDefFromCms(row("cms-live", "ACTIVE"), "http://x/b.webp")!;
  const hijack = { ...live, id: "estandar" };
  applyRuntimePacks([draft, live, hijack]);
  assert.equal(PACKS.length, codeCount + 1, "ni borradores ni suplantar un sobre de código");
  assert.equal(getPack("cms-draft"), undefined);
  assert.equal(packArtwork("cms-live"), "http://x/b.webp");
  assert.equal(getPack("estandar")!.cms, undefined);
  applyRuntimePacks([]);
  assert.equal(PACKS.length, codeCount);
});

test("AGENTES · validación (XSS, id, legado, habilidades) y lista de publicación (arte obligatorio sólo para altas del panel)", () => {
  assert.ok(validateAgentDraft({ id: "Mal Id", name: "X", role: "duelist" }, { creating: true }).id);
  assert.ok(validateAgentDraft({ id: "haze", name: "Haze", role: "controller" }, { creating: true }).id, "id del modelo anterior");
  assert.ok(validateAgentDraft({ id: "nuevo", name: "<img>", role: "duelist" }, { creating: true }).name);
  assert.deepEqual(validateAgentDraft({ id: "nuevo", name: "Nuevo", role: "sentinel", abilities: [{ slot: "C", name: "Aa" }, { slot: "Q", name: "Bb" }, { slot: "E", name: "Cc" }, { slot: "X", name: "Dd" }] }, { creating: true }), {});
  assert.equal(defaultAgentCode("KAY/O"), "KAY"); assert.equal(suggestAgentId("KAY/O"), "kayo");
  const rec = { id: "nnn", name: "Nnn", role: "duelist", code: "NNN", abilities: [{ slot: "C", name: "Aa" }, { slot: "Q", name: "Bb" }, { slot: "E", name: "Cc" }, { slot: "X", name: "Dd" }], lifecycle: "DRAFT" as const, origin: "admin" as const, faceAssetId: null, fullAssetId: null, version: 1 };
  assert.equal(agentPublishChecklist(rec).every((c) => c.ok), false);
  assert.equal(agentPublishChecklist({ ...rec, origin: "seed" }).every((c) => c.ok), true, "los 29 usan el arte estático de F59");
});

test("ROSTER VIVO · añade publicados, retira sin perder el histórico, nunca se vacía por una red caída", () => {
  const snap = VALORANT_ROSTER.map((r) => ({ ...r, lifecycle: "PUBLISHED" as const }));
  const v0 = getRosterVersion();
  assert.equal(applyRuntimeRoster([]), false, "lista vacía ⇒ se ignora");
  assert.equal(applyRuntimeRoster(snap.map((r) => ({ ...r, lifecycle: "RETIRED" as const }))), false, "sin ningún publicado ⇒ se ignora");
  assert.equal(TACTICAL_AGENTS.length, 29);
  const nuevo = { id: "nuevoqa", name: "Nuevo QA", code: "NQA", role: "duelist" as const, uuid: "", abilities: [{ slot: "C" as const, name: "a1" }, { slot: "Q" as const, name: "a2" }, { slot: "E" as const, name: "a3" }, { slot: "X" as const, name: "a4" }], lifecycle: "PUBLISHED" as const };
  assert.ok(applyRuntimeRoster([...snap.map((r) => (r.id === "jett" ? { ...r, lifecycle: "RETIRED" as const } : r)), nuevo]));
  assert.ok(getRosterVersion() > v0);
  assert.ok(isSelectableAgentId("nuevoqa")); assert.equal(isSelectableAgentId("jett"), false);
  assert.equal(getTacticalAgent("jett")?.name, "Jett"); assert.ok(isKnownAgentId("jett"), "lo guardado con Jett se conserva");
  applyRuntimeRoster(snap);
  assert.equal(TACTICAL_AGENTS.length, 29); assert.ok(isSelectableAgentId("jett"));
});

test("UNA SOLA FUENTE · espejo esports e importador VLR se DERIVAN de la instantánea (ya no hay listas a mano)", () => {
  assert.deepEqual(ESPORTS_AGENTS.map((a) => a.id).sort(), VALORANT_ROSTER.map((r) => r.id).sort());
  for (const r of VALORANT_ROSTER) assert.equal(agentName(r.id), r.name);
});

test("CLIENTE · la sincronización aplica agentes y sobres publicados, y un fallo de red no rompe nada", async () => {
  const snap = VALORANT_ROSTER.map((r) => ({ id: r.id, name: r.name, role: r.role, code: r.code, abilities: r.abilities, lifecycle: "PUBLISHED", face: null, full: null }));
  const fetcher = (async (url: string) => new Response(JSON.stringify(url.includes("agents") ? { version: 7, agents: snap } : { packs: [] }), { status: 200 })) as unknown as typeof fetch;
  await syncContent(fetcher);
  assert.equal(TACTICAL_AGENTS.length, 29);
  const failing = (async () => { throw new Error("red"); }) as unknown as typeof fetch;
  await syncContent(failing);
  assert.equal(TACTICAL_AGENTS.length, 29, "sin red: la instantánea sigue");
});

test("CARTAS · validación del asistente y clase económica DERIVADA (no editable)", () => {
  const ok = { playerId: "leaf", variantId: "champions-s", role: "Flex", ovr: 90, stats: { dmg: 90, scr: 90, fks: 90, hs: 90, ast: 90, clu: 90 }, team: "G2", imageAssetId: "a" };
  assert.deepEqual(validateCardDraft(ok, { requireArt: true }), {});
  assert.ok(validateCardDraft({ ...ok, variantId: "base-plus" }, { requireArt: true }).variantId, "sólo ediciones diseñadas");
  assert.ok(validateCardDraft({ ...ok, ovr: 120 }, { requireArt: true }).ovr);
  assert.ok(validateCardDraft({ ...ok, team: "<script>" }, { requireArt: true }).team);
  assert.ok(validateCardDraft({ ...ok, imageAssetId: null }, { requireArt: true }).imageAssetId);
  const e = economicClass({ variantId: "champions-s", ovr: 90 });
  assert.equal(e.packClass, "champions"); assert.ok(e.marketValue > 0 && e.salvageValue < e.marketValue);
});

test("MATRIZ · economía, flags y roles NUNCA editables desde el CMS; el contenido sí", () => {
  for (const r of SOURCE_MATRIX) {
    if (r.dataClass === "GAME_RULE" || r.dataClass === "SECURITY_RULE") assert.equal(r.adminEdit || r.adminCreate, false, r.entity);
  }
  for (const e of ["Agentes", "Cartas", "Sobres (panel)", "Jugadores (catálogo)", "Assets", "Eventos"]) {
    const r = SOURCE_MATRIX.find((x) => x.entity === e)!;
    assert.ok(r.adminCreate && r.adminEdit && r.adminRetire, e);
  }
});
