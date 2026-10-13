/**
 * IDENTIDAD DE RAREZA EN LA CEREMONIA (Fase 9.6).
 *
 * EL PROBLEMA. La revelación ya distinguía nueve niveles de animación, pero solo en UNA
 * variable: cuánto tardaba en girar la carta (`BUILDUP`). Todo lo demás —el color del
 * fondo, las partículas, los rayos— salía de dos `if` sueltos («¿es cinematic?», «¿es
 * winner?»). El resultado: una Icon Series y una Plata se revelaban con el mismo dibujo a
 * distinta velocidad, que es exactamente lo que hace que abrir un sobre canse.
 *
 * Una rareza alta tiene que verse distinta ANTES de que se vea la carta. Ese es el
 * mecanismo: la tensión no está en la carta, está en lo que la anuncia.
 *
 * QUÉ HACE ESTE FICHERO. Convierte el nivel de animación de la variante —que ya vive en
 * el dominio (`domain/cards/variants.ts`) y NO se toca— en una receta de presentación.
 * Añadir un nivel de animación nuevo al dominio y olvidarse de esto da un fallo de tipos.
 *
 * Las cinco palancas, y por qué cada una:
 *
 *   · `buildup`  — cuánto dura la tensión antes del giro. Es la palanca principal.
 *   · `rays`     — corona radial giratoria. Solo la parte alta: si la lleva todo, no anuncia.
 *   · `ring`     — onda de choque al aterrizar. Marca el «ha pasado algo».
 *   · `shards`   — esquirlas que ascienden. El vocabulario geométrico de NEXUS, no chispas.
 *   · `burst`    — cuántas partículas estallan. 0 = ninguna.
 *
 * COSTE. Las partículas se dibujan UNA vez y se destruyen; no hay bucles infinitos salvo
 * los rayos, que solo existen en las tres rarezas más altas y mientras dura su carta.
 */
import type { VariantDef } from "@/domain/cards/types";
import type { RarityBucket } from "@/domain/packs/types";

/** Los niveles de animación que declara el dominio. */
export type AnimationLevel = VariantDef["animation"];

export interface CeremonySpec {
  /** Milisegundos de tensión antes del giro. */
  buildup: number;
  /** Corona radial giratoria detrás de la carta. */
  rays: boolean;
  /** Onda de choque circular al aterrizar. */
  ring: boolean;
  /** Esquirlas geométricas que ascienden. */
  shards: number;
  /** Partículas del estallido. */
  burst: number;
  /** Confeti. Reservado a las cartas de campeonato («Winner»), que es lo que celebran. */
  confetti: boolean;
  /** Cuánto se oscurece la sala. La parte alta apaga la luz antes de encenderla. */
  dim: number;
  /** Etiqueta que se canta antes de girar la carta. Vacía = no se canta nada. */
  herald: string;
}

/**
 * La escalera de ceremonias. Está escrita para que la diferencia se NOTE de un escalón al
 * siguiente: si `basic` y `metallic` solo se diferencian en 200 ms, el jugador no lo ve.
 */
export const CEREMONY: Record<AnimationLevel, CeremonySpec> = {
  // Base: rápido y limpio. La mayoría de las cartas de un sobre son estas, y una ceremonia
  // larga repetida cuatro veces por sobre se convierte en un peaje.
  basic:     { buildup: 320,  rays: false, ring: false, shards: 0,  burst: 0,   confetti: false, dim: 0,    herald: "" },
  metallic:  { buildup: 480,  rays: false, ring: false, shards: 0,  burst: 14,  confetti: false, dim: 0,    herald: "" },
  premium:   { buildup: 720,  rays: false, ring: true,  shards: 0,  burst: 26,  confetti: false, dim: 0.1,  herald: "" },

  // Aquí empieza a merecer la pena mirar.
  special:   { buildup: 1000, rays: false, ring: true,  shards: 7,  burst: 40,  confetti: false, dim: 0.22, herald: "Exclusiva" },
  winner:    { buildup: 1200, rays: false, ring: true,  shards: 5,  burst: 48,  confetti: true,  dim: 0.26, herald: "Campeón" },
  extended:  { buildup: 1250, rays: true,  ring: true,  shards: 8,  burst: 54,  confetti: false, dim: 0.3,  herald: "MVP" },

  // La cúspide. La sala se apaga antes de encenderse.
  cinematic: { buildup: 1750, rays: true,  ring: true,  shards: 11, burst: 76,  confetti: false, dim: 0.48, herald: "Cinemática" },
  legendary: { buildup: 2150, rays: true,  ring: true,  shards: 13, burst: 92,  confetti: false, dim: 0.58, herald: "Legendaria" },
  icon:      { buildup: 2500, rays: true,  ring: true,  shards: 15, burst: 110, confetti: false, dim: 0.66, herald: "Icónica" },
};

export function ceremonyFor(variant: VariantDef): CeremonySpec {
  return CEREMONY[variant.animation] ?? CEREMONY.basic;
}

/**
 * LA ÚLTIMA CARTA — más ceremonia, la MISMA carta.
 *
 * El último hueco del sobre es el que el jugador espera: es donde muchos sobres colocan su
 * garantía (`guaranteedMin` se aplica precisamente a la última carta, ver
 * `domain/packs/openPack.slotRequirements`) y es el final del acto. Presentarlo igual que el
 * segundo desperdicia el único momento de la ceremonia que ya viene cargado de intención.
 *
 * ────────────────────────── LO QUE ESTO NO HACE ──────────────────────────
 *
 * **No cambia la carta.** No la mejora, no la re-sortea, no la reordena y no canta una rareza
 * que no es. Si la quinta carta es una Bronce, esto le da 300 ms más de tensión y una sala un
 * poco más oscura para enseñar una Bronce. La tentación evidente —«guardar la mejor para el
 * final»— sería mentir sobre el resultado del sorteo, y el sorteo ya decidió el orden en
 * `PackEngine.draw` (de menor a mayor rareza) antes de que esta pantalla existiera.
 *
 * Solo se toca INTENSIDAD, nunca identidad: ni `herald` ni `confetti` se inventan aquí, porque
 * son los dos que ANUNCIAN algo concreto. Subir el heraldo de una común sería un fake-out, y
 * el §9 del encargo los prohíbe expresamente.
 */
export function lastCardCeremony(spec: CeremonySpec): CeremonySpec {
  return {
    ...spec,
    buildup: spec.buildup + 300,
    ring: true,
    dim: Math.min(0.7, spec.dim + 0.14),
  };
}

/* ═══════════════════════ FASE 38 · RECETA POR RAREZA REAL ═══════════════════════
 *
 * La revelación 3.0 escala por la RAREZA del catálogo (común → legendaria), no por el nivel de animación de la
 * variante: el jugador aprende cinco escalones que ve escritos, no nueve. Se reutilizan los escalones de `CEREMONY`
 * (sin tocarlos) con tres cambios: el heraldo lo pone el plan (la rareza real o «Serial #1»), no hay confeti
 * (nada de celebración infantil) y el estallido nunca pasa de `MAX_BURST` partículas DOM.
 */
export const RARITY_CEREMONY: Record<RarityBucket, AnimationLevel> = {
  common: "basic", uncommon: "metallic", rare: "premium", epic: "extended", legendary: "legendary",
};

/** Tope de partículas por estallido: por encima, el DOM y la GPU pagan más de lo que se ve. */
export const MAX_BURST = 40;

export function rarityCeremony(rarity: RarityBucket): CeremonySpec {
  const s = CEREMONY[RARITY_CEREMONY[rarity]];
  return { ...s, herald: "", confetti: false, burst: Math.min(s.burst, MAX_BURST) };
}

/**
 * Versión reducida para quien pide menos movimiento.
 *
 * No es «la misma ceremonia más lenta»: es la carta, su color y nada más. La preferencia
 * dice «no quiero ver movimiento», no «quiero esperar más».
 */
export function stillCeremony(spec: CeremonySpec): CeremonySpec {
  return { ...spec, buildup: 260, rays: false, ring: false, shards: 0, burst: 0, confetti: false, dim: 0 };
}
