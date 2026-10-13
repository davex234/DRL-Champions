/**
 * FASE 44 · MODELO DEL ARMAZÓN DE JUEGO (puro, sin React).
 *
 * El armazón deja de ser un navbar: es el MENÚ PRINCIPAL. Esto decide, con datos y no en el JSX:
 *
 *   · qué dice la acción global (JUGAR / CONTINUAR PARTIDA) — solo con la palabra del servidor;
 *   · qué secciones van arriba y en qué orden (jerarquía del encargo: jugar, colección, equipos, sobres, temporada);
 *   · qué salidas tiene cada pantalla principal (detector de callejones sin salida);
 *   · cuántos clics hay desde el vestíbulo a lo importante.
 *
 * La tabla de rutas sigue siendo `nav.ts` (una sola fuente); aquí solo se presenta.
 */
import { NAV_SECTIONS, MOBILE_NAV, IMMERSIVE_ROUTES, isImmersive, sectionForPath, type NavSection } from "./nav";

// ───────────────────────────── Acción global ─────────────────────────────

export interface PlayStatusView {
  resume: { id: string; label: string; href: string; eyebrow: string; title: string } | null;
  unknown?: boolean;
}

export interface PlayCta {
  kind: "play" | "resume";
  label: string;
  href: string;
  /** Texto accesible completo (qué hace, no solo el verbo). */
  ariaLabel: string;
  /** Línea de contexto bajo el verbo en escritorio (modo de la partida abierta). */
  hint: string | null;
}

export const PLAY_HREF = "/jugar";

/**
 * JUGAR salvo que el servidor diga que hay una partida abierta. Sin estado (cargando, sin sesión, error) es JUGAR:
 * nunca se afirma una partida que no consta, y JUGAR siempre lleva a un sitio que funciona (el selector de modos).
 */
export function playCta(status: PlayStatusView | null): PlayCta {
  const r = status && !status.unknown ? status.resume : null;
  if (r && r.href.startsWith("/")) {
    return { kind: "resume", label: "Continuar partida", href: r.href, ariaLabel: `Continuar partida: ${r.eyebrow}`, hint: r.eyebrow };
  }
  return { kind: "play", label: "Jugar", href: PLAY_HREF, ariaLabel: "Jugar: elegir modo de juego", hint: null };
}

// ───────────────────────────── Secciones ─────────────────────────────

/** Orden de las secciones en la barra (sin «jugar», que es el botón). Jerarquía del encargo. */
export const SHELL_ORDER = ["coleccion", "equipos", "tienda", "progreso", "mundo"] as const;

export function shellSections(): NavSection[] {
  return SHELL_ORDER.map((id) => NAV_SECTIONS.find((s) => s.id === id)).filter((s): s is NavSection => !!s);
}

/** La sección «jugar» se presenta como acción; su menú (modos, competitivo, social, eventos…) va en el desplegable. */
export function playSection(): NavSection {
  return NAV_SECTIONS.find((s) => s.id === "jugar")!;
}

/** ¿Se enseña el armazón en esta ruta? Las inmersivas (partida, apertura) traen su propia salida. */
export function shellVisible(pathname: string): boolean {
  return !isImmersive(pathname);
}

/**
 * Pantallas que ya dicen «sin conexión» con su propio contexto (qué sigue funcionando en ESA pantalla). En ellas el
 * armazón no repite el aviso global: un aviso por pantalla, no dos.
 */
export const OWN_OFFLINE_NOTICE = ["/", "/jugar", "/jugar/road-to-champions", "/jugar/draft-gauntlet", "/coleccion"] as const;

export function shellOfflineNotice(pathname: string): boolean {
  return !OWN_OFFLINE_NOTICE.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)));
}

/** Menú completo para la hoja móvil «Menú»: todas las secciones, con JUGAR primero. */
export function mobileMenu(): { id: string; label: string; items: { href: string; label: string }[] }[] {
  return [playSection(), ...shellSections()].map((s) => ({ id: s.id, label: s.label, items: s.items.map((i) => ({ href: i.href, label: i.label })) }));
}

export { MOBILE_NAV, IMMERSIVE_ROUTES, sectionForPath };

// ───────────────────────────── Callejones sin salida ─────────────────────────────

/**
 * Pantallas principales del jugador y sus salidas PROPIAS (además del armazón). Una pantalla con armazón siempre
 * tiene JUGAR e INICIO; las inmersivas tienen que declarar las suyas. El detector exige, para cada pantalla, al menos
 * una salida a JUGAR/INICIO o la siguiente acción lógica.
 */
export interface ScreenExits { path: string; screen: string; immersive: boolean; exits: string[] }

export const CORE_SCREENS: ScreenExits[] = [
  /*
   * FASE 46 · la Home pasa a ser el menú principal del juego y por tanto es INMERSIVA: el armazón
   * ya no le presta JUGAR ni INICIO, así que declara sus propias salidas, que son exactamente sus
   * tres acciones. El detector de callejones sigue exigiéndole al menos una salida de hub.
   */
  { path: "/", screen: "Home · menú principal", immersive: true, exits: ["/jugar", "/boveda", "/tienda"] },
  { path: "/boveda", screen: "Bóveda · hub de inventario", immersive: false, exits: ["/coleccion", "/duelos/mazos", "/colecciones"] },
  { path: "/jugar", screen: "Selector de modos", immersive: false, exits: ["/duelos/jugar", "/duelos/competitivo", "/jugar/road-to-champions", "/jugar/draft-gauntlet", "/social"] },
  { path: "/duelos/jugar", screen: "PvE · preparación, partida y resultado", immersive: true, exits: ["/duelos", "/duelos/mazos", "/jugar"] },
  // F61 · inmersiva (modo partida enfocado): antesala/error → Competitivo; resultado → Competitivo o Duelos (privado).
  { path: "/duelos/pvp", screen: "PvP", immersive: true, exits: ["/competitivo", "/duelos"] },
  { path: "/duelos/competitivo", screen: "Ranked", immersive: false, exits: ["/duelos/pvp", "/duelos/competitivo/historial"] },
  // Fase 55 · el centro competitivo canónico (el de arriba redirige aquí).
  { path: "/competitivo", screen: "Ranked", immersive: false, exits: ["/duelos/pvp", "/duelos/competitivo/historial", "/temporada"] },
  { path: "/jugar/road-to-champions", screen: "Road to Champions", immersive: false, exits: ["/duelos/jugar", "/jugar"] },
  { path: "/jugar/draft-gauntlet", screen: "Draft Gauntlet", immersive: false, exits: ["/duelos/jugar", "/jugar"] },
  { path: "/tienda", screen: "Sobres", immersive: false, exits: ["/abrir", "/inventario"] },
  { path: "/inventario", screen: "Inventario de sobres", immersive: false, exits: ["/abrir", "/tienda"] },
  { path: "/abrir", screen: "Apertura de sobre", immersive: true, exits: ["/coleccion", "/jugar", "/tienda"] },
  { path: "/coleccion", screen: "Colección", immersive: false, exits: ["/coleccion/carta", "/duelos/mazos"] },
  { path: "/coleccion/carta", screen: "Ficha de carta", immersive: false, exits: ["/coleccion", "/duelos/mazos"] },
  { path: "/duelos/mazos", screen: "Equipos", immersive: false, exits: ["/duelos/jugar", "/coleccion"] },
  // IA 2026-10-07 · `/temporada` es el HUB (Pase · Objetivos · Crafteo); el pase vive en `/temporada/pase`; Objetivos en
  // `/misiones`; la progresión (lo conseguido) en Mi cuenta. `/progresion` redirige.
  { path: "/temporada", screen: "Hub de temporada", immersive: false, exits: ["/temporada/pase", "/misiones", "/misiones/crafting"] },
  { path: "/temporada/pase", screen: "Pase de batalla", immersive: false, exits: ["/logros", "/jugar"] },
  { path: "/logros", screen: "Logros y pase", immersive: false, exits: ["/temporada/pase", "/jugar"] },
  { path: "/misiones", screen: "Objetivos", immersive: false, exits: ["/jugar", "/misiones/crafting"] },
  { path: "/misiones/crafting", screen: "Crafteo", immersive: false, exits: ["/misiones/crafting/cartas", "/misiones/crafting/sobres"] },
  { path: "/torneos", screen: "Eventos", immersive: false, exits: ["/pickems"] },
  { path: "/pickems", screen: "Pick'ems", immersive: false, exits: ["/torneos"] },
  { path: "/jugador/me", screen: "Perfil", immersive: false, exits: ["/cuenta", "/coleccion"] },
  { path: "/cuenta", screen: "Mi cuenta", immersive: false, exits: ["/cuenta?seccion=perfil", "/cuenta?seccion=progresion", "/cuenta?seccion=feedback"] },
  { path: "/social", screen: "Social", immersive: false, exits: ["/duelos/pvp"] },
];

/** Salidas efectivas: las propias + las del armazón (JUGAR e INICIO) si la ruta lo enseña. */
export function effectiveExits(s: ScreenExits): string[] {
  const shell = shellVisible(s.path) ? [PLAY_HREF, "/"] : [];
  return [...new Set([...s.exits, ...shell])];
}

/** Destinos que cuentan como «volver al juego»: jugar, vestíbulo o un centro de la sección. */
export const HUB_EXITS = [PLAY_HREF, "/", "/duelos", "/coleccion", "/tienda"] as const;

/** Callejón sin salida: ninguna salida, o una pantalla inmersiva sin camino a un centro del juego. */
export function isDeadEnd(s: ScreenExits): boolean {
  const e = effectiveExits(s);
  if (e.length === 0) return true;
  return s.immersive && !e.some((x) => (HUB_EXITS as readonly string[]).includes(x));
}

// ───────────────────────────── Profundidad de clic ─────────────────────────────

/**
 * Clics desde el vestíbulo, contados sobre la navegación REAL (armazón + enlaces fijos de cada pantalla). Un clic =
 * una pulsación que cambia de pantalla. «Abrir sobre propio» cuenta desde el botón ABRIR del vestíbulo/inventario.
 */
export const CLICK_DEPTH: { goal: string; path: string[]; clicks: number }[] = [
  { goal: "Jugar (selector de modos)", path: ["JUGAR (armazón)"], clicks: 1 },
  { goal: "Jugar PvE", path: ["JUGAR (armazón)", "Partida rápida"], clicks: 2 },
  { goal: "Jugar Ranked", path: ["JUGAR (armazón)", "Competitivo"], clicks: 2 },
  { goal: "Road to Champions", path: ["Modo del vestíbulo: Road to Champions"], clicks: 1 },
  { goal: "Draft Gauntlet", path: ["Modo del vestíbulo: Draft"], clicks: 1 },
  { goal: "Abrir sobre propio", path: ["ABRIR SOBRE (vestíbulo)"], clicks: 1 },
  { goal: "Colección", path: ["COLECCIÓN (armazón)"], clicks: 1 },
  { goal: "Equipos", path: ["EQUIPOS (armazón)"], clicks: 1 },
];
