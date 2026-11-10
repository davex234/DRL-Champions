/**
 * PACK OPENING ENGINE — API pública (Collection Fase 2/7).
 *
 * Capa de ORQUESTACIÓN sobre el ÚNICO decisor de drops (`openPack`, en `@/domain/packs`) y el ÚNICO
 * acuñador (`Minter`). Es el único origen de todas las cartas obtenibles del juego (sobres de todo
 * tipo + grants de recompensa/battlepass/torneo/evento/gift/promo/code/admin), pero NO posee cartas/
 * catálogo/inventario/variantes/ownership/historial: los reutiliza del Collection Engine. NO abre
 * economía, crafting, marketplace ni deck builder: solo apertura y drop.
 *
 *   Pack UI → PackEngine → openPack() [decisión] → Minter [acuñado] → Collection → Ownership
 */
export * from "./types";
export { PackEngine, type DrawResult } from "./engine";
export { Minter, type MintFlags } from "./mint";
export { dropEvents, isSignedCard } from "./events";
export { validatePack, validatePacks } from "./validate";

// Re-exporta el decisor y sus piezas internas (fuente única en `@/domain/packs`), sin duplicarlos.
export { openPack, type DropDecision, type OpenPackResult, type DecideContext } from "@/domain/packs/openPack";
export { buildPool, isEligible, BUCKETS, BUCKET_INDEX, type Pool, type BuiltPool } from "@/domain/packs/pool";
export { nextSerial } from "@/domain/packs/serial";
export { pityDue, updatePity, pityKey, migratePity } from "@/domain/packs/pity";
export { resolveAntiDup, type AntiDupOutcome } from "@/domain/packs/antidup";
