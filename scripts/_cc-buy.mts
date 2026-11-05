/** Instrumento (fuera de CI/release): compra+abre sobres SOLO en la QA M hasta tener un tramo de maestría cobrable. */
import { token, api } from "./_fase68-lib";
const t = await token("M");
for (let i = 0; i < 2; i++) {
  const m = await api(t, "/api/game/mastery");
  const claimable = (m.json?.sets ?? []).flatMap((s: any) => s.tiers.filter((x: any) => x.claimable).map((x: any) => x.label));
  if (claimable.length) { console.log("claimable", claimable); break; }
  const r = await api(t, "/api/game/packs", { action: "buy_and_open", packId: "estandar", ref: `cc-buy-${i}` }, true);
  console.log("buy_and_open", r.status, r.json?.error ?? "");
}
const m = await api(t, "/api/game/mastery");
console.log("claimable now", (m.json?.sets ?? []).flatMap((s: any) => s.tiers.filter((x: any) => x.claimable).map((x: any) => `${s.id}@${x.at}`)));
console.log("credits", (await api(t, "/api/game/state")).json?.credits);
