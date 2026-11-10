/* valorosters · limpieza QA: saca a E de la cola ranked y cierra la partida PvP F↔G que dejó la regresión F72.8 (API real). */
import { token, api } from "./_fase68-lib";
(async () => {
  const tE = await token("E");
  const cE = await api(tE, "/api/game/duel/matchmaking", { action: "cancel" });
  console.log("E cancel", cE.status, JSON.stringify(cE.json).slice(0, 120));
  for (const p of ["F", "G"]) {
    const t = await token(p);
    const s = (await api(t, "/api/game/duel/matchmaking")).json;
    console.log(p, "estado", s?.state, s?.matchId?.slice(0, 8));
    if (s?.matchId) {
      const snap = (await api(t, `/api/game/duel/pvp?matchId=${s.matchId}`)).json?.snapshot;
      console.log(p, "lifecycle", snap?.lifecycle);
      if (snap && snap.lifecycle === "IN_TURN") { const a = await api(t, "/api/game/duel/pvp", { action: "abandon", matchId: s.matchId }); console.log(p, "abandon", a.status); }
    }
    const c = await api(t, "/api/game/duel/matchmaking", { action: "cancel" }); console.log(p, "cancel", c.status);
  }
})();
