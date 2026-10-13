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

/**
 * NAVEGACIÓN GLOBAL LIMPIA (2026-10-07) · REGLA ÚNICA para TODOS los menús de navegación (desplegables del armazón,
 * «Más», hoja «Menú» móvil, «Administración» y el «Más» de la portada): cada opción es SOLO SU NOMBRE — sin descripción
 * ni subtítulo —, en mayúsculas, centrada en horizontal y en vertical, en una fila compacta (≥ 44 px). Los nombres se
 * pasan a mayúsculas con CSS (`uppercase`): los datos conservan su forma. Las insignias (contadores) se centran con el
 * nombre como un solo grupo. Por eso `NavItem` ya no tiene `hint`: las descripciones no se usaban en ninguna otra parte
 * (ni búsqueda, ni accesibilidad, ni admin) y se eliminaron. Un contrato (`src/design/navMenus.test.tsx`) lo fija.
 */
export const NAV_MENU_ITEM = "flex items-center justify-center gap-2 px-3 py-2 text-center";
/** Fila compacta de escritorio (y del «Más» de la portada); la hoja móvil usa 48 px por tacto. `cn` no fusiona clases: va aparte. */
export const NAV_MENU_ROW = "min-h-[44px]";
/** Nombre de una opción de menú de navegación: mayúsculas por CSS y en una sola línea (los menús se ajustan a él). Tamaño
 * y tracking los pone cada superficie (sin fusión de clases, dos `tracking-*` chocarían). */
export const NAV_MENU_LABEL = "whitespace-nowrap font-display font-bold uppercase";

/**
 * IA 2026-10-07 · RUTAS DE LA ARQUITECTURA (una sola fuente para el hub, la tienda, la cuenta y los enlaces internos).
 *
 *   TEMPORADA (`/temporada`, hub) ─┬─ PASE DE BATALLA  `/temporada/pase`   (el pase canónico: Fase 34 + F83, sin cambios)
 *                                  ├─ OBJETIVOS        `/misiones`         (objetivos del pase + misiones F73: qué hacer)
 *                                  └─ CRAFTEO          `/misiones/crafting` ─┬─ CARTAS `/misiones/crafting/cartas`
 *                                                                           └─ SOBRES `/misiones/crafting/sobres`
 *   MI CUENTA (`/cuenta`, icono de usuario) ─ PERFIL · PROGRESIÓN (lo conseguido y lo que reclamar) · CUENTA · DAR FEEDBACK
 *
 * Ninguna ruta desaparece: `/progresion` y `/feedback` redirigen a su sitio en la cuenta; `/jugador/[id]` (perfil
 * público) no cambia; `/eventos`, `/logros` y `/recompensas` siguen vivas por enlace aunque salgan del menú.
 */
export const ROUTES = {
  seasonHub: "/temporada",
  battlePass: "/temporada/pase",
  objectives: "/misiones",
  crafting: "/misiones/crafting",
  craftingCards: "/misiones/crafting/cartas",
  craftingPacks: "/misiones/crafting/sobres",
  account: "/cuenta",
  accountProfile: "/cuenta?seccion=perfil",
  accountProgress: "/cuenta?seccion=progresion",
  accountSettings: "/cuenta?seccion=cuenta",
  feedback: "/cuenta?seccion=feedback",
} as const;

export interface NavItem {
  href: string;
  label: string;
  /** Insignia dinámica: la calcula el armazón, no esta tabla. */
  badge?: "events" | "news" | "duel" | "social" | "live" | "cup";
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
    // Fase 35: la sección entra por el hub de modos (Road to Champions, rápida, competitivo, retar a un amigo).
    href: "/jugar",
    items: [
      { href: "/jugar", label: "Modos de juego" },
      { href: "/duelos", label: "Duelos" },
      { href: "/competitivo", label: "Competitivo" },
      { href: "/social", label: "Social", badge: "social" },
      { href: "/torneos", label: "Eventos", badge: "live" },
      // F86 · los torneos de JUGADORES (eliminación directa) entran en el tope de 7: «Pick'ems» sale del menú y sigue en
      // Eventos (cada evento enlaza sus Pick'ems) y en /pickems, como «Pizarra» en la Fase 35.
      { href: "/copas", label: "Torneos", badge: "cup" },
      // Fase 35: «Pizarra» sale del menú (tope de 7) y sigue dentro de Entrenador; su ruta no cambia.
      { href: "/entrenador", label: "Entrenador" },
    ],
  },
  {
    id: "coleccion",
    label: "Colección",
    href: "/coleccion",
    items: [
      // LIMPIEZA DE /COLECCION (2026-10-07) · «Colecciones» lleva al sistema canónico de sets (F82, Sala de Trofeos), que es
      // donde ahora se consultan; el antiguo `/colecciones` sigue vivo por URL y Bóveda.
      { href: "/coleccion", label: "Mis cartas" },
      { href: "/coleccion/trofeos", label: "Colecciones" },
      { href: "/inventario", label: "Inventario" },
      // Fase 44 · el Mercado está CERRADO (GLOBAL_MARKET_ENABLED=false): sale del menú. La ruta sigue existiendo.
    ],
  },
  {
    // Fase 44 · PREPARAR es parte del bucle (jugar → conseguir → abrir → preparar): los equipos tienen sección propia.
    id: "equipos",
    label: "Equipos",
    href: "/duelos/mazos",
    items: [
      { href: "/duelos/mazos", label: "Mis equipos" },
    ],
  },
  {
    id: "tienda",
    // Fase 49 · la Tienda 4.0 vende sobres, cajas, cartas y packs: la sección vuelve a llamarse Tienda.
    label: "Tienda",
    href: "/tienda",
    items: [
      { href: "/packs", label: "Catálogo de sobres" },
      { href: "/tienda", label: "Tienda" },
      { href: "/tienda/creditos", label: "DRL Credits" },
      // IA 2026-10-07 · el pase se ALCANZA desde la Tienda (no se duplica: lleva al pase canónico). El «Centro de eventos»
      // local sale de la Tienda: `/eventos` sigue viva por enlace (sus datos y su lógica no cambian).
      // `?desde=tienda`: misma pantalla, pero la sección activa sigue siendo Temporada (su casa), no Tienda.
      { href: `${ROUTES.battlePass}?desde=tienda`, label: "Pase de batalla" },
    ],
  },
  {
    id: "progreso",
    label: "Temporada",
    href: "/temporada",
    items: [
      // IA 2026-10-07 · la sección entra por su HUB (Pase de batalla · Objetivos · Crafteo). Mi perfil, Cuenta,
      // Progresión y Dar feedback viven en MI CUENTA (icono de usuario, arriba a la derecha); «Logros y pase» y
      // «Recompensas» se alcanzan desde el pase y la cuenta. Las rutas siguen vivas.
      { href: ROUTES.seasonHub, label: "Temporada" },
      { href: ROUTES.battlePass, label: "Pase de batalla" },
      { href: ROUTES.objectives, label: "Objetivos" },
      { href: ROUTES.crafting, label: "Crafteo" },
      { href: "/ranking", label: "Clasificación" },
    ],
  },
  {
    id: "mundo",
    label: "Mundo",
    href: "/mundo",
    items: [
      { href: "/mundo", label: "El Mundo" },
      { href: "/noticias", label: "Noticias", badge: "news" },
    ],
  },
];

/**
 * Barra inferior de móvil. Cinco destinos: es el máximo que cabe sin comprimir el texto
 * a un tamaño ilegible en 390 px, que es el ancho que se verifica en 9J.
 */
/** Pseudo-sección de MI CUENTA: no está en la barra de secciones (se entra por el icono de usuario). */
export const ACCOUNT_SECTION = "cuenta";

export const MOBILE_NAV: { href: string; label: string; section: string | null; play?: boolean }[] = [
  { href: "/", label: "Inicio", section: null },
  { href: "/coleccion", label: "Cartas", section: "coleccion" },
  // Fase 44 · JUGAR va en el CENTRO y elevado: es la acción, no una pestaña más.
  { href: "/jugar", label: "Jugar", section: "jugar", play: true },
  { href: "/tienda", label: "Tienda", section: "tienda" },
  // IA 2026-10-07 · el quinto destino es MI CUENTA (perfil, progresión, cuenta y feedback), no el perfil público.
  { href: ROUTES.account, label: "Cuenta", section: ACCOUNT_SECTION },
];

/**
 * Rutas que se presentan a pantalla completa: sin armazón, sin barras.
 *
 * Un juego no te enseña el menú principal mientras juegas. Estas pantallas traen su
 * propio cromo —y su propia salida—, así que el armazón se aparta.
 *
 * `/abrir/[packId]` entró en la Fase 9.6: la ceremonia de apertura ocupa el viewport
 * entero y trae su propia salida, así que el armazón detrás solo aportaba nodos.
 *
 * `/duelos/pvp` entró en la FASE 61 (modo partida enfocado): la partida ranked/privada se jugaba con la barra de
 * secciones encima —la silueta de una web—, mientras la PvE ya era inmersiva. Cada estado de la ruta trae su salida:
 * antesala («Volver a Competitivo»), búsqueda («Cancelar búsqueda»), partida («Salir» → diálogo) y resultado.
 */
export const IMMERSIVE_ROUTES = ["/launcher", "/duelos/jugar", "/duelos/pvp", "/abrir"];

/**
 * FASE 46 · LA RAÍZ TAMBIÉN ES INMERSIVA, pero NO puede entrar en la lista de arriba.
 *
 * `isImmersive` compara con `startsWith(`${r}/`)`. Con `"/"` en la lista, ese prefijo sería `"//"`,
 * pero la primera condición —`pathname === r`— es la que importa… y la tentación de añadirlo sin
 * más es justo la que rompería la aplicación entera si alguien cambiara el prefijo. Se trata
 * aparte y de forma explícita: la Home, y sólo la Home, exactamente `"/"`.
 *
 * Motivo: la Home pasa a ser el menú principal del juego, y el armazón (barra de secciones y
 * navegación inferior) es precisamente lo que la hacía parecer una web.
 */
export const IMMERSIVE_EXACT = ["/"];

export function isImmersive(pathname: string): boolean {
  if (IMMERSIVE_EXACT.includes(pathname)) return true;
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
  { prefix: "/jugador", sectionId: "progreso" },
  // IA 2026-10-07 · fuera del menú, pero conservan el contexto de la sección Temporada.
  { prefix: "/logros", sectionId: "progreso" },
  { prefix: "/recompensas", sectionId: "progreso" },
  // Fase 44 · fuera del menú (mercado cerrado), pero la ruta conserva su contexto.
  { prefix: "/mercado", sectionId: "coleccion" },
  { prefix: "/equipo", sectionId: "equipos" },
  // Limpieza de /coleccion (2026-10-07) · el `/colecciones` antiguo sale del menú, pero conserva su sección.
  { prefix: "/colecciones", sectionId: "coleccion" },
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

/**
 * ¿Es ESTA la entrada de menú que corresponde a la ruta actual?
 *
 * Gana la coincidencia MÁS ESPECÍFICA. Con `/tienda` y `/tienda/creditos` en el mismo menú
 * (Fase 18.1), la comparación por prefijo a secas marcaba las dos como activas y el menú
 * enseñaba dos entradas resaltadas para una sola pantalla. Aquí se descarta la entrada
 * cuyo `href` es prefijo de otra que también encaja.
 */
export function isItemActive(pathname: string, href: string): boolean {
  if (pathname !== href && !pathname.startsWith(`${href}/`)) return false;
  for (const s of NAV_SECTIONS) {
    for (const it of s.items) {
      if (it.href.length <= href.length) continue;
      if (pathname === it.href || pathname.startsWith(`${it.href}/`)) return false;
    }
  }
  return true;
}
