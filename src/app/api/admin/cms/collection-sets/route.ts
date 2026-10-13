/** F82 · CMS — `/api/admin/cms/collection-sets`: Collection Sets (generar, editar borrador, previsualizar, publicar, retirar). Autorización, límite y lista blanca en `server/cms/handlers.ts`. */
import { collectionSetsCmsHandlers } from "@/server/cms/handlers";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = collectionSetsCmsHandlers(DEFAULT_DEPS);
export const GET = h.GET;
export const POST = h.POST;
