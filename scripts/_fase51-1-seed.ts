/**
 * FASE 51.1 · instrumento (fuera de CI): semilla local para las capturas del flujo JUGAR.
 * La colección del demo son las 331 cartas del catálogo (una de cada, comprobado el 2026-09-22 en
 * su navegador); aquí se reproduce con uids sintéticos y el MISMO equipo (sus cinco cardId reales).
 */
import { writeFileSync } from "node:fs";
import * as C0 from "../src/data/catalog";
import * as V0 from "../src/domain/cards/variants";
const C = C0 as any;
const variantIds: string[] = Object.keys((V0 as any).VARIANTS);
const ids: string[] = Array.from(new Set(variantIds.flatMap((v) => C.cardsByVariant(v).map((c: any) => c.id)))).sort() as string[];
const owned = ids.map((cardId, i) => ({ uid: `qa511-${i}`, cardId, obtainedAt: 1790000000000 + i }));
const uidOf = (id: string) => owned.find((o) => o.cardId === id)!.uid;
const STARTERS = ["marteen__record-breaker", "xross__future-star", "primmie__masters-l", "sato__future-star", "mada__moments"];
const team = { id: "qa511-team", name: "Equipo 1", starters: STARTERS.map(uidOf), subs: [], createdAt: 1790000000000, lastUsedAt: null, version: 1, kind: "custom", reserves: [] };
const incompleto = { ...team, id: "qa511-b", name: "Academy", starters: STARTERS.slice(0, 3).map(uidOf) };
writeFileSync("scripts/_fase51-1-seed.json", JSON.stringify({ total: C.totalCards(), owned, team, incompleto }));
console.log("cartas", ids.length, "catálogo", C.totalCards(), "titulares", team.starters.length);
