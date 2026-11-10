// F79.2 · material USABLE (respeta el tope de última copia) por cuenta QA. Solo lectura.
import { exchangeMaterial, login } from "./_f79-2-lib";
(async () => { for (const n of ["C", "A", "G", "E"]) { const w = await login(n); const m = (await exchangeMaterial(w)).find((x) => x.recipeId === "card-base-plata")!; console.log(n, "free", m.free.length, "usable", Object.values(m.usableByCard).reduce((a, b) => a + b, 0)); } })();
