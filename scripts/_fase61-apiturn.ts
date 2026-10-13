/** FASE 61 · diagnóstico (instrumento `_`): una partida PvE por API con la cuenta QA A; se abandona al final. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
/* eslint-disable @typescript-eslint/no-explicit-any */
const TMP = process.env.TEMP!;
const c = JSON.parse(readFileSync(join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/287155d6-0740-47dd-baa7-edb43491b4e3/scratchpad/f45-qa-creds.json"), "utf8"));
async function main() {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.auth.signInWithPassword({ email: c.email, password: c.password });
  const t = data.session!.access_token;
  const post = async (b: any) => (await fetch("http://127.0.0.1:3005/api/game/duel", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(b) })).json();
  const decks = await (await fetch("http://127.0.0.1:3005/api/game/duels", { headers: { authorization: `Bearer ${t}` } })).json();
  const s = await post({ action: "start", deckId: decks.decks[0].id, difficulty: "EASY" });
  let v = s.view;
  const brief = (v: any) => ({ turn: v.turn, attacker: v.attacker, youAreAttacker: v.youAreAttacker, phase: v.phase, pending: !!v.pendingRival, req: v.requiredStat, hist: v.history.map((h: any) => `${h.number}:${h.attacker}/${h.outcome} you=${h.you.stat}${h.you.value} riv=${h.rival.stat}${h.rival.value}`) });
  console.log("start", JSON.stringify(brief(v)));
  for (let k = 0; k < 3; k++) {
    const card = v.yourHand[0].uid;
    const r = await post({ action: "play", matchId: v.matchId, cardUid: card, ...(v.youAreAttacker ? { stat: "stronghold" } : {}) });
    v = r.view;
    console.log("after", k + 1, JSON.stringify(brief(v)));
  }
  await post({ action: "abandon", matchId: v.matchId });
}
main();
