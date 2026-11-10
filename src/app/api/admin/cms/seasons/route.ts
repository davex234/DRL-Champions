/** F83 · CMS — `/api/admin/cms/seasons`: temporadas (crear borrador, editar, previsualizar con economía, publicar, cancelar). Autorización, límite y lista blanca en `server/cms/handlers.ts`. */
import { seasonsCmsHandlers } from "@/server/cms/handlers";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = seasonsCmsHandlers(DEFAULT_DEPS);
export const GET = h.GET;
export const POST = h.POST;
