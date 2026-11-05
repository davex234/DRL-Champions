/**
 * TEMPORADA ACTUAL DEL PASE (Fase 9E).
 *
 * El motor del pase (`@/battlepass`) existía desde la Fase 6 de Colección, completo y con
 * tests, pero **sin una sola temporada definida y sin ninguna interfaz**: cero
 * referencias desde `src/app` o `src/components`. Esto le da contenido.
 *
 * LOS TRES CARRILES, Y POR QUÉ ESTÁN ASÍ REPARTIDOS
 *
 *   · LIBRE — para todo el mundo. Créditos y sobres, en cada nivel.
 *   · COMPETITIVO — se ABRE AL LLEGAR A ORO. No se compra: se juega. Aquí van las
 *     recompensas que más pesan en la colección.
 *   · DE PAGO — SOLO cosmética. Avatares, marcos, banderines y títulos.
 *
 * Ese reparto es la regla §29 de la Fase 9 —el dinero no puede comprar ventaja
 * competitiva— llevada al detalle: cualquier cosa que acabe influyendo en un duelo
 * (cartas, sobres, créditos con los que comprar sobres) está en los carriles que se
 * ganan jugando. El carril de pago no toca la economía. Hay un test que lo comprueba
 * sobre estos mismos datos (`src/battlepass/tracks.test.ts`), así que no puede
 * relajarse por descuido en una temporada futura.
 *
 * El PRECIO no está aquí: vive en `src/config/monetization.ts`, porque es una decisión
 * de negocio que cambia sin tocar el contenido de la temporada.
 */
import type { SeasonDef, MissionDef, Track } from "@/battlepass/types";
import { RANKS } from "@/domain/progression/rank";

/** Puntos necesarios para abrir el carril competitivo: llegar a Oro. */
const ORO_MIN = RANKS.find((r) => r.id === "oro")!.min;

export const SEASON_MAX_LEVEL = 30;
export const SEASON_XP_PER_LEVEL = 1000;

/**
 * Carril LIBRE. Recompensa cada nivel; los múltiplos de 5 dan un sobre, y el 30 cierra
 * la temporada con el mejor. Una recompensa cada nivel hace que subir signifique algo
 * siempre, que es el único motivo por el que alguien mira una barra de progreso.
 */
const FREE: Track = (() => {
  const t: Track = {};
  for (let l = 1; l <= SEASON_MAX_LEVEL; l++) {
    if (l % 10 === 0) t[l] = { packId: "premium", packCount: 1, credits: 1500 };
    else if (l % 5 === 0) t[l] = { packId: "estandar", packCount: 1, credits: 600 };
    else t[l] = { credits: 250 + l * 10 };
  }
  return t;
})();

/**
 * Carril COMPETITIVO. Menos niveles y más gordos: es un premio por competir, no una
 * segunda paga por lo mismo. Se abre en Oro.
 */
const COMPETITIVE: Track = {
  5:  { credits: 2000 },
  10: { packId: "premium", packCount: 1 },
  15: { credits: 4000 },
  20: { packId: "premium", packCount: 2 },
  25: { credits: 8000 },
  30: { packId: "premium", packCount: 3, credits: 12000 },
};

/*
 * Nota sobre `materials`. `Reward` admite polvo de crafteo, y encajaría bien en este
 * carril, pero los materiales solo existen en el store local: no hay tabla ni RPC que
 * los conceda. Repartir algo que el servidor no sabe entregar da una recompensa que
 * desaparece en la siguiente sincronización, así que no se reparten hasta que exista
 * esa ruta. Todo lo de arriba SÍ lo sabe conceder `app_grant_reward`.
 */

/**
 * Carril DE PAGO. Solo cosmética, y se nota: son identidades, no potencia.
 * Los ids llevan prefijo de familia para que el inventario cosmético los agrupe solo.
 */
const PREMIUM: Track = {
  1:  { cosmetics: ["avatar:nexus-visor"] },
  3:  { cosmetics: ["titulo:aspirante"] },
  5:  { cosmetics: ["marco:circuito"] },
  8:  { cosmetics: ["banderin:nexus-s1"] },
  10: { cosmetics: ["avatar:nexus-halcon"] },
  13: { cosmetics: ["titulo:analista"] },
  15: { cosmetics: ["marco:neon"] },
  18: { cosmetics: ["banderin:emea-s1"] },
  20: { cosmetics: ["avatar:nexus-corona"] },
  23: { cosmetics: ["titulo:estratega"] },
  25: { cosmetics: ["marco:holografico"] },
  28: { cosmetics: ["banderin:champions-s1"] },
  30: { cosmetics: ["avatar:nexus-prime", "titulo:leyenda-s1", "marco:prime"] },
};

/**
 * Misiones. Consumen MÉTRICAS REALES del juego (`MetricSnapshot`): el motor no duplica
 * ninguna estadística, solo lee contadores que ya existen.
 *
 * Los tipos cubren lo que pide la Fase 9E: únicos (`seasonal`), repetibles, hitos
 * (`progressive`) y rotatorios (`daily` / `weekly`).
 */
const MISSIONS: MissionDef[] = [
  // ── Diarias: rotan, son cortas y se pueden repetir en otra rotación ──
  { id: "d-abrir-1",   label: "Abre un sobre",                    kind: "daily",  metric: "packs_opened",  goal: 1,  reward: { credits: 200 },  xp: 150, repeatable: true },
  { id: "d-duelo-1",   label: "Juega un duelo",                   kind: "daily",  metric: "duels_played",  goal: 1,  reward: { credits: 250 },  xp: 200, repeatable: true },
  { id: "d-duelo-win", label: "Gana un duelo",                    kind: "daily",  metric: "duels_won",     goal: 1,  reward: { credits: 400 },  xp: 300, repeatable: true, weight: 2 },
  { id: "d-pickem-1",  label: "Haz una predicción",               kind: "daily",  metric: "picks_made",    goal: 1,  reward: { credits: 200 },  xp: 150, repeatable: true },

  // ── Semanales: piden constancia ──
  { id: "w-duelos-5",  label: "Juega 5 duelos",                   kind: "weekly", metric: "duels_played",  goal: 5,  reward: { credits: 1200 }, xp: 800,  repeatable: true },
  { id: "w-victorias", label: "Gana 3 duelos",                    kind: "weekly", metric: "duels_won",     goal: 3,  reward: { credits: 1800 }, xp: 1000, repeatable: true },
  { id: "w-sobres-10", label: "Abre 10 sobres",                   kind: "weekly", metric: "packs_opened",  goal: 10, reward: { credits: 1500 }, xp: 900,  repeatable: true },
  { id: "w-cartas-5",  label: "Consigue 5 cartas nuevas",         kind: "weekly", metric: "distinct_cards", goal: 5, reward: { credits: 1500 }, xp: 900,  repeatable: true },

  // ── De temporada: únicas, se completan una vez ──
  { id: "s-duelos-25",  label: "Juega 25 duelos en la temporada", kind: "seasonal", metric: "duels_played",   goal: 25,  reward: { packId: "estandar", packCount: 2 }, xp: 2500 },
  { id: "s-mazo",       label: "Guarda tu primer equipo de duelo",  kind: "seasonal", metric: "decks_saved",    goal: 1,   reward: { credits: 1000 },                    xp: 800 },
  { id: "s-region",     label: "Declara tu región competitiva",   kind: "seasonal", metric: "region_set",     goal: 1,   reward: { credits: 500 },                     xp: 400 },

  // ── Hitos: una sola misión que avanza por tramos largos ──
  { id: "p-coleccion-50",  label: "Reúne 50 cartas distintas",    kind: "progressive", metric: "distinct_cards", goal: 50,  reward: { credits: 3000 },                 xp: 2000 },
  { id: "p-coleccion-150", label: "Reúne 150 cartas distintas",   kind: "progressive", metric: "distinct_cards", goal: 150, reward: { packId: "premium", packCount: 2 }, xp: 5000 },
  { id: "p-puntos-400",    label: "Alcanza el rango Oro",         kind: "progressive", metric: "points",         goal: ORO_MIN, reward: { credits: 5000 },             xp: 4000 },
];

export const CURRENT_SEASON: SeasonDef = {
  id: "nexus-s1",
  name: "Temporada 1 · Ascenso",
  maxLevel: SEASON_MAX_LEVEL,
  xpPerLevel: SEASON_XP_PER_LEVEL,
  free: FREE,
  competitive: COMPETITIVE,
  competitiveMinPoints: ORO_MIN,
  premium: PREMIUM,
  // Alternativa DENTRO del juego al pago real: quien juega mucho también lo abre.
  missionPool: MISSIONS,
  durationDays: 84,
};
