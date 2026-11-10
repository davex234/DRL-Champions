// F79.3 · tras reparar: la copia del equipo (artzin__base, 9210e759) NO se puede desguazar ni forjar.
import { api, exchangeMaterial, g, login, pick } from "./_f79-2-lib";
/* eslint-disable @typescript-eslint/no-explicit-any */
const DECKCOPY = "9210e759-a618-43e6-8415-02bcfe087934";
(async () => {
  const C = await login("C");
  const s = await api(C, "/api/game/economy", { action: "salvage", uids: [DECKCOPY], ref: g("v1") }, { noRetry: true });
  const m = (await exchangeMaterial(C)).find((x) => x.recipeId === "card-base-plata")!;
  const f = await api(C, "/api/game/forge", { action: "craft", recipeId: "card-base-plata", uids: [DECKCOPY, ...(pick(m, 6) ?? [])], ref: g("v2") }, { noRetry: true });
  const pv = await api(C, "/api/game/economy", { action: "salvagePreview" });
  const inPreview = ((pv.json as any).uids ?? []).includes(DECKCOPY) || ((pv.json as any).protectedCopies ?? []).some((p: any) => p.uid === DECKCOPY);
  console.log(`${s.status !== 200 && f.status !== 200 && !inPreview ? "PASS" : "FAIL"} copia del equipo protegida · desguace ${s.status} · forja ${f.status} ${(f.json as any).code ?? ""} · en vista previa: ${inPreview}`);
})();
