import { MemSupabase } from "../src/server/services/testing/memSupabase";
import { getDeckWorkspace, saveComposition, createTeam } from "../src/server/services/deckTeams";
import { syntheticCollection } from "../src/lib/deckStrategy/catalog";
(async () => {
  const d = new MemSupabase(); const U = "aaaaaaaa-0000-4000-8000-000000000001"; d.seedUser(U);
  const coll = syntheticCollection(60, 3, 60);
  for (const c of coll) d.table("user_cards").push({ uid: c.uid, user_id: U, card_id: c.cardId, serial: c.serial, origin: "pack", locked: false, obtained_at: new Date().toISOString() });
  const w0 = d.writes;
  const r = await getDeckWorkspace(d.client, U);
  console.log(r.ok, r.status, r.error, r.data?.collection.length, d.writes - w0);
  const c = await createTeam(d.client, U, { name: "X", cardUids: [] } as never);
  console.log("create", c.ok, c.status, c.error, d.writes - w0);
})();
