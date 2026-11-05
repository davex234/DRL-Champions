/** F58 · Admin Control Center — `/api/admin/search`. Toda la lógica y la autorización viven en `server/admin/handlers.ts` (verifyAdmin + límite + lista blanca). */
import { searchHandlers } from "@/server/admin/handlers";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = searchHandlers(DEFAULT_DEPS);
export const GET = h.GET;
