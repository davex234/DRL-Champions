/* F73 · PRODUCCIÓN — reintento real ×10 de la ref de gesto que usó la UI (token NUEVO: el cierre de sesión revoca el anterior). */
import { readFileSync, writeFileSync } from "node:fs";
import { token, api } from "./_fase68-lib";
const F = "docs/product/qa/fase73-production/pack-craft.json";
(async () => {
  const j = JSON.parse(readFileSync(F, "utf8"));
  const t = await token("I");
  const before = (await api(t, "/api/game/crafting")).json.packs;
  const rs = await Promise.all(Array.from({ length: 10 }, () => api(t, "/api/game/crafting", { action: "craftPack", recipeId: "pack-estandar-premium", ref: j.iRef })));
  const after = (await api(t, "/api/game/crafting")).json.packs;
  const ok = rs.every((r) => r.status === 200 && r.json?.repeated === true) && JSON.stringify(after) === JSON.stringify(before);
  const detail = `${rs.map((r) => `${r.status}${r.json?.repeated ? "R" : ""}`).join(",")} ${JSON.stringify(before)} → ${JSON.stringify(after)}`;
  console.log(ok ? "PASS" : "FAIL", detail);
  j.results = j.results.map((r: any) => r.id.startsWith("REINTENTO") ? { ...r, ok, detail: `${detail} · (1.ª pasada: 401 ×10 porque el cierre de sesión REVOCA el token anterior — comportamiento correcto; se repitió con token nuevo)` } : r);
  j.pass = j.results.filter((r: any) => r.ok).length; j.fail = j.results.length - j.pass;
  writeFileSync(F, JSON.stringify(j, null, 2));
})();
