/* F73 final · autoridad del servidor (no destructivo): peticiones manipuladas que el servidor DEBE rechazar. Cuenta QA I. */
import { writeFileSync } from "node:fs";
import { token, api } from "./_fase68-lib";
(async () => {
  const t = await token("I");
  const cases: [string, string, unknown, (s: number) => boolean][] = [
    ["subir progreso desde el cliente (acción inexistente)", "/api/game/missions", { action: "progress", missionId: "qa-f73-partidas-r4" }, (s) => s === 400],
    ["campo extra en misiones (progress: 999)", "/api/game/missions", { action: "claimMission", missionId: "qa-f73-abrir-r4", progress: 999 }, (s) => s === 400],
    ["reclamar misión retirada", "/api/game/missions", { action: "claimMission", missionId: "qa-f73-abrir-r4" }, (s) => s === 404],
    ["reclamar proyecto retirado", "/api/game/missions", { action: "claimProject", projectId: "qa-f73-proyecto-r4" }, (s) => s === 404],
    ["crafteo: el cliente elige la carta de salida", "/api/game/crafting", { action: "craftCard", recipeId: "card-base-plata", uids: [], ref: "f73z-auth-000001", outputCardId: "tenz__icon" }, (s) => s === 400],
    ["crafteo: el cliente fija la cantidad", "/api/game/crafting", { action: "craftPack", recipeId: "pack-estandar-premium", ref: "f73z-auth-000002", qty: 1 }, (s) => s === 400],
    ["crafteo: receta inexistente", "/api/game/crafting", { action: "craftPack", recipeId: "pack-no-existe", ref: "f73z-auth-000003" }, (s) => s === 404],
    ["crafteo: receta desactivada (Prime → Icon)", "/api/game/crafting", { action: "craftCard", recipeId: "card-prime-icon", uids: ["00000000-0000-4000-8000-000000000001"], ref: "f73z-auth-000004" }, (s) => s === 409 || s === 404],
    ["crafteo sin inventario", "/api/game/crafting", { action: "craftPack", recipeId: "pack-champions-icon", ref: "f73z-auth-000005" }, (s) => s === 409],
    ["panel admin con cuenta normal (GET)", "/api/admin/cms/crafting", undefined, (s) => s === 401],
    ["panel admin con cuenta normal (POST saveMission)", "/api/admin/cms/crafting", { action: "saveMission", id: "qa-hack", patch: {}, expectedVersion: 0 }, (s) => s === 401],
  ];
  const out = [];
  for (const [id, path, body, ok] of cases) { const r = await api(t, path, body); out.push({ id, status: r.status, code: r.json?.code ?? r.json?.error ?? null, ok: ok(r.status) }); console.log(ok(r.status) ? "PASS" : "FAIL", id, r.status, r.json?.code ?? r.json?.error ?? ""); }
  const inv = (await api(t, "/api/game/crafting")).json.packs;
  writeFileSync("docs/product/qa/fase73-final/authority-final.json", JSON.stringify({ at: new Date().toISOString(), account: "QA I", pass: out.filter((x) => x.ok).length, fail: out.filter((x) => !x.ok).length, cases: out, inventoryAfter: inv, note: "no destructivo: ninguna petición podía consumir nada" }, null, 2));
})();
