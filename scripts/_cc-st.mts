/** Instrumento (fuera de CI/release): limpieza de /coleccion — abre los sobres del QA M y lee mastery/prestige/meta. */
import { token, api } from "./_fase68-lib";
const t = await token("M");
if (process.argv[2] === "open") {
  for (const [p, n] of [["inicial", 3], ["estandar", 1]] as const) for (let i = 0; i < n; i++) {
    const r = await api(t, "/api/game/packs", { action: "open", packId: p, ref: `cc-${p}-${i}` }, true);
    console.log("open", p, r.status, r.json?.error ?? "");
  }
}
const s = await api(t, "/api/game/state");
const own = s.json?.ownedCards ?? [];
const counts = new Map<string, number>(); for (const c of own) counts.set(c.cardId, (counts.get(c.cardId) ?? 0) + 1);
console.log("state", s.status, JSON.stringify({ credits: s.json?.credits, packs: s.json?.unopenedPacks, copies: own.length, distinct: counts.size, dups: [...counts.values()].filter((n) => n > 1).length }));
const m = await api(t, "/api/game/mastery"); console.log("mastery", m.status, JSON.stringify(m.json).slice(0, 300));
const pr = await api(t, "/api/game/prestige"); console.log("prestige", pr.status, JSON.stringify(pr.json).slice(0, 300));
const cs = await api(t, "/api/game/collection-sets"); console.log("sets", cs.status, cs.json?.sets?.length, JSON.stringify(cs.json?.totals));
