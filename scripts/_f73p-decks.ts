/* F73 · PRODUCCIÓN — sonda de SOLO LECTURA: equipos y cartas de cuentas QA con país/equipo impreso (fuera de CI). */
import { token, api } from "./_fase68-lib";
import { serverCatalogSync } from "../src/server/catalog";
import { canonicalCardTeam } from "../src/data/teamIdentities";
(async () => {
  const reg = serverCatalogSync().registry;
  for (const p of (process.argv[2] ?? "I").split(",")) {
    const t = await token(p);
    const st = (await api(t, "/api/game/state")).json;
    const dk = (await api(t, "/api/game/duels")).json;
    const owned = (st.ownedCards ?? []) as any[];
    const info = (cardId: string) => { const d = reg.card(cardId); const pl = d ? reg.player(d.playerId) : undefined; return { cardId, country: pl?.country ?? "?", team: canonicalCardTeam(d ?? { team: "" } as any, pl).key, role: d?.role }; };
    console.log(p, "owned", owned.length, "credits", st.credits, "active", dk.activeDeckId);
    for (const d of dk.decks ?? []) {
      const uids: string[] = d.cardUids ?? d.cards?.map((c: any) => c.uid ?? c) ?? [];
      const cards = uids.map((u) => owned.find((o) => o.uid === u)).filter(Boolean).map((o: any) => info(o.cardId));
      const byC: Record<string, number> = {}; const byT: Record<string, number> = {};
      for (const c of cards) { byC[c.country] = (byC[c.country] ?? 0) + 1; byT[c.team] = (byT[c.team] ?? 0) + 1; }
      console.log(" deck", d.id, d.name, "valid", d.valid, "n", uids.length, JSON.stringify(byC), JSON.stringify(byT), "ver", d.updatedAt ?? d.updated_at);
    }
    const inDeck = new Set((dk.decks ?? []).flatMap((d: any) => d.cardUids ?? []));
    const free = owned.filter((o) => !inDeck.has(o.uid)).map((o) => ({ uid: o.uid, ...info(o.cardId) }));
    console.log(" free", JSON.stringify(free.map((f) => `${f.cardId}:${f.country}:${f.team}:${f.role}`)));
  }
})();
