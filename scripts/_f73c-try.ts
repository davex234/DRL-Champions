/* F73 · cierre — prueba del ayudante de partidas (K, partida PvE real completa, todas humanas). Sin misiones: no cambia progreso. */
import { token, api, creds } from "./_fase68-lib";
import { clearActive, startPve, playMatch, eventsFor, progressFor } from "./_f73c-lib";
(async () => {
  const t = await token("K");
  await clearActive(t);
  const deckId = (await api(t, "/api/game/duels")).json.activeDeckId;
  const v = await startPve(t, deckId);
  console.log("start", v.matchId, v.status, Object.keys(v).slice(0, 30).join(","));
  const r = await playMatch(t, v);
  console.log("final", r.final?.status, "played", r.played, "turns", r.final?.history?.length, "ms", r.ms, "result", JSON.stringify(r.final?.result ?? null).slice(0, 120));
  console.log("events", JSON.stringify(eventsFor(creds("K").userId, `match:${v.matchId}`)));
  console.log("progress", JSON.stringify(progressFor(creds("K").userId)));
})();
