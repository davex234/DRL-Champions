/** F71 · CMS — `/api/admin/cms/duel-themes`. Autorización (verifyAdmin vía runAdmin), límite y lista blanca en `server/cms/handlers.ts`. */
import { duelThemesCmsHandlers } from "@/server/cms/handlers";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = duelThemesCmsHandlers(DEFAULT_DEPS);
export const GET = h.GET;
export const POST = h.POST;
