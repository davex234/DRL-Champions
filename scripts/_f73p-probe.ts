/* F73 · PRODUCCIÓN — sonda de SOLO LECTURA: estado de crafteo de las cuentas QA por la API real (fuera de CI). */
import { token } from "./_fase68-lib";
const BASE = process.env.BASE_URL ?? "http://localhost:3005";
(async () => {
  for (const p of (process.argv[2] ?? "A,B,C,D,E,F,G,H,I,J,K,L").split(",")) {
    const t = await token(p);
    const r = await fetch(`${BASE}/api/game/crafting`, { headers: { authorization: `Bearer ${t}` } });
    const j = await r.json() as any;
    console.log(p, r.status, JSON.stringify(j.packs), (j.packRecipes ?? []).map((x: any) => `${x.id}:${x.inputQty}:${x.live}`).join(" "), "|", (j.cardRecipes ?? []).map((x: any) => `${x.id}:${x.inputQty}:${x.live}:avail=${x.available}`).join(" "));
  }
})();
