/** F71 · Contenido vivo del juego — `/api/content/duel-theme`: público y de SOLO LECTURA (el tema de duelo vigente). */
import { publicContentHandlers } from "@/server/cms/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicContentHandlers().duelTheme;
