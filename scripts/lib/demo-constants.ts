/**
 * Constantes compartidas del dataset de DEMOSTRACIÓN.
 *
 * Viven aquí, en un módulo SIN efectos secundarios, porque importarlas desde
 * `seed-demo.ts` ejecutaba su `main()` al cargar el módulo: `demo:resolve`
 * acababa resembrando la base de datos antes de resolver nada.
 */

/** Id del torneo de demostración. `events.source` = 'demo' lo marca en la BD. */
export const DEMO_EVENT_ID = "demo-masters-madrid-2026";
