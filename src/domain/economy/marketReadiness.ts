/**
 * CRITERIOS DE APERTURA DEL MERCADO (Fase 12) — dominio PURO.
 *
 * ────────────────────────── POR QUÉ EXISTE ESTE FICHERO ──────────────────────────
 *
 * El mercado entre jugadores lleva tres fases construido, portado y verificado, y sigue
 * apagado. Hasta hoy, encenderlo era **cambiar un `false` por un `true`**: una decisión de
 * una persona, un martes, sin nada que la contrastara.
 *
 * Eso es exactamente lo que la Fase 12 prohíbe. «El mercado NO se abre si la economía no
 * está preparada» solo significa algo si «preparada» está escrito en alguna parte, es
 * comprobable y alguien lo comprueba. Este módulo es esa lista.
 *
 * ────────────────────────── CÓMO SE DECIDE CADA CRITERIO ──────────────────────────
 *
 *   `verify`      Lo comprueba una máquina contra la base de datos real
 *                 (`npm run economy:verify`). Es un hecho, no una opinión.
 *   `measure`     Sale de una medición reproducible (`npm run economy:model`,
 *                 `npm run economy:simulate`). También es un hecho, con su cifra.
 *   `operations`  NO se puede decidir desde el repositorio: depende de cuánta gente esté
 *                 jugando. Se declara `unknown` y se dice por qué, en lugar de fingir que
 *                 un dato que no tenemos está a favor.
 *
 * Un criterio `unknown` **no cuenta como cumplido**. Es la diferencia entre «no lo sabemos»
 * y «está bien», y confundirlas es como se abren los mercados rotos.
 *
 * ────────────────────────── LA RED ──────────────────────────
 *
 * `marketReadiness.test.ts` afirma que, si `GLOBAL_MARKET_ENABLED` estuviera en `true`,
 * todos los criterios evaluables localmente tendrían que estar cumplidos. Es decir: el día
 * que alguien toque ese interruptor sin haber cerrado la economía, la suite cae. La lista
 * deja de ser documentación y pasa a ser un cerrojo.
 */
import { PACK_STATS, type PackStatRow } from "@/data/packStats";
import { salvageValue } from "./salvage";
import { CARDS } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import type { CardDef } from "@/domain/cards/types";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import { marketValue } from "./pricing";
import { MAIN_PACK_LINE } from "@/domain/packs/packClass";

export type CriterionStatus = "met" | "unmet" | "unknown";
export type DecidedBy = "verify" | "measure" | "operations";

export interface MarketCriterion {
  id: string;
  label: string;
  /** Qué se rompería si se abriera el mercado sin esto. */
  why: string;
  decidedBy: DecidedBy;
}

export interface CriterionResult {
  criterion: MarketCriterion;
  status: CriterionStatus;
  /** La cifra o el hecho que sostiene el veredicto. Nunca vacío. */
  detail: string;
}

/**
 * Los nueve criterios. Los ocho primeros salen del encargo de la Fase 12 punto por punto;
 * el noveno es el que la propia auditoría añadió al medir.
 */
export const MARKET_CRITERIA: MarketCriterion[] = [
  {
    id: "ownership",
    label: "Propiedad en una sola tabla",
    why: "Con la propiedad en dos sitios, comprar salía gratis y cancelar duplicaba cartas (BUG-01, BUG-02).",
    decidedBy: "verify",
  },
  {
    id: "atomic",
    label: "Transacciones atómicas",
    why: "Sin atomicidad existe un instante en el que el comprador ha pagado y la carta sigue siendo del vendedor.",
    decidedBy: "verify",
  },
  {
    id: "idempotent",
    label: "Idempotencia en publicar y comprar",
    why: "Un reintento de red compraría dos veces la misma carta y cobraría dos veces.",
    decidedBy: "verify",
  },
  {
    id: "balance-safe",
    label: "El saldo no puede quedar negativo",
    why: "Un saldo negativo es dinero creado de la nada, y no hay forma de recuperarlo después.",
    decidedBy: "verify",
  },
  {
    id: "price-safe",
    label: "El precio lo valida el servidor",
    why: "Si el cliente pudiera nombrar el precio, el precio lo pondría el cliente.",
    decidedBy: "verify",
  },
  {
    id: "fee",
    label: "La comisión se cobra y se quema",
    why: "La comisión es el único sumidero que el mercado aporta. Sin ella el mercado solo mueve créditos.",
    decidedBy: "verify",
  },
  {
    id: "no-double-spend",
    label: "Dos compradores simultáneos no rompen nada",
    why: "Es la carrera clásica: dos compras a la vez sobre el mismo listado.",
    decidedBy: "verify",
  },
  {
    id: "anchor-calibrated",
    label: "El precio de referencia está calibrado",
    why: "La banda de precio se calcula sobre el ancla. Con el ancla mal, la banda permitida no significa nada.",
    decidedBy: "measure",
  },
  {
    id: "salvage-safe",
    label: "El desguace no explota con el mercado abierto",
    why: "Si desguazar pagara más que comprar en el mercado, el mercado sería una fuente infinita de créditos.",
    decidedBy: "measure",
  },
  {
    id: "player-mass",
    label: "Hay jugadores suficientes para descubrir precios",
    why: "Un mercado con cuatro personas no descubre precios: los inventa el primero que publica.",
    decidedBy: "operations",
  },
];

// ───────────────────────────── Los criterios que se MIDEN ─────────────────────────────

const BUCKETS: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];
const bucketOf = (card: CardDef): RarityBucket => bucketForRank(getVariant(card.variantId).rank);

/**
 * ¿Está el ancla calibrada?
 *
 * La respuesta NO es «marketValue partido por el precio del sobre», que es la cuenta que la
 * Fase 11 hizo y que compara una cifra por CARTA contra un precio por SOBRE: esa ratio
 * crece sola con el número de cartas del sobre y no dice nada.
 *
 * La cuenta buena es por rareza: `marketValue` medio de un bucket contra lo que cuesta
 * sacar una carta de ese bucket abriendo el sobre de entrada. Si una carta vale, como
 * referencia, aproximadamente lo que cuesta conseguirla, el ancla es honesta.
 *
 * Hotfix 57.2 — «el sobre de entrada» era, POR RAREZA, el primero de la escalera base que podía entregarla.
 *
 * PACK OPENING 3.0 (2026-10-07) — Bronce puede dar cualquier rareza, pero las altas solo como jackpot de su ranura
 * destacada: «el primero que puede darla» dejó de ser «la forma de conseguirla» (una rara costaría 165.000 créditos de
 * Bronce cuando Champions o Icon la dan por ~50.000 o menos). El coste de una rareza es ahora el MÁS BAJO de la línea
 * principal: lo que de verdad cuesta conseguir una carta de esa rareza abriendo sobres.
 */
export const ANCHOR_BAND = { min: 0.2, max: 2.5 };

export function anchorRatios(ladder: readonly string[] = MAIN_PACK_LINE): Partial<Record<RarityBucket, number>> {
  const rows = ladder.map((id) => (PACK_STATS[id] ?? null) as PackStatRow | null).filter((r): r is PackStatRow => r !== null);
  const out: Partial<Record<RarityBucket, number>> = {};
  for (const b of BUCKETS) {
    const costs = rows.map((r) => r.costPerRarity[b]).filter((c): c is number => c !== undefined && c > 0);
    if (costs.length === 0) continue;
    const cost = Math.min(...costs);
    const v = CARDS.filter((c) => bucketOf(c) === b).map(marketValue);
    if (v.length === 0) continue;
    out[b] = (v.reduce((a, x) => a + x, 0) / v.length) / cost;
  }
  return out;
}

/**
 * ¿Es seguro el desguace con el mercado abierto?
 *
 * La pregunta no es la de la Fase 11 —«¿desguazar un sobre devuelve menos de lo que
 * cuesta?»—, que ya está resuelta. Con mercado abierto aparece otra: si el desguace pagara
 * MÁS que el precio de referencia de una carta, comprarla en el mercado y desguazarla sería
 * un beneficio garantizado, repetible y sin límite. El desguace tiene que quedar SIEMPRE
 * por debajo de la referencia.
 *
 * F57.5 — el desguace ya no es una tabla por rareza sino una fracción de `marketValue`
 * carta a carta, así que el peor caso se mide CARTA A CARTA (desguace / su referencia) y
 * se informa con el bucket de la carta que lo da.
 */
export function salvageBelowReference(): { ok: boolean; worst: { bucket: RarityBucket; ratio: number } | null } {
  let worst: { bucket: RarityBucket; ratio: number } | null = null;
  for (const c of CARDS) {
    const ratio = salvageValue(c) / marketValue(c);
    if (!worst || ratio > worst.ratio) worst = { bucket: bucketOf(c), ratio };
  }
  return { ok: worst !== null && worst.ratio < 1, worst };
}

// ───────────────────────────── Evaluación ─────────────────────────────

/**
 * Lo que el evaluador necesita saber de fuera. Los criterios `verify` no se pueden
 * comprobar desde un módulo puro —hace falta la base de datos—, así que los aporta quien
 * llama: `economy:verify` los pasa a `true` cuando sus propias comprobaciones han pasado.
 *
 * Por omisión llegan como `unknown`, que es lo correcto: un criterio que nadie ha
 * comprobado no está cumplido.
 */
export interface ReadinessInputs {
  /** Resultado de las comprobaciones contra la base de datos, por id de criterio. */
  verified?: Partial<Record<string, boolean>>;
  /** Jugadores activos. `undefined` = no se sabe desde aquí, y así se declara. */
  activePlayers?: number;
}

/** Mínimo de jugadores para que un precio lo descubra el mercado y no una persona. */
export const MIN_PLAYERS_FOR_DISCOVERY = 200;

export function evaluateReadiness(inputs: ReadinessInputs = {}): CriterionResult[] {
  const verified = inputs.verified ?? {};

  return MARKET_CRITERIA.map((criterion): CriterionResult => {
    if (criterion.decidedBy === "verify") {
      const v = verified[criterion.id];
      return {
        criterion,
        status: v === true ? "met" : v === false ? "unmet" : "unknown",
        detail: v === undefined
          ? "Sin comprobar en esta ejecución: lo decide npm run economy:verify"
          : v ? "Comprobado contra la base de datos real" : "La comprobación ha fallado",
      };
    }

    if (criterion.id === "anchor-calibrated") {
      const ratios = anchorRatios();
      const entries = Object.entries(ratios) as [RarityBucket, number][];
      if (entries.length === 0) {
        return { criterion, status: "unknown", detail: "Sin estadística de sobres medida" };
      }
      const bad = entries.filter(([, r]) => r < ANCHOR_BAND.min || r > ANCHOR_BAND.max);
      const worst = entries.reduce((a, b) => (Math.abs(Math.log(b[1])) > Math.abs(Math.log(a[1])) ? b : a));
      return {
        criterion,
        status: bad.length === 0 ? "met" : "unmet",
        detail: bad.length === 0
          ? `Las 5 rarezas caen en la banda ${ANCHOR_BAND.min}–${ANCHOR_BAND.max}× del coste de tirada (la más alejada: ${worst[0]} ${worst[1].toFixed(2)}×)`
          : `Fuera de banda: ${bad.map(([b, r]) => `${b} ${r.toFixed(2)}×`).join(", ")}`,
      };
    }

    if (criterion.id === "salvage-safe") {
      const { ok, worst } = salvageBelowReference();
      return {
        criterion,
        status: ok ? "met" : "unmet",
        detail: worst
          ? `El peor caso es una carta ${worst.bucket}: su desguace es el ${(worst.ratio * 100).toFixed(0)} % de su valor de referencia`
          : "Sin datos de rareza",
      };
    }

    // player-mass
    const n = inputs.activePlayers;
    if (n === undefined) {
      return {
        criterion, status: "unknown",
        detail: "No se puede saber desde el repositorio: hace falta la telemetría de producción",
      };
    }
    return {
      criterion,
      status: n >= MIN_PLAYERS_FOR_DISCOVERY ? "met" : "unmet",
      detail: `${n} jugadores activos; hacen falta ${MIN_PLAYERS_FOR_DISCOVERY}`,
    };
  });
}

/** El mercado solo puede abrirse si TODOS están cumplidos. `unknown` no vale. */
export const marketReady = (results: CriterionResult[]): boolean =>
  results.length > 0 && results.every((r) => r.status === "met");

/** Los que faltan, para poder decir exactamente qué bloquea la apertura. */
export const blockers = (results: CriterionResult[]): CriterionResult[] =>
  results.filter((r) => r.status !== "met");
