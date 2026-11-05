/**
 * F58 · MAPA DEL CONTROL CENTER — secciones, rutas y acciones seguras de la paleta. Una sola fuente para la barra
 * lateral, la paleta de comandos (Ctrl/Cmd+K), `routes.json` y las pruebas.
 */
export interface AdminSection { id: string; label: string; href: string; icon: string; group: "Operación" | "Contenido" | "Jugadores" | "Juego" | "Control" | "Herramientas"; description: string }

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { id: "dashboard", label: "Dashboard", href: "/admin", icon: "◈", group: "Operación", description: "KPIs reales, alertas y actividad reciente" },
  { id: "content", label: "Contenido", href: "/admin/content", icon: "◇", group: "Contenido", description: "Resumen del CMS, salud del contenido y fuentes de verdad" },
  { id: "agents", label: "Agentes", href: "/admin/agents", icon: "✧", group: "Contenido", description: "Roster real: alta, cara y cuerpo, publicar y retirar" },
  { id: "cards", label: "Cartas", href: "/admin/cards", icon: "▦", group: "Contenido", description: "Catálogo: listado, alta, edición, publicación y exportación" },
  { id: "players", label: "Jugadores", href: "/admin/players", icon: "◉", group: "Contenido", description: "Jugadores del catálogo y sus cartas" },
  { id: "teams", label: "Equipos", href: "/admin/teams", icon: "⬡", group: "Contenido", description: "Identidades de equipo, plantilla y sobres" },
  { id: "packs", label: "Sobres", href: "/admin/packs", icon: "▣", group: "Contenido", description: "Economía por sobre, probabilidades y simulación" },
  { id: "events", label: "Eventos", href: "/admin/events", icon: "✦", group: "Contenido", description: "Borradores y eventos del juego" },
  { id: "assets", label: "Assets", href: "/admin/assets", icon: "▤", group: "Contenido", description: "Medios en Storage: subida validada, uso y huérfanos" },
  { id: "maps", label: "Mapas", href: "/admin/maps", icon: "⌖", group: "Contenido", description: "Mapas del entrenador y su preparación" },
  { id: "collection-sets", label: "Colecciones", href: "/admin/collection-sets", icon: "⛉", group: "Contenido", description: "Collection Sets (equipo/edición): generar borradores, revisar, publicar y retirar (F82)" },
  { id: "crafting", label: "Crafteo y misiones", href: "/admin/crafting", icon: "⚒", group: "Contenido", description: "Recetas de crafteo, misiones y proyectos de carta (F73)" },
  { id: "duel-themes", label: "Temáticas de duelo", href: "/admin/duel-themes", icon: "◭", group: "Contenido", description: "Fondo visual de los duelos por evento; si no hay ninguno, la arena de siempre" },
  { id: "users", label: "Usuarios", href: "/admin/users", icon: "◎", group: "Jugadores", description: "Búsqueda y ficha 360" },
  { id: "moderation", label: "Moderación", href: "/admin/moderation", icon: "⛨", group: "Jugadores", description: "Sanciones activas e historial" },
  // F86.2 · feedback de la Closed Alpha y embudo derivado de datos reales (solo lectura).
  { id: "alpha", label: "Closed Alpha", href: "/admin/alpha", icon: "✎", group: "Jugadores", description: "Feedback de la prueba cerrada y embudo medido sobre datos reales (F86.2)" },
  { id: "economy", label: "Economía", href: "/admin/economy", icon: "¤", group: "Juego", description: "Observabilidad y salud de la economía" },
  { id: "seasons", label: "Temporadas", href: "/admin/seasons", icon: "◷", group: "Juego", description: "Calendario y pase" },
  { id: "competitive", label: "Competitivo", href: "/admin/competitive", icon: "♛", group: "Juego", description: "Rating, partidas y anomalías" },
  // F86 · torneos de JUGADORES (copas). «Torneos» (Herramientas) sigue siendo la capa esports.
  { id: "cups", label: "Torneos de jugadores", href: "/admin/copas", icon: "♜", group: "Juego", description: "Crear, publicar y cancelar torneos; cuadro, inscritos y cruces por resolver (F86)" },
  // F87 · Pick'ems 2.0: cuadros de predicción sobre eventos esports REALES (no confundir con los torneos de jugadores).
  { id: "pickems", label: "Pick'ems", href: "/admin/pickems", icon: "⋔", group: "Juego", description: "Cuadros de predicción sobre eventos reales: borrador derivado, validador, publicar, recompensas, cierres, VOID y liquidar (F87)" },
  { id: "rewards", label: "Recompensas", href: "/admin/rewards", icon: "✚", group: "Juego", description: "Fuentes de recompensa reales" },
  { id: "admins", label: "Administradores", href: "/admin/admins", icon: "⚿", group: "Control", description: "Quién es administrador: conceder y quitar (auditado; nunca 0 admins)" },
  { id: "audit", label: "Auditoría", href: "/admin/audit", icon: "≣", group: "Control", description: "Registro inmutable de acciones admin" },
  { id: "system", label: "Sistema", href: "/admin/system", icon: "⚙", group: "Control", description: "Salud, versión, migraciones y flags" },
  { id: "pools", label: "Pools", href: "/admin/pools", icon: "◫", group: "Herramientas", description: "Distribución de cartas por sobre" },
  { id: "releases", label: "Releases", href: "/admin/releases", icon: "⇪", group: "Herramientas", description: "Publicación de contenido" },
  { id: "operations", label: "Operaciones", href: "/admin/operations", icon: "∿", group: "Herramientas", description: "Telemetría agregada" },
  { id: "tournaments", label: "Torneos", href: "/admin/torneos", icon: "⚑", group: "Herramientas", description: "Torneos esports" },
  { id: "roster", label: "Roster local", href: "/admin/roster", icon: "☰", group: "Herramientas", description: "Editor de roster del dispositivo (heredado, sin servidor)" },
];

/** Acciones de la paleta: SOLO navegación y creación en borrador. Nunca sancionar, borrar ni dar créditos. */
export const PALETTE_ACTIONS: readonly { id: string; label: string; href: string }[] = [
  { id: "new-card", label: "Crear carta (borrador)", href: "/admin/cards/new" },
  { id: "new-agent", label: "Crear agente (borrador)", href: "/admin/agents/new" },
  { id: "new-pack", label: "Crear sobre (borrador)", href: "/admin/packs/new" },
  { id: "new-player", label: "Crear jugador", href: "/admin/players/new" },
  { id: "content-health", label: "Ver salud del contenido", href: "/admin/content" },
  { id: "new-event", label: "Crear evento (borrador)", href: "/admin/events/new" },
  { id: "find-user", label: "Buscar usuario", href: "/admin/users" },
  { id: "health", label: "Ver salud del sistema", href: "/admin/system" },
  { id: "audit", label: "Abrir registro de auditoría", href: "/admin/audit" },
];

export function sectionFor(pathname: string): AdminSection | null {
  const byLen = [...ADMIN_SECTIONS].sort((a, b) => b.href.length - a.href.length);
  if (pathname.startsWith("/admin/cartas")) return ADMIN_SECTIONS.find((s) => s.id === "cards")!;
  return byLen.find((s) => (s.href === "/admin" ? pathname === "/admin" : pathname === s.href || pathname.startsWith(`${s.href}/`))) ?? null;
}
