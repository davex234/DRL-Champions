/* F73 · cancelación — abandona la partida QA de I que quedó a medias al cortar player-i. */
import { token, api } from "./_fase68-lib";
(async () => { const t = await token("I"); const r = await api(t, "/api/game/duel", { action: "abandon", matchId: "0a21d425-00ce-41cd-b312-4885409076cc" }); const a = (await api(t, "/api/game/duel", { action: "active" })).json; console.log("abandon", r.status, "activa ahora", (a?.view ?? a)?.matchId ?? null); })();
