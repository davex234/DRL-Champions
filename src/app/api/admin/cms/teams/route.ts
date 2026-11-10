/** Colecciones por equipo · CMS — `/api/admin/cms/teams` (0076). Autorización (verifyAdmin vía runAdmin), límite y lista blanca en `server/cms/handlers.ts`. */
import { teamsCmsHandlers } from "@/server/cms/handlers";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = teamsCmsHandlers(DEFAULT_DEPS);
export const GET = h.GET;
export const POST = h.POST;
