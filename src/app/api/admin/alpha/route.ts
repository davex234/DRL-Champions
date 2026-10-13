/** F86.2 · `/api/admin/alpha`: feedback de la Closed Alpha y embudo derivado (solo lectura, solo admin). Ver `server/admin/alpha.ts`. */
import { alphaHandlers } from "@/server/admin/alpha";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = alphaHandlers(DEFAULT_DEPS);
export const GET = h.GET;
