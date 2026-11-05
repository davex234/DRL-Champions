/** F66 · deja las cuentas QA fuera de cola y sin PvP vivo (abandona lo vivo). Solo QA. */
import { api, login, mm, pvpGet } from "./_qa";
(async () => { for (const n of process.argv.slice(2)) { const w = await login(n); await mm(w, { action: "cancel" }); const e = (await mm(w)).json?.entry;
  if (e?.state === "MATCHED" && e.matchId) { const s = (await pvpGet(w, e.matchId)).json?.snapshot; if (s && !["FINISHED", "ABANDONED", "EXPIRED"].includes(s.lifecycle)) { console.log(n, "abandona viva", e.matchId.slice(0, 8), (await api(w, "/api/game/duel/pvp", { action: "abandon", matchId: e.matchId })).status); } }
  console.log(n, "cola", (await mm(w)).json?.entry?.state ?? null); } })();
