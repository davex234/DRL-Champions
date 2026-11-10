/**
 * F60 · SALUD DEL CONTENIDO — lo que /admin/system y el dashboard afirman del contenido, medido contra el ESTADO REAL.
 *
 * Generaliza lo que F59.1 hizo con los agentes («no basta con que exista la migración»): cada comprobación lee las
 * tablas y cruza referencias de verdad. Nada se infiere del código salvo lo que el código ES (sobres de código,
 * instantánea del roster). Una referencia rota es CRITICAL: el GO de F60 exige cero.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HealthCheck } from "@/domain/admin/packAdmin";
import { worstLevel } from "@/domain/admin/packAdmin";
import { PACKS } from "@/data/packs";
import { CARDS } from "@/data/catalog";
import { VALORANT_ROSTER } from "@/domain/tactics/valorantRoster";
import { AGENTS as LEGACY_GAME_AGENTS } from "@/agents/catalog";
import { assetUsage } from "./assets";
import { CMS_ASSET_KINDS } from "@/domain/cms/uploads";
import { packPublishGate, type CmsPackRow } from "@/domain/cms/packs";
import { mainBand } from "@/domain/admin/packAdmin";

export interface ContentSummary {
  agents: { total: number; published: number; draft: number; retired: number };
  cards: { total: number; published: number; draft: number; retired: number; cms: number };
  players: { total: number; active: number };
  teams: number;
  packs: { code: number; cms: number; cmsActive: number; cmsDraft: number; cmsRetired: number };
  events: number;
  assets: { total: number; orphans: number };
  drafts: number;
  brokenReferences: number;
  missingArtwork: number;
  retired: number;
}

export interface ContentHealth { checks: HealthCheck[]; summary: ContentSummary; broken: string[]; overall: HealthCheck["level"] }

const count = (r: { count?: number | null } | null | undefined) => r?.count ?? 0;

export async function contentHealth(sb: SupabaseClient, teamsCount: number): Promise<ContentHealth> {
  const checks: HealthCheck[] = [];
  const broken: string[] = [];

  const [ag, cc, pl, cp, bindings, up, ev, assets, orphans, comps] = await Promise.all([
    sb.from("agents").select("id, name, role, code, abilities, lifecycle, origin, face_asset_id, full_asset_id"),
    sb.from("content_cards").select("card_id, lifecycle, origin, presentation"),
    sb.from("content_players").select("id, status"),
    sb.from("content_packs").select("*"),
    sb.from("content_pack_pools").select("pack_id, pool_id, enabled"),
    sb.from("user_packs").select("pack_id, qty"),
    sb.from("events").select("id", { count: "exact", head: true }),
    sb.from("assets").select("id, kind, status, is_current, storage_path").in("kind", CMS_ASSET_KINDS),
    sb.from("v_content_card_orphans").select("card_id, refs"),
    sb.from("user_compositions").select("agent_ids"),
  ]);

  // ── Agentes ──
  type A = { id: string; name: string; role: string; code: string | null; abilities: unknown[] | null; lifecycle: string; origin: string; face_asset_id: string | null; full_asset_id: string | null };
  const agents = (ag.data ?? []) as A[];
  const pubAgents = agents.filter((a) => a.lifecycle === "PUBLISHED");
  const incomplete = pubAgents.filter((a) => !a.code || (a.abilities ?? []).length !== 4);
  const assetRows = (assets.data ?? []) as { id: string; kind: string; status: string; is_current: boolean; storage_path: string | null }[];
  const assetOk = new Map(assetRows.map((a) => [a.id, a.status === "approved" && !!a.storage_path]));
  const noArt = agents.filter((a) => a.lifecycle !== "DRAFT" && a.origin === "admin" && (!a.face_asset_id || !a.full_asset_id));
  const badArt = agents.filter((a) => [a.face_asset_id, a.full_asset_id].some((x) => x && assetOk.get(x) !== true));
  for (const a of [...incomplete, ...badArt]) broken.push(`agent:${a.id}`);
  const snapIds = new Set(VALORANT_ROSTER.map((r) => r.id));
  const pubIds = new Set(pubAgents.map((a) => a.id));
  const diverge = [...pubIds].filter((id) => !snapIds.has(id)).concat([...snapIds].filter((id) => !pubIds.has(id)));
  checks.push({
    id: "content-agents", label: "Agentes (contenido)",
    level: ag.error ? "WARNING" : incomplete.length || badArt.length || noArt.length ? "CRITICAL" : diverge.length ? "WARNING" : "HEALTHY",
    detail: ag.error ? "No se pudo leer public.agents"
      : incomplete.length ? `Publicados incompletos: ${incomplete.map((a) => a.id).join(", ")}`
        : badArt.length || noArt.length ? `Arte roto o ausente: ${[...badArt, ...noArt].map((a) => a.id).join(", ")}`
          : diverge.length ? `La instantánea del roster no coincide con la BD (${diverge.join(", ")}); el juego usa la BD. Regenerar con npm run agents:snapshot`
            : `${pubAgents.length} publicados, completos y con arte`,
  });

  // ── Cartas ──
  type C = { card_id: string; lifecycle: string; origin: string; presentation: { imageAssetId?: string; imagePath?: string; printed?: unknown } | null };
  const cards = (cc.data ?? []) as C[];
  const cmsCards = cards.filter((c) => c.origin === "admin");
  const liveCms = cmsCards.filter((c) => c.lifecycle === "PUBLISHED" || c.lifecycle === "RETIRED");
  const brokenCards = liveCms.filter((c) => !c.presentation?.printed || !c.presentation?.imagePath || !c.presentation.imageAssetId || assetOk.get(c.presentation.imageAssetId) !== true);
  for (const c of brokenCards) broken.push(`card:${c.card_id}`);
  const seedCount = cards.filter((c) => c.origin !== "admin").length;
  const orphanRefs = ((orphans.data ?? []) as { card_id: string; refs: number }[]);
  for (const o of orphanRefs) broken.push(`card-ref:${o.card_id}`);
  checks.push({
    id: "content-cards", label: "Cartas (contenido)",
    level: cc.error ? "WARNING" : brokenCards.length || orphanRefs.length ? "CRITICAL" : seedCount !== CARDS.length ? "WARNING" : "HEALTHY",
    detail: cc.error ? "No se pudo leer content_cards"
      : brokenCards.length ? `Cartas del panel publicadas sin arte o sin lo impreso: ${brokenCards.map((c) => c.card_id).join(", ")}`
        : orphanRefs.length ? `Ejemplares que apuntan a cartas inexistentes: ${orphanRefs.length}`
          : `${seedCount} del catálogo diseñado (código: ${CARDS.length}) · ${cmsCards.length} del panel (${liveCms.length} en juego)`,
  });

  // ── Sobres ──
  const cmsPacks = (cp.data ?? []) as CmsPackRow[];
  const packIds = new Set([...PACKS.filter((p) => !p.cms).map((p) => p.id), ...cmsPacks.map((p) => p.id)]);
  const binds = (bindings.data ?? []) as { pack_id: string; pool_id: string; enabled: boolean }[];
  const band = mainBand();
  const livePacks = cmsPacks.filter((p) => p.lifecycle !== "DRAFT");
  const packProblems = livePacks.filter((p) => !p.art_asset_id || assetOk.get(p.art_asset_id) !== true || !binds.some((b) => b.pack_id === p.id && b.enabled)
    || !PACKS.some((t) => t.id === p.template_pack_id && !t.cms));
  const gateWarn = cmsPacks.filter((p) => p.lifecycle === "ACTIVE" && !packPublishGate(p.sim_summary, band, p.template_pack_id).ok);
  for (const p of packProblems) broken.push(`pack:${p.id}`);
  const unknownBindings = binds.filter((b) => !packIds.has(b.pack_id));
  for (const b of unknownBindings) broken.push(`pool-binding:${b.pack_id}`);
  const unknownInventory = ((up.data ?? []) as { pack_id: string; qty: number }[]).filter((r) => !packIds.has(r.pack_id));
  for (const r of unknownInventory) broken.push(`inventory:${r.pack_id}`);
  checks.push({
    id: "content-packs", label: "Sobres (contenido)",
    level: cp.error ? "WARNING" : packProblems.length || unknownBindings.length || unknownInventory.length ? "CRITICAL" : gateWarn.length ? "WARNING" : "HEALTHY",
    detail: cp.error ? "No se pudo leer content_packs"
      : packProblems.length ? `Sobres del panel publicados incompletos (arte/pool/plantilla): ${packProblems.map((p) => p.id).join(", ")}`
        : unknownBindings.length || unknownInventory.length ? `Referencias a sobres inexistentes: pools ${unknownBindings.length}, inventario ${unknownInventory.length}`
          : gateWarn.length ? `Publicados fuera de la puerta económica: ${gateWarn.map((p) => p.id).join(", ")}`
            : `${PACKS.filter((p) => !p.cms).length} de código · ${cmsPacks.length} del panel (${cmsPacks.filter((p) => p.lifecycle === "ACTIVE").length} activos)`,
  });

  // ── Composiciones que apuntan a agentes inexistentes (dato de usuario: aviso, no se toca) ──
  const knownAgents = new Set([...agents.map((a) => a.id), ...LEGACY_GAME_AGENTS.map((a) => a.id)]);
  const badComps = ((comps.data ?? []) as { agent_ids: string[] | null }[]).filter((c) => (c.agent_ids ?? []).some((id) => !knownAgents.has(id)));
  for (let i = 0; i < badComps.length; i++) broken.push("composition:unknown-agent");

  // ── Assets ──
  const use = await assetUsage(sb);
  const orphanAssets = assetRows.filter((a) => a.is_current && a.status === "approved" && !(use.get(a.id) ?? []).length);
  const referencedMissing = [...use.keys()].filter((id) => assetOk.get(id) !== true);
  for (const id of referencedMissing) broken.push(`asset:${id}`);
  checks.push({
    id: "content-assets", label: "Assets (contenido)",
    level: assets.error ? "WARNING" : referencedMissing.length ? "CRITICAL" : orphanAssets.length ? "WARNING" : "HEALTHY",
    detail: assets.error ? "No se pudieron leer los assets"
      : referencedMissing.length ? `Contenido que apunta a assets inexistentes o no aprobados: ${referencedMissing.length}`
        : orphanAssets.length ? `${orphanAssets.length} huérfanos (sin uso): revisar en /admin/assets; no se borran solos`
          : `${assetRows.length} assets del CMS, todos en uso`,
  });
  checks.push({
    id: "content-references", label: "Referencias rotas", level: broken.length ? "CRITICAL" : "HEALTHY",
    detail: broken.length ? `${broken.length}: ${[...new Set(broken)].slice(0, 8).join(", ")}` : "0 referencias rotas",
  });

  const players = (pl.data ?? []) as { id: string; status: string }[];
  const summary: ContentSummary = {
    agents: { total: agents.length, published: pubAgents.length, draft: agents.filter((a) => a.lifecycle === "DRAFT").length, retired: agents.filter((a) => a.lifecycle === "RETIRED").length },
    cards: { total: cards.length, published: cards.filter((c) => c.lifecycle === "PUBLISHED").length, draft: cards.filter((c) => ["DRAFT", "REVIEW", "APPROVED"].includes(c.lifecycle)).length, retired: cards.filter((c) => c.lifecycle === "RETIRED").length, cms: cmsCards.length },
    players: { total: players.length, active: players.filter((p) => p.status === "active").length },
    teams: teamsCount,
    packs: { code: PACKS.filter((p) => !p.cms).length, cms: cmsPacks.length, cmsActive: cmsPacks.filter((p) => p.lifecycle === "ACTIVE").length, cmsDraft: cmsPacks.filter((p) => p.lifecycle === "DRAFT").length, cmsRetired: cmsPacks.filter((p) => p.lifecycle === "RETIRED").length },
    events: count(ev as { count?: number | null }),
    assets: { total: assetRows.length, orphans: orphanAssets.length },
    drafts: agents.filter((a) => a.lifecycle === "DRAFT").length + cmsCards.filter((c) => ["DRAFT", "REVIEW", "APPROVED"].includes(c.lifecycle)).length + cmsPacks.filter((p) => p.lifecycle === "DRAFT").length,
    brokenReferences: new Set(broken).size,
    missingArtwork: noArt.length + cmsPacks.filter((p) => !p.art_asset_id).length,
    retired: agents.filter((a) => a.lifecycle === "RETIRED").length + cards.filter((c) => c.lifecycle === "RETIRED").length + cmsPacks.filter((p) => p.lifecycle === "RETIRED").length,
  };
  return { checks, summary, broken: [...new Set(broken)], overall: worstLevel(checks) };
}
