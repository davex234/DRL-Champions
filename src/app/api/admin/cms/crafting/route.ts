/** F73 · CMS — `/api/admin/cms/crafting`: recetas, misiones y proyectos. Autorización, límite y lista blanca en `server/cms/handlers.ts`. */
import { craftingCmsHandlers } from "@/server/cms/handlers";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = craftingCmsHandlers(DEFAULT_DEPS);
export const GET = h.GET;
export const POST = h.POST;
