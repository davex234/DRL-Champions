/** F82 · medida de coste de la agregación de la Sala de Trofeos (instrumento, fuera de CI). */
import { CARDS } from "../src/data/catalog";
import { generateTeamDrafts, generateEditionDrafts, isSkip, type DraftProposal } from "../src/domain/collectionSets/generator";
import { buildSetView } from "../src/domain/collectionSets/view";
import { badgeIndex } from "../src/domain/collectionSets/badges";
import type { CollectionSetDef } from "../src/domain/collectionSets/types";
const base = [...generateTeamDrafts(), ...generateEditionDrafts()].filter((d): d is DraftProposal => !isSkip(d)).map((p) => ({ ...p, status: "PUBLISHED", checksum: "x", publishedAt: null, retiredAt: null, rowVersion: 1 }) as CollectionSetDef);
for (const n of [25, 250, 1000]) {
  const sets = Array.from({ length: n }, (_, i) => ({ ...base[i % base.length], id: `${base[i % base.length].id}-${i}`, reward: { badgeId: `insignia:coleccion:x-${i}` } }));
  const owned = new Set(CARDS.map((c) => c.id)); // peor caso: la colección entera (331 ids distintos)
  const idx = badgeIndex(sets);
  const t0 = performance.now();
  const views = sets.map((s) => buildSetView(s, owned, null, idx));
  const ms = performance.now() - t0;
  const bytes = Buffer.byteLength(JSON.stringify(views));
  console.log(`sets=${n} → ${ms.toFixed(1)} ms · respuesta ${(bytes / 1024).toFixed(0)} KB`);
}
