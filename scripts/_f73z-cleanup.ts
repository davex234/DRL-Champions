/* F73 final · limpieza: cierra por la API real las partidas PvE QA en curso que dejaron los arneses y saca de la cola ranked. */
import { token, api } from "./_fase68-lib";
(async () => {
  for (const p of ["A", "F", "G", "I", "K", "L", "B", "D"]) {
    const t = await token(p);
    const a = (await api(t, "/api/game/duel", { action: "active" })).json; const v = a?.view ?? a;
    let pve = "sin partida";
    if (v?.matchId && v.status === "IN_PROGRESS") { const r = await api(t, "/api/game/duel", { action: "abandon", matchId: v.matchId }); pve = `abandonada ${r.status}`; }
    const q = (await api(t, "/api/game/duel/matchmaking")).json?.entry?.state ?? "sin cola";
    let cola = q;
    if (q === "QUEUED" || q === "PAIRING") { const c = await api(t, "/api/game/duel/matchmaking", { action: "cancel" }); cola = `${q} → cancelada ${c.status}`; }
    console.log(p, "PvE:", pve, "· cola:", cola);
  }
})();
