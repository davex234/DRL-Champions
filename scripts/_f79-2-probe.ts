// F79.2 · sonda de material (solo lectura) de las cuentas QA por la API pública desplegada.
import { exchangeMaterial, login } from "./_f79-2-lib";
(async () => {
  for (const n of ["A", "B", "C", "D", "E", "F", "G"]) {
    try { const w = await login(n); const m = await exchangeMaterial(w); console.log(n, w.userId.slice(0, 8), m.map((x) => `${x.recipeId}:${x.free.filter((f) => !f.protectedBy.length).length}/${x.inputQty}`).join(" ")); }
    catch (e) { console.log(n, "ERR", String(e).slice(0, 80)); }
  }
})();
