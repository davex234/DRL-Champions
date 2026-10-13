/**
 * FASE 44.1 · GAME ENVIRONMENT — modelo puro del mundo que hay DETRÁS de la interfaz.
 *
 * Cada sección declara su ambiente (`environmentForPath`) y cada ambiente declara sus capas:
 *
 *   L0 base         degradado profundo propio + textura de grano (nunca negro plano)
 *   L1 arquitectura formas grandes originales en SVG (bóveda, cámara, sala táctica, horizonte…)
 *   L2 luz          2–3 focos de color que derivan muy despacio
 *   L3 partículas   polvo acotado (canvas único)
 *   L4 interfaz     (el contenido)
 *   L5 contexto     reacción al modo apuntado en el lobby, atenuado antes de abrir un sobre
 *
 * Presupuesto: como mucho 3 fuentes de movimiento ambiental por ambiente (deriva de luz, barrido, partículas),
 * parallax 4–12 px por capa y nada con `prefers-reduced-motion`. Solo `transform`/`opacity`.
 */

export type EnvironmentVariant =
  | "lobby" | "collection" | "packs" | "loadout" | "campaign" | "draft" | "ranked" | "season" | "match" | "events" | "profile" | "world";

export type Architecture = "arena" | "vault" | "chamber" | "tactical" | "terrain" | "triptych" | "ladder" | "horizon" | "rings" | "bracket" | "gallery" | "globe";

export interface EnvironmentSpec {
  variant: EnvironmentVariant;
  /** Nombre del lugar (solo para el arnés y lectores de documentación; no se muestra al jugador). */
  place: string;
  base: [string, string];
  primary: [number, number, number];
  secondary: [number, number, number];
  architecture: Architecture;
  particles: number;
  drift: number;
  /** Fuentes de movimiento ambiental (≤ 3). */
  motion: ("light" | "sweep" | "particles" | "float")[];
  /** Parallax máximo en px de la capa más cercana (0 = sin parallax). */
  parallax: number;
  /** Oscuridad extra alrededor del foco (cámara de sobres, draft). 0..1 */
  dim: number;
}

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

export const ENVIRONMENTS: Record<EnvironmentVariant, EnvironmentSpec> = {
  lobby: { variant: "lobby", place: "Lobby · arena de acceso", base: ["#120a1c", "#050810"], primary: rgb("#ff2e63"), secondary: rgb("#19e3ff"), architecture: "arena", particles: 28, drift: 5, motion: ["light", "sweep", "particles"], parallax: 10, dim: 0 },
  collection: { variant: "collection", place: "La bóveda de cartas", base: ["#0e0b22", "#04060d"], primary: rgb("#7b5cff"), secondary: rgb("#19e3ff"), architecture: "vault", particles: 20, drift: 3, motion: ["light", "particles", "float"], parallax: 8, dim: 0.1 },
  packs: { variant: "packs", place: "Cámara de sobres", base: ["#140d06", "#030306"], primary: rgb("#ffd35c"), secondary: rgb("#ff2e63"), architecture: "chamber", particles: 24, drift: 4, motion: ["light", "particles", "float"], parallax: 8, dim: 0.35 },
  loadout: { variant: "loadout", place: "Sala táctica de equipos", base: ["#06140f", "#03070a"], primary: rgb("#3fc07a"), secondary: rgb("#19e3ff"), architecture: "tactical", particles: 10, drift: 2, motion: ["light", "sweep"], parallax: 4, dim: 0 },
  campaign: { variant: "campaign", place: "Mapa del circuito", base: ["#051523", "#03060c"], primary: rgb("#19e3ff"), secondary: rgb("#3a6bff"), architecture: "terrain", particles: 18, drift: 4, motion: ["light", "particles"], parallax: 8, dim: 0 },
  draft: { variant: "draft", place: "Cámara de draft", base: ["#171005", "#040305"], primary: rgb("#ffb03d"), secondary: rgb("#ffd35c"), architecture: "triptych", particles: 16, drift: 3, motion: ["light", "particles"], parallax: 6, dim: 0.3 },
  ranked: { variant: "ranked", place: "Escenario competitivo", base: ["#1a0610", "#050308"], primary: rgb("#ff2e63"), secondary: rgb("#ff8a3d"), architecture: "ladder", particles: 12, drift: 6, motion: ["light", "sweep"], parallax: 6, dim: 0.15 },
  season: { variant: "season", place: "Horizonte de temporada", base: ["#061526", "#04050c"], primary: rgb("#19e3ff"), secondary: rgb("#ffd35c"), architecture: "horizon", particles: 22, drift: 4, motion: ["light", "particles"], parallax: 8, dim: 0 },
  match: { variant: "match", place: "Arena de duelo", base: ["#16060d", "#040409"], primary: rgb("#ff2e63"), secondary: rgb("#ff5c8a"), architecture: "rings", particles: 26, drift: 8, motion: ["light", "particles"], parallax: 0, dim: 0.2 },
  events: { variant: "events", place: "Sala del circuito", base: ["#170c05", "#05040a"], primary: rgb("#ff8a3d"), secondary: rgb("#ffd35c"), architecture: "bracket", particles: 16, drift: 5, motion: ["light", "particles"], parallax: 6, dim: 0 },
  profile: { variant: "profile", place: "Galería del jugador", base: ["#071322", "#04050c"], primary: rgb("#19e3ff"), secondary: rgb("#7b5cff"), architecture: "gallery", particles: 12, drift: 3, motion: ["light", "particles"], parallax: 6, dim: 0 },
  world: { variant: "world", place: "El mundo NEXUS", base: ["#061510", "#03070a"], primary: rgb("#3fc07a"), secondary: rgb("#19e3ff"), architecture: "globe", particles: 16, drift: 4, motion: ["light", "particles"], parallax: 6, dim: 0 },
};

const ROUTES: [EnvironmentVariant, string[]][] = [
  ["match", ["/duelos/jugar", "/duelos/pvp", "/duelos/replay", "/entrenador/partido"]],
  ["loadout", ["/duelos/mazos", "/equipo", "/coleccion/equipos"]],
  ["campaign", ["/jugar/road-to-champions"]],
  ["draft", ["/jugar/draft-gauntlet"]],
  ["ranked", ["/competitivo", "/duelos/competitivo", "/ranking"]],
  ["collection", ["/coleccion", "/colecciones", "/mercado"]],
  ["packs", ["/tienda", "/packs", "/inventario", "/abrir", "/eventos"]],
  ["season", ["/temporada", "/temporadas", "/logros", "/progresion", "/recompensas"]],
  ["events", ["/torneos", "/pickems"]],
  ["profile", ["/jugador", "/cuenta", "/social"]],
  ["world", ["/mundo", "/noticias", "/carrera", "/manager", "/entrenador"]],
  ["lobby", ["/jugar", "/duelos"]],
];

/** Ambiente de una ruta: la coincidencia MÁS específica gana; el resto es el lobby. */
export function environmentForPath(pathname: string): EnvironmentVariant {
  let best: EnvironmentVariant = "lobby";
  let len = -1;
  for (const [variant, prefixes] of ROUTES) {
    for (const p of prefixes) {
      if ((pathname === p || pathname.startsWith(`${p}/`)) && p.length > len) { best = variant; len = p.length; }
    }
  }
  return best;
}

/** Foco de modo en el lobby (reacción del ambiente al apuntar un modo). */
export type EnvironmentFocus = "quick" | "ranked" | "campaign" | "draft" | null;

export const FOCUS_TINT: Record<Exclude<EnvironmentFocus, null>, [number, number, number]> = {
  quick: rgb("#19e3ff"),
  ranked: rgb("#ff2e63"),
  campaign: rgb("#3a6bff"),
  draft: rgb("#ffb03d"),
};

export const ENV_FOCUS_EVENT = "nexus:env-focus";
export const ENV_DIM_EVENT = "nexus:env-dim";
/** Duración del cambio de tinte al apuntar un modo (encargo: 200–400 ms). */
export const FOCUS_TRANSITION_MS = 320;

/** Desplazamiento de parallax de una capa (0 = fondo … 1 = más cercana) para un puntero normalizado −1..1. */
export function parallaxOffset(spec: EnvironmentSpec, depth: number, nx: number, ny: number, reduced: boolean): { x: number; y: number } {
  if (reduced || spec.parallax === 0) return { x: 0, y: 0 };
  const clamp = (v: number) => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));
  const k = spec.parallax * Math.max(0, Math.min(1, depth));
  return { x: Math.round(clamp(nx) * k * 10) / 10, y: Math.round(clamp(ny) * k * 0.6 * 10) / 10 };
}

/** Partículas efectivas: acotadas por ambiente y apagadas del todo en pantallas pequeñas con ahorro. */
export function particleBudget(spec: EnvironmentSpec, width: number, reduced: boolean): number {
  if (reduced) return Math.min(spec.particles, 12);
  const scale = width < 640 ? 0.5 : width < 1100 ? 0.75 : 1;
  return Math.max(0, Math.min(40, Math.round(spec.particles * scale)));
}

/**
 * Atenuado de la cámara de sobres por fase de la ceremonia: la sala se oscurece ANTES de abrir (petición/corte) para que
 * el sobre sea lo único encendido, al máximo mientras salen las cartas y se relaja en el resumen. Presentación pura.
 */
export function packChamberDim(phase: string): number {
  switch (phase) {
    case "requesting": case "recovering": return 0.45;
    case "opening": return 0.7;
    // F81 · la sala se apaga más al concentrarse la energía y deja la HERO sola en escena.
    case "buildup": return 0.8;
    case "hero": case "hero_hold": return 0.85;
    // Walkout 0.5 · el walkout ocupa toda la pantalla con su propia arena: la sala, apagada del todo.
    case "walkout": return 0.9;
    case "rest": return 0.6;
    case "summary": return 0.25;
    default: return 0;
  }
}

/** Pide al ambiente un atenuado 0..1 (0 = sala normal). Nunca decide nada. */
export function dimEnvironment(level: number): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ENV_DIM_EVENT, { detail: Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0)) }));
}

/** `#rrggbb` → `r,g,b` para luces con alfa (si no es un hex válido, luz neutra). */
export function hexToRgbTriplet(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? rgb(hex).join(",") : "200,210,230";
}
