/** F86 · `/api/admin/cups`: torneos de jugadores en el panel (borradores, publicar, cancelar, generar el cuadro, resolver cruces). Autorización, límites y lista blanca en `server/admin/cups.ts` (`runAdmin`). */
import { cupsAdminHandlers } from "@/server/admin/cups";
import { DEFAULT_DEPS } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = cupsAdminHandlers(DEFAULT_DEPS);
export const GET = h.GET;
export const POST = h.POST;
