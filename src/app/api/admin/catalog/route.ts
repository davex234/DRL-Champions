/** F58 · Admin Control Center — `/api/admin/catalog`. Toda la lógica y la autorización viven en `server/admin/handlers.ts` (verifyAdmin + límite + lista blanca). */
import { catalogHandlers } from "@/server/admin/handlers";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = catalogHandlers(DEFAULT_DEPS);
export const GET = h.GET;
export const POST = h.POST;
