/** FASE 62 · sonda (instrumento `_`): ¿la foto del hub se puede componer sobre MemSupabase? */
import { MemSupabase } from "@/server/services/testing/memSupabase";
import { getMetaSnapshot } from "@/server/services/meta";
async function main() {
  const db = new MemSupabase(); db.seedUser("aaaaaaaa-0000-4000-8000-000000000062");
  const r = await getMetaSnapshot(db.client, "aaaaaaaa-0000-4000-8000-000000000062");
  console.log(r.ok, r.status, r.error, r.data && { level: r.data.level, season: r.data.season, coll: r.data.collection, missions: r.data.pass.missions.length, claimable: r.data.pass.missions.filter((m) => m.complete).length });
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
