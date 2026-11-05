// F79.2 · G bis: desguace de una copia FAVORITA NO conservada, SIN confirmar → PROTECTED_COPY (y nada consumido).
import { api, exchangeMaterial, g, login } from "./_f79-2-lib";
/* eslint-disable @typescript-eslint/no-explicit-any */
(async () => {
  const C = await login("C");
  const m = (await exchangeMaterial(C)).find((x) => x.recipeId === "card-base-plata")!;
  const fav = Object.entries(m.usableByCard).find(([c, u]) => u >= 1 && m.free.filter((f) => f.cardId === c).length >= 2)?.[0];
  if (!fav) { console.log("SKIP sin carta repetida"); return; }
  console.log("fav", (await api(C, "/api/game/collection", { action: "favorite", cardId: fav, favorite: true })).status);
  const pv = await api(C, "/api/game/economy", { action: "salvagePreview" });
  const prot = ((pv.json as any).protectedCopies ?? []).find((p: any) => p.cardId === fav)?.uid;
  const r = await api(C, "/api/game/economy", { action: "salvage", uids: [prot], ref: g("G5") }, { noRetry: true });
  const pv2 = await api(C, "/api/game/economy", { action: "salvagePreview" });
  const still = ((pv2.json as any).protectedCopies ?? []).some((p: any) => p.uid === prot);
  console.log(`${r.status === 409 && (r.json as any).code === "PROTECTED_COPY" && still ? "PASS" : "FAIL"} G · desguace SIN confirmar de una favorita no conservada → ${r.status} ${(r.json as any).code} · sigue: ${still}`);
  console.log("unfav", (await api(C, "/api/game/collection", { action: "favorite", cardId: fav, favorite: false })).status);
})();
