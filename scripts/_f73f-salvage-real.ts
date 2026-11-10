/* F73 final · desguace REAL por la API con 0060 en vigor (cuenta QA F): preview → desguace de UN sobrante → pago = preview, queda 1 copia; reintento = repeated. */
import { writeFileSync } from "node:fs";
import { token, api } from "./_fase68-lib";
(async () => {
  const t = await token("F");
  const pv = (await api(t, "/api/game/economy", { action: "salvagePreview" })).json;
  const uid = (pv.uids ?? [])[0];
  const st0 = (await api(t, "/api/game/state")).json;
  const owned0 = (st0.ownedCards as any[]);
  const card = owned0.find((o) => o.uid === uid)?.cardId;
  const copies0 = owned0.filter((o) => o.cardId === card).length;
  const ref = `f73f-salv-${Date.now()}`;
  const r = await api(t, "/api/game/economy", { action: "salvage", uids: [uid], ref });
  const st1 = (await api(t, "/api/game/state")).json;
  const copies1 = (st1.ownedCards as any[]).filter((o) => o.cardId === card).length;
  const again = await api(t, "/api/game/economy", { action: "salvage", uids: [uid], ref });
  const each = (pv.lines ?? []).find((l: any) => l.cardId === card)?.each ?? null;
  const out = { at: new Date().toISOString(), account: "QA F", card, copies: [copies0, copies1], credits: [st0.credits, st1.credits], paid: r.json?.paid, previewEach: each, status: r.status, retry: { status: again.status, repeated: again.json?.repeated } };
  const ok = !!uid && r.status === 200 && copies1 === copies0 - 1 && copies1 >= 1 && st1.credits - st0.credits === r.json?.paid && r.json?.paid === each && again.json?.repeated === true;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(out));
  writeFileSync("docs/product/qa/fase73-final/salvage-real-0060.json", JSON.stringify({ ...out, pass: ok }, null, 2));
})();
