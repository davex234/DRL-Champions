/* valorosters · estado de cola ranked de E (solo lectura). */
import { token, api } from "./_fase68-lib";
(async () => { const t = await token("E"); const s = (await api(t, "/api/game/duel/matchmaking")).json; console.log(JSON.stringify({ state: s?.entry?.state ?? null, match: s?.entry?.matchId ?? null, created: s?.entry?.createdAt ?? null })); })();
