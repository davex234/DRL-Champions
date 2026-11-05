/** F60 · CMS — `/api/admin/cms/maps` (sólo lectura: preparación real de cada mapa). runAdmin de F58. */
import { mapsCmsHandlers } from "@/server/cms/handlers";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = mapsCmsHandlers(DEFAULT_DEPS);
export const GET = h.GET;
