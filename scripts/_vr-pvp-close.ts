/* valorosters · limpieza QA: cierra por la API real la partida PvP F↔G que quedó abierta en la regresión F72.8. */
import { token, api } from "./_fase68-lib";
(async () => {
  const id = "7ff07c5f-7787-4706-84cb-296eae7a80e1";
  const t = await token("F");
  const g = await api(t, `/api/game/duel/pvp?matchId=${id}`);
  console.log("GET", g.status, g.json?.snapshot?.lifecycle, JSON.stringify(g.json).slice(0, 160));
  const a = await api(t, "/api/game/duel/pvp", { action: "abandon", matchId: id });
  console.log("abandon", a.status, JSON.stringify(a.json).slice(0, 160));
})();
