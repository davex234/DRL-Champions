/**
 * ARQUITECTURA DE NAVEGACIÓN (Fase 9A).
 *
 * La auditoría del Paso 0 encontró **14 entradas en una lista lateral**, con tres destinos
 * de colección, tres superficies de compra y tres de reclamación. Eso es un menú de web.
 *
 * Un producto de esports no tiene catorce sitios: tiene cinco cosas que hacer. Esta es la
 * agrupación, y es la ÚNICA fuente de la navegación —la barra superior, el menú móvil y
 * cualquier pantalla que enlace a otra sección leen de aquí.
 *
 * Ninguna ruta desaparece: las que antes competían en el menú principal pasan a estar
 * dentro de su sección. Un enlace directo antiguo sigue funcionando.
 */

export interface NavItem {
  href: string;
  label: string;
  /** Una línea que explica QUÉ es, no cómo se llama. Se enseña en el desplegable. */
  hint: string;
  /** Insignia dinámica: la calcula el armazón, no esta tabla. */
  badge?: "events" | "news" | "duel";
}

export interface NavSection {
  id: string;
  label: string;
  /** Destino al pulsar la propia sección (no solo abrir el desplegable). */
  href: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "jugar",
    label: "Jugar",
    href: "/duelos",
    items: [
      { href: "/duelos", label: "Duelos", hint: "Tu mazo contra un rival. Diez turnos." },
      { href: "/torneos", label: "Torneos", hint: "Competiciones con clasificación propia." },
      { href: "/pickems", label: "Pick'ems", hint: "Predice los partidos reales y puntúa." },
      { href: "/entrenador", label: "Entrenador", hint: "Equipo, mapas, pizarra y partido." },
      { href: "/entrenador/strats", label: "Pizarra", hint: "Dibuja la jugada sobre los mapas de NEXUS." },
    ],
  },
  {
    id: "coleccion",
    label: "Colección",
    href: "/coleccion",
    items: [
      { href: "/coleccion", label: "Mis cartas", hint: "Todo el catálogo y lo que posees." },
      { href: "/colecciones", label: "Colecciones", hint: "Sets completos y su recompensa." },
      { href: "/inventario", label: "Inventario", hint: "Sobres sin abrir y duplicados." },
      { href: "/mercado", label: "Mercado", hint: "Compra y vende cartas a otros." },
    ],
  },
  {
    id: "tienda",
    label: "Tienda",
    href: "/tienda",
    items: [
      { href: "/tienda", label: "Sobres", hint: "Todos los sobres, incluidos los de evento." },
      { href: "/eventos", label: "Eventos", hint: "Sobres y misiones de evento activo.", badge: "events" },
    ],
  },
  {
    id: "progreso",
    label: "Progreso",
    href: "/cuenta",
    items: [
      { href: "/cuenta", label: "Perfil", hint: "Tu rango, nivel y cifras." },
      { href: "/ranking", label: "Clasificación", hint: "Tu posición global y europea." },
      { href: "/logros", label: "Logros y pase", hint: "Objetivos, misiones y pase de temporada." },
      { href: "/recompensas", label: "Recompensas", hint: "Lo que has ganado y cuándo." },
    ],
  },
  {
    id: "mundo",
    label: "Mundo",
    href: "/mundo",
    items: [
      { href: "/mundo", label: "El Mundo", hint: "Standings, traspasos y crónica del ecosistema." },
      { href: "/noticias", label: "Noticias", hint: "Qué ha pasado desde tu última sesión.", badge: "news" },
    ],
  },
];

/**
 * Barra inferior de móvil. Cinco destinos: es el máximo que cabe sin comprimir el texto
 * a un tamaño ilegible en 390 px, que es el ancho que se verifica en 9J.
 */
export const MOBILE_NAV: { href: string; label: string; section: string | null }[] = [
  { href: "/", label: "Inicio", section: null },
  { href: "/duelos", label: "Jugar", section: "jugar" },
  { href: "/coleccion", label: "Cartas", section: "coleccion" },
  { href: "/tienda", label: "Tienda", section: "tienda" },
  { href: "/cuenta", label: "Perfil", section: "progreso" },
];

/**
 * Rutas que se presentan a pantalla completa: sin armazón, sin barras.
 *
 * Un juego no te enseña el menú principal mientras juegas. Estas pantallas traen su
 * propio cromo —y su propia salida—, así que el armazón se aparta.
 *
 * `/abrir/[packId]` entró en la Fase 9.6: la ceremonia de apertura ocupa el viewport
 * entero y trae su propia salida, así que el armazón detrás solo aportaba nodos.
 */
export const IMMERSIVE_ROUTES = ["/launcher", "/duelos/jugar", "/abrir"];

export function isImmersive(pathname: string): boolean {
  return IMMERSIVE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/**
 * Rutas que pertenecen a una sección sin ser una entrada de su menú.
 *
 * `/abrir/[packId]` es la CONTINUACIÓN de la Tienda —se compra un sobre y se abre— pero no
 * aparece en el menú, así que `sectionForPath` devolvía `null`. Con la ceremonia hecha
 * inmersiva (Fase 9.6) eso dejó la pantalla sin `data-context`: sin tinte de sección y,
 * para la auditoría de estabilidad, sin armazón que encontrar.
 */
const SECTION_ALIAS: { prefix: string; sectionId: string }[] = [
  { prefix: "/abrir", sectionId: "tienda" },
];

/** Sección a la que pertenece una ruta, para marcar la activa. Coincidencia más específica. */
export function sectionForPath(pathname: string): NavSection | null {
  let best: NavSection | null = null;
  let bestLen = -1;
  for (const s of NAV_SECTIONS) {
    for (const it of s.items) {
      const match = pathname === it.href || pathname.startsWith(`${it.href}/`);
      if (match && it.href.length > bestLen) {
        best = s;
        bestLen = it.href.length;
      }
    }
  }
  if (best) return best;

  for (const a of SECTION_ALIAS) {
    if (pathname === a.prefix || pathname.startsWith(`${a.prefix}/`)) {
      return NAV_SECTIONS.find((s) => s.id === a.sectionId) ?? null;
    }
  }
  return null;
}

export function isItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
