// F79.3 · reparación de la referencia rota del equipo QA de C por el mecanismo NORMAL (POST /api/game/duels save_composition):
// mismo nombre, mismo orden; la posición rota pasa a la copia de la MISMA carta que C ya posee. Nada se crea ni se concede.
import { api, login } from "./_f79-2-lib";
/* eslint-disable @typescript-eslint/no-explicit-any */
const DECK = "e7a40076-85ae-4e1f-a32e-c75b634e133e", BROKEN = "ebab0564-5511-46d0-8172-864f85aea4c1", OWNED = "9210e759-a618-43e6-8415-02bcfe087934";
(async () => {
  const C = await login("C");
  if (C.userId !== "40a1e10d-c1d3-4c38-9114-3d021ddb119e") throw new Error("cuenta inesperada");
  const ws = await api(C, "/api/game/duels");
  const d = ((ws.json as any).decks ?? []).find((x: any) => x.id === DECK);
  console.log("antes", JSON.stringify({ name: d?.name, n: d?.cardUids?.length, broken: d?.cardUids?.indexOf(BROKEN), version: d?.version }));
  if (!d || d.cardUids.indexOf(BROKEN) < 0) { console.log("nada que reparar"); return; }
  const cardUids = d.cardUids.map((u: string) => (u === BROKEN ? OWNED : u));
  const r = await api(C, "/api/game/duels", { action: "save_composition", id: DECK, name: d.name, cardUids, baseVersion: d.version }, { noRetry: true });
  console.log("save_composition", r.status, JSON.stringify(r.json).slice(0, 200));
  const ws2 = await api(C, "/api/game/duels");
  const d2 = ((ws2.json as any).decks ?? []).find((x: any) => x.id === DECK);
  console.log("después", JSON.stringify({ name: d2?.name, n: d2?.cardUids?.length, broken: d2?.cardUids?.indexOf(BROKEN), owned: d2?.cardUids?.indexOf(OWNED), valid: d2?.valid ?? d2?.isValid ?? null }));
})();
