/** F87 · `/api/admin/pickems`: Pick'ems 2.0 en el panel (borradores derivados de datos reales, validador, publicar, recompensas, cierres, VOID, liquidar). Autorización, límites y lista blanca en `server/admin/pickems.ts` (`runAdmin`). */
import { pickemsAdminHandlers } from "@/server/admin/pickems";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = pickemsAdminHandlers(DEFAULT_DEPS);
export const GET = h.GET;
export const POST = h.POST;
