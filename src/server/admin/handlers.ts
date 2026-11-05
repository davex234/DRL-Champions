/**
 * F58 · HANDLERS DE LAS RUTAS DEL CONTROL CENTER.
 *
 * Cada función devuelve `{ GET?, POST? }` y recibe las dependencias (`AdminDeps`): las rutas de `app/api/admin/*` los
 * montan con las reales y las pruebas con un verificador falso + `MemSupabase`. Ningún handler lee un `userId` del
 * cuerpo como identidad del actor: el actor SIEMPRE es `ctx.userId` (sale de `verifyAdmin`).
 */
import type { NextResponse } from "next/server";
import { json, readBody, respond, runAdmin, fail, type AdminDeps } from "./http";
import { listAudit } from "./audit";
import { issueSanction, listSanctions, revokeSanction } from "./moderation";
import { adjustCredits, grant, parseGrant, searchUsers, user360 } from "./users";
import { cancelEventDraft, createEventDraft, eventDetail, listEvents, publishEvent, setEventImage, updateEventDraft } from "./events";
import { competitiveView, dashboard, globalSearch, importDryRun, listPlayers, packsList, playerDetail, rewardsView, seasonsDetail, systemView, teamDetail, teamsView } from "./overview";
import { parseSanctionInput } from "@/domain/admin/sanctions";
import { parseCreditAdjust } from "@/domain/admin/credits";
import { eventRewardsPreview, parseEventDraft } from "@/domain/admin/events";
import { drawSourceOf, economyHealth, mainBand, packRows, parseWhatIf, whatIf, type PackBinding } from "@/domain/admin/packAdmin";
import { getPack } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { CARDS } from "@/data/catalog";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import { PACK_CLASS_ORDER, packCardClass, mainPackDistribution } from "@/domain/packs/packClass";
import { packOddsFor } from "@/domain/packs/odds";
import { packLifecycle, isPurchasable } from "@/domain/packs/lifecycle";

type H = (req: Request) => Promise<NextResponse>;
const qp = (req: Request, k: string) => new URL(req.url).searchParams.get(k) ?? undefined;
const qn = (req: Request, k: string) => { const v = Number(qp(req, k)); return Number.isFinite(v) ? v : undefined; };

export function dashboardHandlers(deps: AdminDeps): { GET: H } {
  return { GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => respond(await dashboard(sb))) };
}

export function searchHandlers(deps: AdminDeps): { GET: H } {
  return { GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => respond(await globalSearch(sb, qp(req, "q") ?? ""))) };
}

export function usersHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => {
      const id = qp(req, "id");
      if (id) return respond(await user360(sb, id));
      return respond(await searchUsers(sb, qp(req, "q") ?? "", qn(req, "page") ?? 1, qn(req, "pageSize") ?? 25));
    }),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "userId", "direction", "amount", "reason", "expectedBalance", "ref", "kind", "packId", "count", "cardId"]);
      if (!r.ok) return r.res;
      const { action } = r.body;
      if (action === "adjust_credits") {
        const p = parseCreditAdjust(r.body);
        if (!p.ok) return json({ error: p.error }, 400);
        return respond(await adjustCredits(sb, userId, p.value));
      }
      if (action === "grant") {
        const p = parseGrant(r.body);
        if (!p.ok) return json({ error: p.error }, 400);
        return respond(await grant(sb, userId, p.value));
      }
      return json({ error: "Acción desconocida" }, 400);
    }),
  };
}

export function moderationHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) =>
      respond(await listSanctions(sb, { userId: qp(req, "userId"), status: qp(req, "status"), page: qn(req, "page"), pageSize: qn(req, "pageSize") }))),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "userId", "type", "reason", "hours", "sanctionId"]);
      if (!r.ok) return r.res;
      if (r.body.action === "sanction") {
        const p = parseSanctionInput(r.body);
        if (!p.ok) return json({ error: p.error }, 400);
        return respond(await issueSanction(sb, userId, p.value));
      }
      if (r.body.action === "revoke") return respond(await revokeSanction(sb, userId, r.body.sanctionId, r.body.reason));
      return json({ error: "Acción desconocida" }, 400);
    }),
  };
}

export function eventsHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => {
      const id = qp(req, "id");
      return id ? respond(await eventDetail(sb, id)) : respond(await listEvents(sb));
    }),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "id", "name", "description", "imageUrl", "imageAssetId", "type", "region", "startsAt", "endsAt", "expectedUpdatedAt", "reason"]);
      if (!r.ok) return r.res;
      const { action } = r.body;
      if (action === "preview") {
        const p = parseEventDraft(r.body, Date.now());
        if (!p.ok) return json({ error: p.error }, 400);
        return json({ draft: p.value, rewards: eventRewardsPreview(p.value.type, p.value.region) });
      }
      if (action === "create" || action === "update") {
        const p = parseEventDraft(r.body, Date.now());
        if (!p.ok) return json({ error: p.error }, 400);
        return respond(action === "create" ? await createEventDraft(sb, userId, p.value) : await updateEventDraft(sb, userId, r.body.id, p.value, r.body.expectedUpdatedAt));
      }
      if (action === "cancel") return respond(await cancelEventDraft(sb, userId, r.body.id, r.body.reason));
      if (action === "publish") return respond(await publishEvent(sb, userId, r.body.id, r.body.expectedUpdatedAt));
      if (action === "setImage") return respond(await setEventImage(sb, userId, r.body.id, r.body.imageAssetId ?? null, r.body.expectedUpdatedAt));
      return json({ error: "Acción desconocida" }, 400);
    }),
  };
}

export function auditHandlers(deps: AdminDeps): { GET: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => respond(await listAudit(sb, {
      actor: qp(req, "actor"), action: qp(req, "action"), entityType: qp(req, "entityType"), entityId: qp(req, "entityId"),
      from: qp(req, "from"), to: qp(req, "to"), q: qp(req, "q"), page: qn(req, "page"), pageSize: qn(req, "pageSize"),
    }))),
  };
}

export function systemHandlers(deps: AdminDeps): { GET: H } {
  return { GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => respond(await systemView(sb))) };
}

export function catalogHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    /** Importación de cartas: SOLO dry run (valida, no escribe). */
    POST: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => {
      const r = await readBody(req, ["action", "rows"]);
      if (!r.ok) return r.res;
      if (r.body.action !== "import_dry_run") return json({ error: "Acción desconocida" }, 400);
      return respond(await importDryRun(sb, r.body.rows));
    }),
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => {
      const view = qp(req, "view");
      if (view === "players") return respond(await listPlayers(sb, { q: qp(req, "q"), team: qp(req, "team"), region: qp(req, "region"), page: qn(req, "page"), pageSize: qn(req, "pageSize") }));
      if (view === "player") return respond(await playerDetail(sb, qp(req, "id") ?? ""));
      if (view === "teams") return respond(await teamsView(sb));
      if (view === "team") return respond(await teamDetail(sb, qp(req, "id") ?? ""));
      if (view === "seasons") return respond(await seasonsDetail(sb));
      if (view === "competitive") return respond(await competitiveView(sb));
      if (view === "rewards") return respond(await rewardsView(sb));
      return json({ error: "Vista desconocida" }, 400);
    }),
  };
}

/** Sobres + economía (observabilidad). La simulación es SOLO LECTURA y va por la cubeta de escritura (es CPU). */
export function packsHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => {
      const id = qp(req, "id");
      const view = qp(req, "view");
      if (view === "economy") {
        const byClass = PACK_CLASS_ORDER.map((k) => {
          const cs = CARDS.filter((c) => packCardClass(c) === k), v = cs.map(marketValue).sort((a, b) => a - b), s = cs.map(salvageValue).sort((a, b) => a - b);
          const med = (a: number[]) => a[Math.floor(a.length / 2)] ?? 0, mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
          return { cls: k, cards: cs.length, valueMin: v[0] ?? 0, valueMedian: med(v), valueMean: Math.round(mean(v)), valueMax: v[v.length - 1] ?? 0, salvageMedian: med(s), salvageMean: Math.round(mean(s)) };
        });
        const [l7, l30, opens, stats] = await Promise.all([
          sb.rpc("app_admin_ledger_summary", { p_days: 7 }),
          sb.rpc("app_admin_ledger_summary", { p_days: 30 }),
          sb.from("economy_ops").select("result").eq("kind", "open_pack").order("created_at", { ascending: false }).limit(5000),
          sb.rpc("app_admin_dashboard_stats"),
        ]);
        const opened = new Map<string, number>();
        for (const o of (opens.data ?? []) as { result: { packId?: string } | null }[]) { const p = o.result?.packId; if (p) opened.set(p, (opened.get(p) ?? 0) + 1); }
        return json({
          band: mainBand(), health: economyHealth(), packs: packRows(), byClass,
          ledger7d: l7.data ?? [], ledger30d: l30.data ?? [],
          mostOpened: [...opened.entries()].sort((a, b) => b[1] - a[1]).map(([packId, n]) => ({ packId, name: getPack(packId)?.name ?? packId, opens: n })),
          openSample: (opens.data ?? []).length,
          credits: (stats.data as { creditsInCirculation?: number } | null)?.creditsInCirculation ?? null,
        });
      }
      if (!id) return respond(packsList());
      const pack = getPack(id);
      if (!pack) return json({ error: "Sobre no encontrado" }, 404);
      const { data: pools } = await sb.from("content_pack_pools").select("pack_id, pool_id, priority, enabled").eq("pack_id", pack.id).order("priority");
      const bindings = (pools ?? []) as PackBinding[];
      // F58.1 · cuántas cartas define cada pool vinculado (elegibilidad real del sobre).
      const counts: Record<string, number> = {};
      for (const b of bindings) counts[b.pool_id] = (await sb.from("content_pool_entries").select("card_id", { count: "exact", head: true }).eq("pool_id", b.pool_id)).count ?? 0;
      const stats = PACK_STATS[pack.id] ?? null;
      return json({
        pack: { id: pack.id, name: pack.name, description: pack.description, price: pack.price, cardCount: pack.cardCount, weights: pack.weights, guaranteedMin: pack.guaranteedMin ?? null,
          restrictRegion: pack.restrictRegion ?? null, team: pack.team ?? null, eventId: pack.eventId ?? null, tag: pack.tag ?? null, lifecycle: packLifecycle(pack), purchasable: isPurchasable(pack) },
        row: packRows().find((r) => r.id === pack.id) ?? null,
        classDistribution: mainPackDistribution(pack.id),
        odds: packOddsFor(pack, stats),
        stats, pools: bindings.map((b) => ({ ...b, entries: counts[b.pool_id] ?? 0 })),
        drawSource: drawSourceOf(pack, bindings),
        editable: false,
        frozen: "Precio, probabilidades y pools de sobres están congelados (F57.3–F57.6) y viven en código; los pools se gestionan en /admin/pools.",
      });
    }),
    POST: (req) => runAdmin(req, deps, "admin_write", async () => {
      const r = await readBody(req, ["action", "packId", "price", "cardCount", "n"]);
      if (!r.ok) return r.res;
      if (r.body.action !== "simulate") return json({ error: "Acción desconocida" }, 400);
      if (typeof r.body.packId !== "string" || !getPack(r.body.packId)) return respond(fail(404, "Sobre no encontrado"));
      const w = parseWhatIf(r.body);
      if (!w.ok) return json({ error: w.error }, 400);
      const n = Math.min(Math.max(Number(r.body.n ?? 3000) || 3000, 500), 6000);
      return json(whatIf(r.body.packId, w.value, n));
    }),
  };
}
