/**
 * F87.1 · DATOS DEL ENSAYO AISLADO de 0072 (fuera de CI). Todo va a una copia desechable `--network none`.
 *
 *   npx tsx scripts/ops/_f871-dryrun-data.mts <dir>   → <dir>/{setup.sql,picks1.sql,picks3.sql,expected.tsv,meta.env,rewards1.json,rewards3.json,bad_rewards.json}
 *
 * Evento SINTÉTICO `qa-f871-evt` (solo en la copia): los 20 partidos REALES de la fase de grupos de Champions 2026 con
 * ids nuevos (`q871-<id>`), mismos equipos, mismos resultados. Sin Pick'em legacy → autoridad Pick'ems 2.0.
 *   B1 · cuadro completo, reglas v1 ACTIVAS: 9 usuarios QA con picks diseñados para cada escalón y frontera.
 *   B3 · mismo evento, otro ámbito: se ANULA una Apertura → perfecto con VOID y hueco sin pick en otro partido.
 * La puntuación esperada sale del MISMO dominio TS (paridad con la liquidación SQL).
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import snapshot from "../../src/domain/pickems/fixtures/vlr-2766-champions-2026.snapshot.json" with { type: "json" };
import { canonicalDescriptor, deriveFormat, type RealMatchRow, type StageRow } from "../../src/domain/pickems/format";
import { realStateOf, scoreEntry } from "../../src/domain/pickems/prediction";
import { rewardRulesV1, tierFor } from "../../src/domain/pickems/bracketRewards";

const DIR = process.argv[2];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ADMIN = "3befce61-4c21-4c84-8397-40504fe6ec27"; // actor admin SOLO en la copia
const STAGE = "00000000-0000-4000-8000-0000000f8711";
const G = (snapshot.stages as StageRow[]).find((s) => s.kind === "group")!;
const src = (snapshot.matches as unknown as RealMatchRow[]).filter((m) => m.stage_id === G.id);
const nid = (id: string | null | undefined) => (id ? `q871-${id}` : null);
const matches: RealMatchRow[] = src.map((m) => ({ ...m, id: nid(m.id)!, event_id: "qa-f871-evt", stage_id: STAGE, winner_to_match_id: nid(m.winner_to_match_id), loser_to_match_id: nid(m.loser_to_match_id) }));
const stage: StageRow = { id: STAGE, name: "Group Stage (QA)", slug: "group-stage", kind: "group", order_idx: 0 };
const d = deriveFormat({ eventId: "qa-f871-evt", stages: [stage], matches }).descriptor!;
const real = realStateOf(matches);
const R1 = rewardRulesV1("qa-f871-b1", "ACTIVE");
const R3 = rewardRulesV1("qa-f871-b3", "ACTIVE");
const bad = { ...rewardRulesV1("qa-f871-b1", "ACTIVE"), tiers: rewardRulesV1("qa-f871-b1").tiers.map((t) => (t.id === "ELITE" ? { ...t, reward: { packId: "champions", packCount: 1 } } : t)) };

const role = (r: string) => (r === "OPENING" ? "o" : r === "WINNERS" ? "w" : r === "ELIMINATION" ? "e" : "d");
const node = (g: string, r: string, k = 0) => d.nodes.filter((n) => n.section === `group:${g}` && role(n.role!) === r)[k].matchId;
const winner = (id: string) => real.get(id)!.winnerId!;
const loser = (id: string) => real.get(id)!.loserId!;
const U = (i: number) => `00000000-0000-4000-8000-0000f8710${String(i).padStart(3, "0")}`;
interface Plan { name: string; wrong: string[]; missing: string[]; want: string }
const W = ["A", "B", "C", "D"].map((g) => node(g, "w")), DD = ["A", "B", "C", "D"].map((g) => node(g, "d"));
const plans: Plan[] = [
  { name: "PERFECT", wrong: [], missing: [], want: "PERFECT" },
  { name: "ELITE_EDGE_24", wrong: [DD[0], DD[1]], missing: [], want: "ELITE" },
  { name: "GREAT_TOP_23", wrong: [DD[0], DD[1], node("A", "o")], missing: [], want: "GREAT" },
  { name: "GREAT_EDGE_20", wrong: DD, missing: [], want: "GREAT" },
  { name: "GOOD_TOP_19", wrong: [...DD, node("A", "o")], missing: [], want: "GOOD" },
  { name: "GOOD_EDGE_14", wrong: [...W, DD[0], DD[1], DD[2]], missing: [], want: "GOOD" },
  { name: "PART_13", wrong: [...W, DD[0], DD[1], DD[2], node("A", "o")], missing: [], want: "PARTICIPATION" },
  { name: "NONE_75", wrong: [], missing: [node("A", "o"), node("A", "o", 1), node("B", "o"), node("B", "o", 1), node("C", "o")], want: "" },
  { name: "PART_80", wrong: [...W, ...DD], missing: [node("A", "o"), node("A", "o", 1), node("B", "o"), node("B", "o", 1)], want: "PARTICIPATION" },
];
const picksOf = (p: Plan) => Object.fromEntries(d.nodes.filter((n) => !p.missing.includes(n.matchId)).map((n) => [n.matchId, p.wrong.includes(n.matchId) ? loser(n.matchId) : winner(n.matchId)]));
const VOIDED = node("A", "o");
const plans3: Plan[] = [
  { name: "PERFECT_WITH_VOID", wrong: [], missing: [VOIDED], want: "PERFECT" },
  { name: "MISSING_BREAKS_PERFECT", wrong: [], missing: [node("A", "o", 1)], want: "ELITE" },
];

const out: string[] = [`-- generado por scripts/ops/_f871-dryrun-data.mts · ${new Date().toISOString()}`];
out.push(`insert into public.events (id, name, type, region, source, status, start_date, end_date) values ('qa-f871-evt', 'QA F87.1 (solo ensayo)', 'vlr-event', 'International', 'qa', 'finished', '2026-09-24', '2026-10-04');`);
out.push(`insert into public.stages (id, event_id, slug, name, kind, order_idx) values ('${STAGE}', 'qa-f871-evt', 'group-stage', 'Group Stage (QA)', 'group', 0);`);
// Partidos SIN aristas primero (las FK de progresión apuntan a filas que deben existir), luego las aristas.
for (const m of matches) out.push(`insert into public.matches (id, event_id, stage_id, round, match_order, best_of, status, start_time, team_a_id, team_b_id, team_a, team_b, winner_team_id, score_a, score_b) values (${lit(m.id)}, 'qa-f871-evt', '${STAGE}', ${lit(m.round ?? "")}, ${m.match_order}, ${m.best_of ?? 3}, 'finished', ${lit(m.start_time!)}, ${lit(m.team_a_id!)}, ${lit(m.team_b_id!)}, ${lit(m.team_a ?? "")}, ${lit(m.team_b ?? "")}, ${lit(m.winner_team_id!)}, ${m.score_a}, ${m.score_b});`);
for (const m of matches) out.push(`update public.matches set winner_to_match_id = ${m.winner_to_match_id ? lit(m.winner_to_match_id) : "null"}, winner_to_slot = ${m.winner_to_slot ?? "null"}, loser_to_match_id = ${m.loser_to_match_id ? lit(m.loser_to_match_id) : "null"}, winner_qualifies = ${m.winner_qualifies ? lit(m.winner_qualifies) : "null"}, winner_qualifies_label = ${m.winner_qualifies_label ? lit(m.winner_qualifies_label) : "null"}, progression_confidence = ${m.progression_confidence ? lit(m.progression_confidence) : "null"}, progression_evidence = ${m.progression_confidence ? "'SOURCE_STRUCTURED_HTML'" : "null"} where id = ${lit(m.id)};`);
const allUsers = [...plans, ...plans3].map((_, i) => U(i + 1));
for (const [i, u] of allUsers.entries()) out.push(`insert into auth.users (id, email, aud, role, instance_id, raw_user_meta_data) values ('${u}', 'qa-f871-dry-${i + 1}@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{"username":"qa_f871_dry_${i + 1}"}');`);
const draft = (slug: string) => `select public.app_pickem_admin_save_draft('${ADMIN}', null, '${slug}', 'qa-f871-evt', 'QA F87.1 · ${slug}', '${d.kind}', array['${STAGE}']::text[], ${lit(JSON.stringify(d))}::jsonb, '${sha(canonicalDescriptor(d))}', '[]'::jsonb, ${d.nodes.reduce((s, n) => s + n.points, 0)}, 'MATCH', null)->>'id';`;
out.push(draft("qa-f871-b1"));
out.push(draft("qa-f871-b3"));
writeFileSync(`${DIR}/setup.sql`, out.join("\n") + "\n");

const pk = (bid: string, list: Plan[], offset: number) => list.flatMap((p, i) => Object.entries(picksOf(p)).map(([mid, team]) => `select public.app_pickem_save_pick('${U(i + 1 + offset)}', :'${bid}', '${mid}', '${team}', null, '{}')->>'ok';`)).join("\n") + "\n";
writeFileSync(`${DIR}/picks1.sql`, pk("b1", plans, 0));
writeFileSync(`${DIR}/picks3.sql`, pk("b3", plans3, plans.length));

const exp: string[] = [];
const ctx = { descriptor: d, real };
plans.forEach((p, i) => { const s = scoreEntry(ctx, picksOf(p), () => true); const t = tierFor(R1, s) ?? ""; if (t !== p.want) throw new Error(`${p.name}: TS da ${t}, se esperaba ${p.want}`); exp.push([ "b1", U(i + 1), p.name, s.points, s.correct, s.picked, s.perfect ? "t" : "f", t].join("\t")); });
const ctx3 = { descriptor: d, real, voided: new Set([VOIDED]) };
plans3.forEach((p, i) => { const s = scoreEntry(ctx3, picksOf(p), () => true); const t = tierFor(R3, s) ?? ""; if (t !== p.want) throw new Error(`${p.name}: TS da ${t}, se esperaba ${p.want}`); exp.push(["b3", U(i + 1 + plans.length), p.name, s.points, s.correct, s.picked, s.perfect ? "t" : "f", t].join("\t")); });
writeFileSync(`${DIR}/expected.tsv`, exp.join("\n") + "\n");
writeFileSync(`${DIR}/rewards1.json`, JSON.stringify(R1));
writeFileSync(`${DIR}/rewards3.json`, JSON.stringify(R3));
writeFileSync(`${DIR}/bad_rewards.json`, JSON.stringify(bad));
writeFileSync(`${DIR}/meta.env`, [`CHK=${sha(canonicalDescriptor(d))}`, `VOIDED=${VOIDED}`, `ADMIN=${ADMIN}`, `NUSERS=${allUsers.length}`, `U_PERFECT=${U(1)}`, `U_ELITE=${U(2)}`, `U_NONE=${U(8)}`, `U_PART80=${U(9)}`, `U_GREAT=${U(4)}`, `G_MATCH=${node("B", "w")}`].join("\n") + "\n");
console.log(`ok · ${d.nodes.length} partidos · ${allUsers.length} usuarios · checksum ${sha(canonicalDescriptor(d)).slice(0, 12)}`);
