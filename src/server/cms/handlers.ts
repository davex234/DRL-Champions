/**
 * F60 · RUTAS DEL CMS (`/api/admin/cms/*`) y del contenido vivo del juego (`/api/content/*`).
 *
 * Todas las del panel pasan por `runAdmin` (F58): `verifyAdmin` en servidor (Bearer → GoTrue → `profiles.is_admin`),
 * límite de frecuencia (lectura/escritura), cuerpo con LISTA BLANCA de campos (mass assignment ⇒ 400) y errores sin
 * detalle interno. Anónimo y usuario normal reciben el MISMO 401. Las RPC de 0057 vuelven a comprobar que el actor es
 * admin: si alguien saltara esta capa, la BD le diría que no.
 *
 * Las de `/api/content/*` son públicas y de SOLO LECTURA: sirven lo publicado (nunca borradores).
 */
import { NextResponse } from "next/server";
import { json, readBody, respond, runAdmin, type AdminDeps, NO_STORE } from "@/server/admin/http";
import { agentDetail, agentLifecycle, deleteAgentDraft, listAgents, loadAgentCatalog, saveAgent } from "./agents";
import { cmsPackDetail, codePackReferences, deletePackDraft, editPackPool, ensurePackPool, listAllPacks, loadPackCatalog, publishPack, retirePack, savePack, simulateCmsPack } from "./packs";
import { cardWizardOptions, cmsCardDetail, createCmsCard, deleteCmsCardDraft, previewCmsCard, publishCmsCard, retireCard, updateCmsCardPresentation } from "./cards";
import { playerRelations, savePlayer } from "./players";
import { assetDetail, deleteOrphanAsset, listCmsAssets, uploadCmsAsset, type ImageCodec } from "./assets";
import { contentHealth } from "./health";
import { mapsView } from "./maps";
import { listDuelThemes, loadActiveDuelTheme, removeDuelTheme, saveDuelTheme } from "./duelThemes";
import { listF73, saveMission, saveProject, saveRecipe } from "./crafting";
import { getForgeAdmin, previewForgeChange, saveForgeConfig } from "./forge";
import { adminDeleteDraft, adminGenerate, adminListSets, adminNewVersion, adminPreview, adminPublish, adminRetire, adminUpdateDraft } from "./collectionSets";
import { adminCancelSeason, adminCreateSeason, adminDeleteSeasonDraft, adminListSeasons, adminPreviewSeason, adminPublishSeason, adminUpdateSeason } from "./seasons";
import { TEAM_IDENTITIES } from "@/data/teamIdentities";
import { ASSET_RULES, isCmsAssetKind } from "@/domain/cms/uploads";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

type H = (req: Request) => Promise<NextResponse>;
const qp = (req: Request, k: string) => new URL(req.url).searchParams.get(k) ?? undefined;
const unknownAction = () => json({ error: "Acción desconocida" }, 400);

// ────────────────────────── Agentes ──────────────────────────
export function agentsCmsHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => {
      const id = qp(req, "id");
      return id ? respond(await agentDetail(sb, id)) : respond(await listAgents(sb));
    }),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "id", "patch", "expectedVersion", "reason", "to", "confirm"]);
      if (!r.ok) return r.res;
      const b = r.body;
      if (b.action === "save") return respond(await saveAgent(sb, userId, b));
      if (b.action === "lifecycle") return respond(await agentLifecycle(sb, userId, b));
      if (b.action === "deleteDraft") return respond(await deleteAgentDraft(sb, userId, b));
      return unknownAction();
    }),
  };
}

// ────────────────────────── Sobres ──────────────────────────
export function packsCmsHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => {
      const id = qp(req, "id"); const refs = qp(req, "refs");
      if (refs) return respond(await codePackReferences(sb, refs));
      return id ? respond(await cmsPackDetail(sb, id)) : respond(await listAllPacks(sb));
    }),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "id", "patch", "expectedVersion", "expectedRevision", "reason", "confirm", "n", "op", "cardIds"]);
      if (!r.ok) return r.res;
      const b = r.body;
      if (b.action === "save") return respond(await savePack(sb, userId, b));
      if (b.action === "simulate") return respond(await simulateCmsPack(sb, String(b.id ?? ""), b.n)); // no escribe nada
      if (b.action === "ensurePool") return respond(await ensurePackPool(sb, userId, String(b.id ?? "")));
      if (b.action === "pool") return respond(await editPackPool(sb, userId, b));
      if (b.action === "publish") return respond(await publishPack(sb, userId, b));
      if (b.action === "retire") return respond(await retirePack(sb, userId, b));
      if (b.action === "deleteDraft") return respond(await deletePackDraft(sb, userId, b));
      return unknownAction();
    }),
  };
}

// ────────────────────────── F73 · Crafteo, misiones y proyectos ──────────────────────────
export function craftingCmsHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => respond(await listF73(sb))),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "id", "patch", "expectedVersion", "reason"]);
      if (!r.ok) return r.res;
      const b = r.body;
      if (b.action === "saveRecipe") return respond(await saveRecipe(sb, userId, b));
      if (b.action === "saveMission") return respond(await saveMission(sb, userId, b));
      if (b.action === "saveProject") return respond(await saveProject(sb, userId, b));
      return unknownAction();
    }),
  };
}

// ────────────────────────── F79 · NEXUS FORGE 2.0 ──────────────────────────
export function forgeCmsHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => respond(await getForgeAdmin(sb))),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "doc", "expectedVersion", "reason", "confirmRegression"]);
      if (!r.ok) return r.res;
      const b = r.body;
      if (b.action === "impact") return respond(await previewForgeChange(sb, b)); // F79.1 · no escribe nada
      if (b.action === "save") return respond(await saveForgeConfig(sb, userId, b));
      return unknownAction();
    }),
  };
}

// ────────────────────────── F82 · Collection Sets ──────────────────────────
export function collectionSetsCmsHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => respond(await adminListSets(sb))),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "id", "kind", "subjects", "family", "patch", "expectedVersion", "reason"]);
      if (!r.ok) return r.res;
      const b = r.body;
      if (b.action === "preview") return respond(await adminPreview(sb, b)); // no escribe nada
      if (b.action === "generate") return respond(await adminGenerate(sb, userId, b));
      if (b.action === "newVersion") return respond(await adminNewVersion(sb, userId, b));
      if (b.action === "update") return respond(await adminUpdateDraft(sb, userId, b));
      if (b.action === "publish") return respond(await adminPublish(sb, userId, b));
      if (b.action === "retire") return respond(await adminRetire(sb, userId, b));
      if (b.action === "deleteDraft") return respond(await adminDeleteDraft(sb, userId, b));
      return unknownAction();
    }),
  };
}

// ────────────────────────── F83 · Temporadas ──────────────────────────
export function seasonsCmsHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => respond(await adminListSeasons(sb))),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "id", "patch", "expectedVersion", "reason", "confirm"]);
      if (!r.ok) return r.res;
      const b = r.body;
      if (b.action === "preview") return respond(await adminPreviewSeason(sb, b)); // no escribe nada
      if (b.action === "create") return respond(await adminCreateSeason(sb, userId));
      if (b.action === "update") return respond(await adminUpdateSeason(sb, userId, b));
      if (b.action === "publish") return respond(await adminPublishSeason(sb, userId, b));
      if (b.action === "cancel") return respond(await adminCancelSeason(sb, userId, b));
      if (b.action === "deleteDraft") return respond(await adminDeleteSeasonDraft(sb, userId, b));
      return unknownAction();
    }),
  };
}

// ────────────────────────── Cartas ──────────────────────────
export function cardsCmsHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => {
      const id = qp(req, "id");
      return id ? respond(await cmsCardDetail(sb, id)) : respond(await cardWizardOptions(sb, qp(req, "q")));
    }),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "cardId", "playerId", "variantId", "role", "ovr", "stats", "team", "imageAssetId", "editorial", "reason", "confirm", "expectedRev"]);
      if (!r.ok) return r.res;
      const b = r.body;
      if (b.action === "preview") return respond(await previewCmsCard(sb, b)); // no escribe nada
      if (b.action === "create") return respond(await createCmsCard(sb, userId, b));
      if (b.action === "update") return respond(await updateCmsCardPresentation(sb, userId, b));
      if (b.action === "publish") return respond(await publishCmsCard(sb, userId, b));
      if (b.action === "retire") return respond(await retireCard(sb, userId, b));
      if (b.action === "deleteDraft") return respond(await deleteCmsCardDraft(sb, userId, b));
      return unknownAction();
    }),
  };
}

// ────────────────────────── Jugadores ──────────────────────────
export function playersCmsHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => respond(await playerRelations(sb, qp(req, "id") ?? ""))),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "id", "patch", "expectedVersion", "reason"]);
      if (!r.ok) return r.res;
      if (r.body.action === "save") return respond(await savePlayer(sb, userId, r.body));
      return unknownAction();
    }),
  };
}

// ────────────────────────── Assets (multipart) ──────────────────────────
const MAX_UPLOAD = Math.max(...Object.values(ASSET_RULES).map((r) => r.maxBytes));

export function assetsCmsHandlers(deps: AdminDeps, codec?: ImageCodec | null): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => {
      const id = qp(req, "id");
      if (id) return respond(await assetDetail(sb, id));
      return respond(await listCmsAssets(sb, {
        kind: qp(req, "kind"), status: qp(req, "status"), orphan: qp(req, "orphan") === "1", q: qp(req, "q"),
        page: Number(qp(req, "page") ?? 1), pageSize: Number(qp(req, "pageSize") ?? 24),
      }));
    }),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const type = req.headers.get("content-type") ?? "";
      if (type.startsWith("multipart/form-data")) {
        // Tamaño ANTES de leer el cuerpo: un fichero enorme no llega a memoria.
        const len = Number(req.headers.get("content-length") ?? NaN);
        if (!Number.isFinite(len) || len > MAX_UPLOAD + 64 * 1024) return json({ error: "Fichero demasiado grande o tamaño desconocido" }, 413);
        let form: FormData;
        try { form = await req.formData(); } catch { return json({ error: "Formulario inválido" }, 400); }
        const allowed = new Set(["action", "kind", "subjectId", "replaceOf", "file"]);
        for (const k of form.keys()) if (!allowed.has(k)) return json({ error: `Campo no permitido: ${k.slice(0, 40)}` }, 400);
        if (form.get("action") !== "upload") return unknownAction();
        const file = form.get("file");
        const kind = form.get("kind");
        if (!(file instanceof File)) return json({ error: "Falta el fichero" }, 400);
        if (!isCmsAssetKind(kind)) return json({ error: "Tipo de asset no admitido" }, 400);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const subject = form.get("subjectId"); const replace = form.get("replaceOf");
        return respond(await uploadCmsAsset(sb, userId, {
          kind, name: file.name, mime: file.type, bytes,
          subjectId: typeof subject === "string" ? subject : null,
          replaceOf: typeof replace === "string" && /^[0-9a-f-]{36}$/.test(replace) ? replace : null,
        }, codec));
      }
      const r = await readBody(req, ["action", "id", "reason", "confirm"]);
      if (!r.ok) return r.res;
      if (r.body.action === "deleteOrphan") {
        if (r.body.confirm !== r.body.id) return json({ error: "Escribe el id del asset para confirmar" }, 400);
        return respond(await deleteOrphanAsset(sb, userId, String(r.body.id ?? ""), String(r.body.reason ?? "")));
      }
      return unknownAction();
    }),
  };
}

// ────────────────────────── Mapas (sólo lectura) ──────────────────────────
export function mapsCmsHandlers(deps: AdminDeps): { GET: H } {
  return { GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => respond(await mapsView(sb))) };
}

// ────────────────────────── Salud del contenido ──────────────────────────
export function contentHealthHandlers(deps: AdminDeps): { GET: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => json(await contentHealth(sb, TEAM_IDENTITIES.length))),
  };
}

// ────────────────────────── Contenido vivo (público, sólo lectura) ──────────────────────────
const PUBLIC_CACHE = { "Cache-Control": "public, max-age=5, s-maxage=5, stale-while-revalidate=30" };

// ────────────────────────── F71 · Temáticas de duelo ──────────────────────────
export function duelThemesCmsHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => respond(await listDuelThemes(sb))),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "assetId", "theme", "expectedRev"]);
      if (!r.ok) return r.res;
      const b = r.body;
      if (b.action === "save") return respond(await saveDuelTheme(sb, userId, b));
      if (b.action === "remove") return respond(await removeDuelTheme(sb, userId, b));
      return unknownAction();
    }),
  };
}

export function publicContentHandlers(db: () => SupabaseClient | null = getSupabaseAdmin): { agents: H; packs: H; duelTheme: H } {
  return {
    /* F71 · el tema de duelo vigente. Nunca falla: sin BD, el de código (el duelo no se queda sin fondo). */
    duelTheme: async () => NextResponse.json({ theme: await loadActiveDuelTheme(db()) }, { headers: PUBLIC_CACHE }),
    agents: async () => {
      const sb = db();
      const payload = sb ? await loadAgentCatalog(sb).catch(() => null) : null;
      if (!payload) return NextResponse.json({ error: "Catálogo no disponible" }, { status: 503, headers: NO_STORE });
      return NextResponse.json(payload, { headers: PUBLIC_CACHE });
    },
    packs: async () => {
      const sb = db();
      const defs = sb ? await loadPackCatalog(sb).catch(() => null) : null;
      if (!defs) return NextResponse.json({ error: "Catálogo no disponible" }, { status: 503, headers: NO_STORE });
      return NextResponse.json({ packs: defs }, { headers: PUBLIC_CACHE });
    },
  };
}
