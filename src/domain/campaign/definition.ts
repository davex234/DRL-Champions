/**
 * VALIDACIÓN DE LA DEFINICIÓN (Fase 35). Pura y determinista.
 *
 * Una definición que no pasa esto no se sirve: el servicio responde «no disponible» antes que enseñar un mapa
 * con nodos que no se pueden jugar o que pagan lo que no toca.
 */
import { resolveTeamIdentity, teamIdentityById } from "@/data/teamIdentities";
import { cardTierFor, expectedTier } from "./difficulty";
import { FIRST_CLEAR_CREDITS, CAMPAIGN_FIRST_CLEAR_CAP, campaignRewardTotal } from "./rewards";
import type { CampaignDefinition, CampaignNodeDef, CardTier } from "./types";

export const CAMPAIGN_CHAPTERS = 3;
export const CAMPAIGN_NODES_MIN = 12;
export const CAMPAIGN_NODES_MAX = 18;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const VERSION = /^[a-z]{2,8}-[0-9]{1,4}$/;
const NODE_ID = /^c[0-9]{1,2}-n[0-9]{1,2}$/;

export type CampaignIssueCode =
  | "BAD_ID" | "BAD_VERSION" | "CHAPTER_COUNT" | "NODE_COUNT" | "DUPLICATE_CHAPTER" | "DUPLICATE_NODE"
  | "BAD_ORDER" | "CHAPTER_MISMATCH" | "UNKNOWN_REF" | "ASYMMETRIC_LINK" | "NO_ENTRY" | "MULTIPLE_ENTRY"
  | "CYCLE" | "UNREACHABLE" | "BAD_BOSS" | "BAD_DIFFICULTY" | "BAD_REWARD" | "REWARD_CAP"
  | "UNKNOWN_TEAM" | "UNVERIFIED_TEAM" | "NO_CURRENT_ROSTER" | "DUPLICATE_OPPONENT";

export interface CampaignIssue { code: CampaignIssueCode; ref: string }

export function allNodes(def: CampaignDefinition): CampaignNodeDef[] {
  return [...def.chapters].sort((a, b) => a.order - b.order)
    .flatMap((c) => [...c.nodes].sort((a, b) => a.order - b.order));
}

export function findNode(def: CampaignDefinition, nodeId: string): { node: CampaignNodeDef; chapterOrder: number; chapterName: string } | null {
  for (const c of def.chapters) {
    const node = c.nodes.find((n) => n.id === nodeId);
    if (node) return { node, chapterOrder: c.order, chapterName: c.name };
  }
  return null;
}

export function nodeCardTier(def: CampaignDefinition, nodeId: string): CardTier | null {
  const f = findNode(def, nodeId);
  return f ? cardTierFor(f.chapterOrder, f.node.type) : null;
}

export function validateCampaign(def: CampaignDefinition): { ok: boolean; issues: CampaignIssue[] } {
  const issues: CampaignIssue[] = [];
  const add = (code: CampaignIssueCode, ref: string) => issues.push({ code, ref });

  if (!SLUG.test(def.campaignId)) add("BAD_ID", def.campaignId);
  if (!VERSION.test(def.version)) add("BAD_VERSION", def.version);
  if (def.chapters.length !== CAMPAIGN_CHAPTERS) add("CHAPTER_COUNT", String(def.chapters.length));

  const chapterIds = new Set<string>();
  const chapterOrders = def.chapters.map((c) => c.order).sort((a, b) => a - b);
  chapterOrders.forEach((o, i) => { if (o !== i + 1) add("BAD_ORDER", `chapter:${o}`); });

  const byId = new Map<string, CampaignNodeDef>();
  const chapterOf = new Map<string, number>();
  for (const c of def.chapters) {
    if (!SLUG.test(c.id) || chapterIds.has(c.id)) add(chapterIds.has(c.id) ? "DUPLICATE_CHAPTER" : "BAD_ID", c.id);
    chapterIds.add(c.id);
    const orders = c.nodes.map((n) => n.order).sort((a, b) => a - b);
    orders.forEach((o, i) => { if (o !== i + 1) add("BAD_ORDER", `${c.id}:${o}`); });
    const bosses = c.nodes.filter((n) => n.type === "BOSS");
    const last = [...c.nodes].sort((a, b) => b.order - a.order)[0];
    if (bosses.length !== 1 || !last || last.type !== "BOSS") add("BAD_BOSS", c.id);
    for (const n of c.nodes) {
      if (!NODE_ID.test(n.id)) add("BAD_ID", n.id);
      if (byId.has(n.id)) add("DUPLICATE_NODE", n.id);
      byId.set(n.id, n);
      chapterOf.set(n.id, c.order);
      if (n.chapterId !== c.id) add("CHAPTER_MISMATCH", n.id);
      if (n.difficulty !== expectedTier(c.order, n.type)) add("BAD_DIFFICULTY", n.id);
      if (n.rewards.firstClear.credits !== FIRST_CLEAR_CREDITS[n.type]) add("BAD_REWARD", n.id);
    }
  }

  const total = byId.size;
  if (total < CAMPAIGN_NODES_MIN || total > CAMPAIGN_NODES_MAX) add("NODE_COUNT", String(total));
  if (campaignRewardTotal(def) > CAMPAIGN_FIRST_CLEAR_CAP) add("REWARD_CAP", String(campaignRewardTotal(def)));

  // Enlaces: existen y son simétricos (A exige B ⇔ B abre A).
  for (const n of byId.values()) {
    for (const r of n.requirements.completed) {
      const req = byId.get(r);
      if (!req) add("UNKNOWN_REF", `${n.id}<-${r}`);
      else if (!req.nextNodes.includes(n.id)) add("ASYMMETRIC_LINK", `${r}->${n.id}`);
    }
    for (const x of n.nextNodes) {
      const nx = byId.get(x);
      if (!nx) add("UNKNOWN_REF", `${n.id}->${x}`);
      else if (!nx.requirements.completed.includes(n.id)) add("ASYMMETRIC_LINK", `${n.id}->${x}`);
    }
  }

  const entries = [...byId.values()].filter((n) => n.requirements.completed.length === 0);
  if (entries.length === 0) add("NO_ENTRY", def.campaignId);
  if (entries.length > 1) add("MULTIPLE_ENTRY", entries.map((e) => e.id).join(","));

  // Ciclos (DFS con colores) y alcanzabilidad desde la entrada.
  const color = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): void => {
    color.set(id, 1);
    for (const x of byId.get(id)?.nextNodes ?? []) {
      if (!byId.has(x)) continue;
      const c = color.get(x) ?? 0;
      if (c === 1) add("CYCLE", `${id}->${x}`);
      else if (c === 0) visit(x);
    }
    color.set(id, 2);
  };
  if (entries[0]) visit(entries[0].id);
  for (const id of byId.keys()) if (!color.has(id)) add("UNREACHABLE", id);

  // Rivales reales: identidad existente, verificada, con roster actual; sin repetir equipo.
  const teams = new Set<string>();
  for (const n of byId.values()) {
    const id = teamIdentityById(n.opponent.teamId);
    if (!id) { add("UNKNOWN_TEAM", `${n.id}:${n.opponent.teamId}`); continue; }
    if (id.status !== "verified") add("UNVERIFIED_TEAM", `${n.id}:${id.canonicalId}`);
    // El roster actual tiene que resolver SIN ambigüedad a esta identidad (nunca se fusionan equipos ambiguos).
    if (!id.currentAliases.some((a) => resolveTeamIdentity(a)?.canonicalId === id.canonicalId)) add("NO_CURRENT_ROSTER", `${n.id}:${id.canonicalId}`);
    if (teams.has(id.canonicalId)) add("DUPLICATE_OPPONENT", `${n.id}:${id.canonicalId}`);
    teams.add(id.canonicalId);
  }

  return { ok: issues.length === 0, issues };
}
