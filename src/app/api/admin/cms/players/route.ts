/** F60 · CMS — `/api/admin/cms/players`. Autorización, límite y lista blanca en `server/cms/handlers.ts` (runAdmin de F58). */
import { playersCmsHandlers } from "@/server/cms/handlers";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = playersCmsHandlers(DEFAULT_DEPS);
export const GET = h.GET;
export const POST = h.POST;
