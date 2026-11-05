/** F58 · Admin Control Center — `/api/admin/dashboard`. Toda la lógica y la autorización viven en `server/admin/handlers.ts` (verifyAdmin + límite + lista blanca). */
import { dashboardHandlers } from "@/server/admin/handlers";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = dashboardHandlers(DEFAULT_DEPS);
export const GET = h.GET;
