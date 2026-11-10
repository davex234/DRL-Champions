/* F73 · PRODUCCIÓN — clase REAL (packCardClass) de las cartas de entrada/salida del intercambio (solo lectura). */
import { readFileSync } from "node:fs";
import { serverCatalogSync } from "../src/server/catalog";
import { packCardClass } from "../src/domain/packs/packClass";
const j = JSON.parse(readFileSync("docs/product/qa/fase73-production/card-craft.json", "utf8"));
const reg = serverCatalogSync().registry;
const cls = (id: string) => { const c = reg.card(id); return c ? `${id}:${packCardClass(c)}:ovr${c.ovr}` : `${id}:?`; };
console.log("salida", cls(j.outputCardId));
console.log("entradas", j.before.candidates.map((c: any) => cls(c.cardId)).join(" "));
