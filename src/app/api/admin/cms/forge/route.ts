/** F79 · CMS — `/api/admin/cms/forge`: configuración de NEXUS FORGE 2.0. Autorización, límite y lista blanca en `server/cms/handlers.ts`. */
import { forgeCmsHandlers } from "@/server/cms/handlers";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = forgeCmsHandlers(DEFAULT_DEPS);
export const GET = h.GET;
export const POST = h.POST;
