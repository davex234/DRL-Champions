/** F60 · Contenido vivo del juego — `/api/content/agents`: público y de SOLO LECTURA (publicados/retirados; nunca borradores). */
import { publicContentHandlers } from "@/server/cms/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicContentHandlers().agents;
