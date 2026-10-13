/** F58 · Admin Control Center — `/api/admin/packs`. Toda la lógica y la autorización viven en `server/admin/handlers.ts` (verifyAdmin + límite + lista blanca). */
import { packsHandlers } from "@/server/admin/handlers";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = packsHandlers(DEFAULT_DEPS);
export const GET = h.GET;
export const POST = h.POST;
