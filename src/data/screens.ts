/**
 * Registro de PANTALLAS (descriptores, Render/UI Fase 2/7).
 *
 * Infraestructura por DATOS: cada pantalla del juego se describe aquí (id/ruta/título/ventana/guards),
 * SIN componentes ni lógica. Reutiliza las rutas reales de la app (Next). Añadir una pantalla = añadir
 * un descriptor. Las fases futuras montarán los componentes sobre estos descriptores.
 */
import type { ScreenDescriptor } from "@/navigation";

export const SCREENS: ScreenDescriptor[] = [
  { id: "home", route: "/", title: "Inicio", cache: "keep" },
  { id: "manager", route: "/manager", title: "Mánager" },
  { id: "coach", route: "/entrenador", title: "Entrenador" },
  { id: "coach-teams", route: "/entrenador/equipos", title: "Equipos" },
  { id: "career", route: "/carrera", title: "Carrera" },
  { id: "world", route: "/mundo", title: "El Mundo" },
  { id: "collection", route: "/coleccion", title: "Colección", cache: "keep" },
  { id: "collections", route: "/colecciones", title: "Colecciones" },
  { id: "collection-detail", route: "/colecciones/:slug", title: "Colección" },
  { id: "inventory", route: "/inventario", title: "Inventario" },
  { id: "shop", route: "/tienda", title: "Tienda" },
  { id: "news", route: "/noticias", title: "Noticias" },
  { id: "events", route: "/eventos", title: "Eventos" },
  { id: "market", route: "/mercado", title: "Mercado" },
  { id: "ranking", route: "/ranking", title: "Ranking" },
  { id: "achievements", route: "/logros", title: "Logros" },
  { id: "account", route: "/cuenta", title: "Cuenta", guards: ["hydrated"] },
  { id: "open-pack", route: "/abrir/:packId", title: "Abrir sobre", window: "overlay", fullscreen: true },
  { id: "launcher", route: "/launcher", title: "Launcher", window: "screen", fullscreen: true },
];

export const SCREEN_BY_ID = new Map(SCREENS.map((s) => [s.id, s]));
export function getScreen(id: string): ScreenDescriptor | undefined { return SCREEN_BY_ID.get(id); }
