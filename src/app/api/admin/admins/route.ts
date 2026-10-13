/** 0067 · `/api/admin/admins`: lista de administradores, búsqueda por nombre y conceder / quitar admin (auditado). Autorización, límite y lista blanca en `server/admin/admins.ts` (`runAdmin`). */
import { adminsHandlers } from "@/server/admin/admins";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = adminsHandlers(DEFAULT_DEPS);
export const GET = h.GET;
export const POST = h.POST;
