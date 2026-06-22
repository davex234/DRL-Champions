/**
 * Tipos fundamentales del sistema de cartas de DRL Champions.
 *
 * Una CARTA = un JUGADOR (datos reales) combinado con una VARIANTE
 * (bronce, oro, Masters MVP, Icon...). El catálogo completo se genera
 * de forma data-driven a partir de jugadores × variantes, lo que permite
 * añadir torneos, regiones y ediciones nuevas durante años sin reescribir
 * la lógica del juego.
 */

/** Las 6 estadísticas base de cada jugador (escala 0-99). */
export interface PlayerStats {
  /** DMG — Daño por ronda */
  dmg: number;
  /** SCR — Puntuación de combate (ACS) */
  scr: number;
  /** COM — Combate (rating K/D) */
  com: number;
  /** HS — Porcentaje de headshots */
  hs: number;
  /** AST — Asistencias */
  ast: number;
  /** CLU — Clutch */
  clu: number;
}

export type StatKey = keyof PlayerStats;

export type Region = "EMEA" | "Americas" | "Pacific" | "China";

export type RoleId = "Duelista" | "Iniciador" | "Centinela" | "Controlador" | "Flex";

/** Jugador profesional real (dato semilla). */
export interface Player {
  id: string;
  /** Nick competitivo, p. ej. "Benjy" */
  nick: string;
  fullName?: string;
  team: string;
  teamTag: string;
  region: Region;
  role: RoleId;
  country: string; // código ISO de 2 letras (para bandera)
  stats: PlayerStats;
  /** Ediciones especiales para las que clasifica este jugador. */
  accolades: AccoladeId[];
  /** Ruta opcional de la foto. Por defecto `/players/{id}.png`. */
  image?: string;
  /** Estado competitivo. Por defecto "activo". */
  status?: "active" | "inactive";
  /** Métricas reales de origen (permiten regenerar las stats). */
  metrics?: import("./statsFromMetrics").RawMetrics;
}

/**
 * Logros/palmarés que desbloquean variantes especiales para un jugador.
 * El generador de catálogo usa esto para decidir qué cartas existen.
 */
export type AccoladeId =
  // Participación (carta SERIES internacional)
  | "masters"
  | "champions"
  | "ewc"
  // Palmarés
  | "masters-winner"
  | "masters-mvp"
  | "champions-winner"
  | "champions-mvp"
  | "ewc-winner"
  | "ewc-mvp"
  | "regional-winner"
  | "regional-mvp"
  | "prime"
  | "game-changers"
  | "icon"
  | "hall-of-fame";

/** Nivel de animación de apertura (de menor a mayor espectacularidad). */
export type AnimationLevel =
  | "basic" // Bronce
  | "metallic" // Plata
  | "premium" // Oro / regional / internacional base
  | "special" // Prime
  | "winner" // Ganadores (trofeos + confeti)
  | "extended" // MVP regional / Game Changers
  | "cinematic" // Masters MVP / EWC MVP
  | "legendary" // Champions MVP / Hall of Fame
  | "icon"; // Icon Series (la mejor del juego)

export type VariantGroup =
  | "base"
  | "regional"
  | "mvp"
  | "winner"
  | "internacional"
  | "exclusiva";

/** Identificador de cada variante de carta. */
export type VariantId =
  // Base
  | "bronze"
  | "silver"
  | "gold"
  // Regionales
  | "emea"
  | "americas"
  | "pacific"
  | "china"
  // MVP regionales
  | "emea-mvp"
  | "americas-mvp"
  | "pacific-mvp"
  | "china-mvp"
  // Ganadores regionales
  | "emea-winner"
  | "americas-winner"
  | "pacific-winner"
  | "china-winner"
  // Internacionales
  | "masters"
  | "masters-winner"
  | "masters-mvp"
  | "champions"
  | "champions-winner"
  | "champions-mvp"
  | "ewc"
  | "ewc-winner"
  | "ewc-mvp"
  // Exclusivas
  | "prime"
  | "game-changers"
  | "icon-series"
  | "hall-of-fame";

export interface RarityPalette {
  /** Color principal del marco. */
  primary: string;
  /** Color secundario / brillo. */
  secondary: string;
  /** Color del texto sobre el marco. */
  text: string;
  /** Estilo de fondo CSS (gradiente). */
  background: string;
}

/** Definición completa e inmutable de una variante de carta. */
export interface VariantDef {
  id: VariantId;
  label: string; // nombre en español mostrado en UI
  group: VariantGroup;
  animation: AnimationLevel;
  /** Cuanto mayor, más rara/valiosa (1 = bronce ... 15+ = icon/HOF). */
  rank: number;
  /** Bonus sumado a cada estadística respecto a la base del jugador. */
  statBoost: number;
  /** Si lleva número de serie (#1/100...). */
  serialized: boolean;
  /** Tamaño de la tirada limitada (solo si serialized). */
  serialLimit?: number;
  /** Región asociada (regionales / mvp / winner regionales). */
  region?: Region;
  palette: RarityPalette;
}

/** Una carta concreta del catálogo (definición, sin instancia poseída). */
export interface CardDef {
  id: string; // `${playerId}__${variantId}`
  playerId: string;
  variantId: VariantId;
  /** OVR final ya calculado para esta combinación jugador+variante. */
  ovr: number;
  stats: PlayerStats;
}

/**
 * Instancia poseída por el usuario. Las cartas serializadas tienen un
 * número de serie único; los números bajos valen más.
 */
export interface OwnedCard {
  /** Identificador único de la instancia. */
  uid: string;
  cardId: string; // referencia a CardDef.id
  /** Número de serie (1..serialLimit) si la variante es serializada. */
  serial?: number;
  /** Marca de tiempo de obtención. */
  obtainedAt: number;
}
