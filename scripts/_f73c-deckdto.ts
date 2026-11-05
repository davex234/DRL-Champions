/* F73 · cierre — sonda de solo lectura de la forma del DTO de equipos. */
import { token, api } from "./_fase68-lib";
(async () => { const t = await token("I"); const j = (await api(t, "/api/game/duels")).json; const d = j.decks[0]; console.log(Object.keys(d).join(","), JSON.stringify({ v: d.version, u: d.updatedAt, bv: d.baseVersion })); })();
