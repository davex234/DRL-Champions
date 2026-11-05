/* valorosters · saca a la cuenta QA G de la cola ranked que dejó el gate (API real). */
import { token, api } from "./_fase68-lib";
(async () => { const t = await token("G"); const c = await api(t, "/api/game/duel/matchmaking", { action: "cancel" }); console.log("cancel", c.status, c.json?.entry?.state); const s = await api(t, "/api/game/duel/matchmaking"); console.log("ahora", s.json?.entry?.state); })();
