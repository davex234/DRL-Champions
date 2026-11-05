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

  /**
   * TRÍO EDITORIAL — vía de excepción para jugadores sin métricas reales (retirados, históricos,
   * ediciones especiales). Debe estar AUTORIZADO explícitamente por una persona y llevar motivo.
   *
   * Existe para que un jugador legado pueda seguir en el catálogo SIN falsificar `metrics`: nunca
   * se rellenan métricas inventadas para que el modelo las derive. Si un jugador no tiene ni
   * `metrics` válidas ni `editorial`, sencillamente no genera carta (con motivo explícito).
   */
  editorial?: {
    combat: import("./combat").CombatStats;
    /** Por qué se autoriza a mano. Obligatorio: hace auditable la excepción. */
    reason: string;
    /** Quién lo autorizó. */
    author?: string;
  };
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
  | "hall-of-fame"
  // Generadas por el sistema de torneos (autoría admin)
  | "tournament-mvp"
  | "tournament-champion"
  // Premios del Collection Engine (un torneo genera una colección con estos premios)
  | "tournament-rookie"
  | "tournament-clutch"
  | "tournament-top-acs"
  | "tournament-top-rating"
  | "tournament-top-hs"
  | "tournament-top-kills"
  | "tournament-top-assists";

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
  | "hall-of-fame"
  // Edición de torneo (generadas por el admin)
  | "mythic"
  | "champion-edition"
  // Premios del Collection Engine (cartas premio de torneo)
  | "rookie"
  | "clutch"
  | "top-acs"
  | "top-rating"
  | "top-hs"
  | "top-kills"
  | "top-assist"
  // Ediciones del catálogo de cartas diseñadas (Cartas\, 2026-09-21). La edición sale del nombre
  // de fichero; su rareza la fijó el usuario (ver `variants.ts`).
  | "base"
  | "masters-l"
  | "masters-sdc"
  | "future-star"
  | "champions-s"
  | "record-breaker"
  | "moments";

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

/** De dónde salen las estadísticas de una carta. */
export type CardStatsSource = "vlr" | "editorial";

/**
 * Las 6 estadísticas IMPRESAS en una carta del catálogo diseñado: DMG · SCR · FKS · HS · AST · CLU.
 * FKS (primeras bajas) ocupa el lugar que en el modelo anterior tenía COM; no es la misma medida y
 * por eso no se guarda en `PlayerStats`.
 */
export interface PrintedStats {
  dmg: number;
  scr: number;
  fks: number;
  hs: number;
  ast: number;
  clu: number;
}

export type PrintedStatKey = keyof PrintedStats;

/** Lo que la carta diseñada IMPRIME. Manda sobre lo derivado para presentación, OVR y rol. */
export interface CardPrinted {
  ovr: number;
  role: RoleId;
  stats: PrintedStats;
}

/** Entrada del catálogo generado desde `Cartas\` (`src/data/cardCatalog.ts`). */
export interface CardManifestEntry {
  id: string;
  playerId: string;
  variantId: string;
  ovr: number;
  role: string;
  stats: PrintedStats;
  /** Fichero original de `Cartas\` y su SHA-256: trazabilidad de cada carta. */
  source: string;
  sha256: string;
}

/** Una carta concreta del catálogo (definición, sin instancia poseída). */
export interface CardDef {
  id: string; // `${playerId}__${variantId}`
  playerId: string;
  variantId: VariantId;
  /** OVR final ya calculado para esta combinación jugador+variante. */
  ovr: number;
  stats: PlayerStats;

  // ── Modelo de combate (Fase 2). Los rellena SIEMPRE el constructor del catálogo. ──
  /** Trío Stronghold/Gamesense/Entryfrag, con el statBoost de la variante YA aplicado. */
  combat?: import("./combat").CombatStats;
  /** Bonus de la variante usado para llegar a `combat` y `ovr`. Uno de 0/2/4/6/9/12. */
  statBoost?: number;
  /** Calibración con la que se generó (p. ej. "VCT-2026"). Permite reanclajes trazables. */
  dataVersion?: string;
  /** Origen de las estadísticas: derivadas de datos reales o autoría editorial. */
  source?: CardStatsSource;
  /** Marca de generación (ISO). La inyecta quien construye el catálogo; nunca `Date.now()` interno. */
  generatedAt?: string;

  // ── Catálogo diseñado (Cartas\). Ausentes en cartas que no salen de una imagen. ──
  /** Lo impreso en la carta: OVR, rol y las 6 estadísticas (con FKS). */
  printed?: CardPrinted;
  /**
   * Rol de la CARTA. Cuando existe, manda sobre el del jugador en duelo, mazo y colección: la
   * carta impresa decide (decisión del usuario, 2026-09-21). Ver `cardRole()`.
   */
  role?: RoleId;
  /** Imagen completa de la carta (derivado web en `/cards/<id>.webp`). */
  image?: string;
  /**
   * Equipo IMPRESO en la carta: la etiqueta con la que se diseñó (prefijo del fichero de `Cartas\`,
   * p. ej. «FNATIC», «GenG», «VIT»). Es el equipo de la CARTA —el del logo que se ve—, que no siempre
   * es el de `Player.team` (el roster actual). Agrupa colección, maestría, logros y Team Packs; no
   * afecta al duelo ni a la huella. Ver `canonicalCardTeam()` en `data/teamIdentities`.
   */
  team?: string;
}

/** Rol con el que juega una carta: el impreso si lo tiene, si no el de su jugador. */
export const cardRole = (card: Pick<CardDef, "role">, player: Pick<Player, "role">): RoleId =>
  card.role ?? player.role;

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
  /**
   * Versión de la definición bajo la que se acuñó este ejemplar (bloque 8.2).
   *
   * Es lo que hace que editar una carta NO cambie la que ya tienes: quien resuelve un
   * ejemplar debe pedir ESTA versión, no la vigente. Opcional porque el dominio también se
   * usa sin servidor (tests, modo local) y porque una carta fuera del catálogo no tiene
   * versión que citar; en esos casos se cae a la definición viva, igual que antes de 8.2.
   */
  mintedVersion?: number | null;
}
