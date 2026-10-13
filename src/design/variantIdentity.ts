/**
 * IDENTIDAD DE VARIANTE — la única fuente de verdad de qué ASPECTO tiene cada variante.
 *
 * ────────────────────────── EL PROBLEMA ──────────────────────────
 *
 * Las cartas ya tienen materia (chaflán, canto, placa, escalera de material por rareza), pero
 * las ocho variantes reales solo se distinguían por el tono. Y ni siquiera por eso: medido
 * sobre las paletas del dominio,
 *
 *     #ff2e63  →  mythic · clutch · top-kills      ← TRES variantes, color idéntico
 *     #ffd35c  →  top-rating · champions-mvp       ← DOS
 *     #ffe08a  →  champion-edition                 ← a un paso de las anteriores
 *
 * Cuatro de las ocho son indistinguibles por color **por construcción**, así que el color no
 * puede ser la señal. Había que leer una etiqueta de diez píxeles para saber qué carta era.
 *
 * ────────────────────────── EL SISTEMA ──────────────────────────
 *
 * Una GRAMÁTICA COMÚN y una DIFERENCIA RECONOCIBLE, en tres piezas:
 *
 *   1. **El sello** — una silueta geométrica. Es el identificador primario y funciona SIN
 *      color, sin animación y a 12 px. Cuatro siluetas para cuatro reconocimientos:
 *
 *        ◆ rombo con estrella   MVP           el jugador fue el mejor
 *        ♛ corona de almenas    CAMPEÓN       su equipo ganó el torneo
 *        ◎ anillo con muesca    CLUTCH        se quedó solo y ganó
 *        ▲ galón ascendente     TOP           lideró una estadística
 *
 *   2. **El código** — solo dentro de la familia TOP, que son cinco. El galón dice «esto es
 *      una TOP»; dos o tres letras dicen cuál. Es lo que evita cinco diseños distintos para
 *      lo que conceptualmente es una sola cosa.
 *
 *   3. **La marca de torneo** — una micrografía en el canto. Responde a «¿cuáles son
 *      especiales?» antes que a «¿cuál es cuál?», y también sin color.
 *
 * ────────────────────────── QUÉ NO ES ──────────────────────────
 *
 * **Solo presentación.** Aquí no hay ni una regla de generación, ni un umbral, ni un dato de
 * juego. No decide qué variante recibe una carta: describe cómo se dibuja una variante que
 * el dominio ya decidió. `variants.ts` sigue siendo el dueño del rank, el statBoost, la serie
 * y la paleta, y este módulo no los toca.
 */
import type { VariantId } from "@/domain/cards/types";

/** Las siluetas del sistema. `null` = la variante no lleva sello (cartas base). */
export type SealShape = "mvp" | "champion" | "clutch" | "top" | null;

/**
 * Familia visual. Comparten gramática; dentro de una familia cambia el `code`.
 *
 * No es el `group` del dominio: `group` clasifica de dónde SALE la carta (base, regional,
 * internacional, exclusiva) y esto clasifica QUÉ RECONOCE. Un `mythic` y un `champions-mvp`
 * están en grupos distintos del dominio y son la misma familia visual: los dos son MVP.
 */
export type VariantFamily = "base" | "mvp" | "champion" | "clutch" | "top";

export interface VariantIdentity {
  family: VariantFamily;
  /** La silueta. Identificador primario, independiente del color. */
  seal: SealShape;
  /** Identificador secundario dentro de la familia. Solo lo usa TOP. */
  code?: string;
  /** Nombre del sello para lectores de pantalla. Nunca vacío si hay sello. */
  sealLabel?: string;
  /**
   * Carta nacida de un torneo. Enciende la micrografía del canto, que es lo que separa
   * «especial» de «base» de un vistazo y sin leer.
   */
  tournament: boolean;
  /**
   * La variante existe en el dominio pero NO está desbloqueada en el producto. No recibe
   * sello: dárselo sería anunciar una carta que nadie puede tener. Ver `rookie`.
   */
  blocked?: boolean;
}

/** Identidad neutra. Es el respaldo TOTAL: ninguna variante se queda sin identidad. */
const BASE: VariantIdentity = { family: "base", seal: null, tournament: false };

/**
 * El mapa. Solo entran las variantes que reconocen ALGO; el resto cae en `BASE`.
 *
 * Está escrito a mano y no derivado del `group` a propósito: la familia visual es una
 * decisión editorial («esto es un MVP», «esto es un campeón») y derivarla de un campo del
 * dominio ataría la presentación a una clasificación que no se hizo para esto.
 */
const IDENTITY: Partial<Record<VariantId, VariantIdentity>> = {
  /* ── MVP · rendimiento excepcional ── */
  mythic: { family: "mvp", seal: "mvp", sealLabel: "MVP del torneo", tournament: true },
  "champions-mvp": { family: "mvp", seal: "mvp", sealLabel: "MVP", tournament: true },
  "masters-mvp": { family: "mvp", seal: "mvp", sealLabel: "MVP", tournament: true },
  "ewc-mvp": { family: "mvp", seal: "mvp", sealLabel: "MVP", tournament: true },
  "emea-mvp": { family: "mvp", seal: "mvp", sealLabel: "MVP", tournament: true },
  "americas-mvp": { family: "mvp", seal: "mvp", sealLabel: "MVP", tournament: true },
  "pacific-mvp": { family: "mvp", seal: "mvp", sealLabel: "MVP", tournament: true },
  "china-mvp": { family: "mvp", seal: "mvp", sealLabel: "MVP", tournament: true },

  /* ── CAMPEÓN · su equipo ganó ── */
  "champion-edition": { family: "champion", seal: "champion", sealLabel: "Campeón del torneo", tournament: true },
  "champions-winner": { family: "champion", seal: "champion", sealLabel: "Campeón", tournament: true },
  "masters-winner": { family: "champion", seal: "champion", sealLabel: "Campeón", tournament: true },
  "ewc-winner": { family: "champion", seal: "champion", sealLabel: "Campeón", tournament: true },
  "emea-winner": { family: "champion", seal: "champion", sealLabel: "Campeón", tournament: true },
  "americas-winner": { family: "champion", seal: "champion", sealLabel: "Campeón", tournament: true },
  "pacific-winner": { family: "champion", seal: "champion", sealLabel: "Campeón", tournament: true },
  "china-winner": { family: "champion", seal: "champion", sealLabel: "Campeón", tournament: true },

  /* ── CLUTCH · se quedó solo y ganó ── */
  clutch: { family: "clutch", seal: "clutch", sealLabel: "Rey del clutch", tournament: true },

  /* ──
     TOP · lideró una estadística.
     Mismo galón para las cinco; el código dice cuál. Son códigos CORTOS a propósito: a
     150 px de carta, «HEADSHOTS» no cabe al lado de un sello y «HS» sí.
  ── */
  "top-rating": { family: "top", seal: "top", code: "RAT", sealLabel: "Líder en rating", tournament: true },
  "top-acs": { family: "top", seal: "top", code: "ACS", sealLabel: "Líder en ACS", tournament: true },
  "top-kills": { family: "top", seal: "top", code: "K", sealLabel: "Líder en bajas", tournament: true },
  "top-assist": { family: "top", seal: "top", code: "A", sealLabel: "Líder en asistencias", tournament: true },
  "top-hs": { family: "top", seal: "top", code: "HS", sealLabel: "Líder en headshots", tournament: true },

  /*
   * ROOKIE — bloqueada. Existe en el dominio (rank 10, serie /200) pero el pipeline no puede
   * concederla: no hay fuente de `status` que diga quién es novato. Sin sello, y marcada, para
   * que si alguien la desbloquea tenga que decidir su identidad a propósito y no por descuido.
   */
  rookie: { family: "base", seal: null, tournament: false, blocked: true },
};

/**
 * La identidad visual de una variante. **Total**: siempre devuelve algo.
 *
 * Una variante sin entrada es una carta base —bronce, plata, oro, regionales—, que es el caso
 * correcto: no reconocen nada, así que no llevan sello.
 */
export function variantIdentity(id: VariantId): VariantIdentity {
  return IDENTITY[id] ?? BASE;
}

/** Las variantes que llevan sello, para inventarios y tests. */
export function sealedVariants(): VariantId[] {
  return (Object.keys(IDENTITY) as VariantId[]).filter((id) => IDENTITY[id]?.seal !== null);
}
