/* F73 · cancelación — estado de la cuenta QA I tras cortar player-i (partida en curso y equipo). */
import { readFileSync, existsSync } from "node:fs";
import { token, api } from "./_fase68-lib";
(async () => {
  const t = await token("I");
  const a = (await api(t, "/api/game/duel", { action: "active" })).json; const v = a?.view ?? a;
  console.log("activa", v?.matchId ?? null, v?.status ?? null);
  const S = existsSync("docs/product/qa/fase73-closure/state.json") ? JSON.parse(readFileSync("docs/product/qa/fase73-closure/state.json", "utf8")) : {};
  const dk = (await api(t, "/api/game/duels")).json;
  const d = S.deckI ? dk.decks.find((x: any) => x.id === S.deckI.deckId) : null;
  console.log("deckI guardado", !!S.deckI, "igual al original", d ? JSON.stringify(d.cardUids) === JSON.stringify(S.deckI.original) : "n/a");
})();
