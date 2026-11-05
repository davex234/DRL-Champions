/** HOTFIX 57.2 · qué recorta el techo de cada sobre base, por edición (fuera de CI). npx tsx scripts/_fase57-2-excluded.ts */
import { CardRegistry } from "@/collection/registry";
import { getPack } from "@/data/packs";
import { buildPool } from "@/domain/packs/pool";
import { BASE_LINE } from "@/domain/packs/power";
const reg = new CardRegistry();
for (const id of BASE_LINE) {
  const p = getPack(id)!;
  const now = buildPool(reg, p), before = buildPool(reg, { ...p, id: `${id}__ctl` });
  const keep = new Set(now.flat.map((c) => c.id));
  const cut: Record<string, number> = {};
  for (const c of before.flat) if (!keep.has(c.id)) cut[c.variantId] = (cut[c.variantId] ?? 0) + 1;
  const buckets = Object.fromEntries(Object.entries(now.pool).map(([b, a]) => [b, a.length]));
  console.log(id, "antes", before.size, "ahora", now.size, "excluidas", before.size - now.size, JSON.stringify(cut), "pool", JSON.stringify(buckets));
}
