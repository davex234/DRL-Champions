/**
 * F87.2 · DATOS DEL ENSAYO AISLADO de 0073 (fuera de CI). Todo va a una copia desechable `--network none`.
 *
 *   npx tsx scripts/ops/_f872-dryrun-data.mts <dir>   → <dir>/{setup.sql,picks1.sql,expected.tsv,meta.env,rewards1.json,rewards4.json,nopolicy.json,v9policy.json}
 *
 * Evento SINTÉTICO `qa-f872-evt` (solo en la copia): los 20 partidos REALES de la fase de grupos de Champions 2026 con
 * ids nuevos (`q872-<id>`), mismos equipos y resultados. Sin Pick'em legacy → autoridad Pick'ems 2.0.
 *   B1 · cuadro completo, reglas v1 + política `reward-eligibility-v1`: 10 usuarios QA con picks y MADUREZ diseñadas
 *        (madura / nueva / fronteras de antigüedad y de partidas). La madurez se fija en la copia respecto al primer
 *        cierre REAL del ámbito (lo calcula la BD), así que el script la aplica tras restaurar las horas.
 *   B4 · otro ámbito para las puertas de tiempo/congelación (no se reclama en él).
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
const EVT = "qa-f872-evt";
const STAGE = "00000000-0000-4000-8000-0000000f8721";
const G = (snapshot.stages as StageRow[]).find((s) => s.kind === "group")!;
const src = (snapshot.matches as unknown as RealMatchRow[]).filter((m) => m.stage_id === G.id);
const nid = (id: string | null | undefined) => (id ? `q872-${id}` : null);
const matches: RealMatchRow[] = src.map((m) => ({ ...m, id: nid(m.id)!, event_id: EVT, stage_id: STAGE, winner_to_match_id: nid(m.winner_to_match_id), loser_to_match_id: nid(m.loser_to_match_id) }));
const stage: StageRow = { id: STAGE, name: "Group Stage (QA)", slug: "group-stage", kind: "group", order_idx: 0 };
const d = deriveFormat({ eventId: EVT, stages: [stage], matches }).descriptor!;
const real = realStateOf(matches);
const R1 = rewardRulesV1("qa-f872-b1", "ACTIVE");
const R4 = rewardRulesV1("qa-f872-b4", "ACTIVE");
const { eligibilityPolicy: _p, ...noPolicy } = R1;
const v9 = { ...R1, eligibilityPolicy: "reward-eligibility-v9" };

const role = (r: string) => (r === "OPENING" ? "o" : r === "WINNERS" ? "w" : r === "ELIMINATION" ? "e" : "d");
const node = (g: string, r: string, k = 0) => d.nodes.filter((n) => n.section === `group:${g}` && role(n.role!) === r)[k].matchId;
const winner = (id: string) => real.get(id)!.winnerId!;
const loser = (id: string) => real.get(id)!.loserId!;
const U = (i: number) => `00000000-0000-4000-8000-0000f8720${String(i).padStart(3, "0")}`;
/** Madurez: días de la cuenta antes del primer cierre (en segundos exactos) y partidas antes/después y privadas. */
interface Plan { name: string; wrong: string[]; want: string; ageSec: number; before: number; after?: number; privateOnly?: boolean; eligible: string }
const W = ["A", "B", "C", "D"].map((g) => node(g, "w")), DD = ["A", "B", "C", "D"].map((g) => node(g, "d"));
const DAY = 86_400;
const PART = [...W, DD[0], DD[1], DD[2], node("A", "o")];
const GOOD = [...W, DD[0], DD[1], DD[2]];
const plans: Plan[] = [
  { name: "M_PERFECT", wrong: [], want: "PERFECT", ageSec: 40 * DAY, before: 5, eligible: "ELIGIBLE" },
  { name: "F_PERFECT", wrong: [], want: "PERFECT", ageSec: 1 * DAY, before: 0, eligible: "ACCOUNT_TOO_NEW_AND_NOT_ENOUGH_MATCHES" },
  { name: "M_PART", wrong: PART, want: "PARTICIPATION", ageSec: 40 * DAY, before: 3, eligible: "ELIGIBLE" },
  { name: "F_PART", wrong: PART, want: "PARTICIPATION", ageSec: 2 * DAY, before: 4, eligible: "ACCOUNT_TOO_NEW" },
  { name: "B_AGE_EXACT", wrong: GOOD, want: "GOOD", ageSec: 7 * DAY, before: 3, eligible: "ELIGIBLE" },
  { name: "B_AGE_MINUS", wrong: GOOD, want: "GOOD", ageSec: 7 * DAY - 1, before: 3, eligible: "ACCOUNT_TOO_NEW" },
  { name: "B_MATCH2", wrong: GOOD, want: "GOOD", ageSec: 40 * DAY, before: 2, eligible: "NOT_ENOUGH_MATCHES" },
  { name: "B_MATCH_AFTER", wrong: GOOD, want: "GOOD", ageSec: 40 * DAY, before: 2, after: 1, eligible: "NOT_ENOUGH_MATCHES" },
  { name: "B_PRIVATE", wrong: GOOD, want: "GOOD", ageSec: 40 * DAY, before: 3, privateOnly: true, eligible: "NOT_ENOUGH_MATCHES" },
  { name: "M_ELITE", wrong: [DD[0], DD[1]], want: "ELITE", ageSec: 40 * DAY, before: 3, eligible: "ELIGIBLE" },
];
const picksOf = (p: Plan) => Object.fromEntries(d.nodes.map((n) => [n.matchId, p.wrong.includes(n.matchId) ? loser(n.matchId) : winner(n.matchId)]));

const out: string[] = [`-- generado por scripts/ops/_f872-dryrun-data.mts · ${new Date().toISOString()}`];
out.push(`insert into public.events (id, name, type, region, source, status, start_date, end_date) values ('${EVT}', 'QA F87.2 (solo ensayo)', 'vlr-event', 'International', 'qa', 'finished', '2026-09-24', '2026-10-04');`);
out.push(`insert into public.stages (id, event_id, slug, name, kind, order_idx) values ('${STAGE}', '${EVT}', 'group-stage', 'Group Stage (QA)', 'group', 0);`);
for (const m of matches) out.push(`insert into public.matches (id, event_id, stage_id, round, match_order, best_of, status, start_time, team_a_id, team_b_id, team_a, team_b, winner_team_id, score_a, score_b) values (${lit(m.id)}, '${EVT}', '${STAGE}', ${lit(m.round ?? "")}, ${m.match_order}, ${m.best_of ?? 3}, 'finished', ${lit(m.start_time!)}, ${lit(m.team_a_id!)}, ${lit(m.team_b_id!)}, ${lit(m.team_a ?? "")}, ${lit(m.team_b ?? "")}, ${lit(m.winner_team_id!)}, ${m.score_a}, ${m.score_b});`);
for (const m of matches) out.push(`update public.matches set winner_to_match_id = ${m.winner_to_match_id ? lit(m.winner_to_match_id) : "null"}, winner_to_slot = ${m.winner_to_slot ?? "null"}, loser_to_match_id = ${m.loser_to_match_id ? lit(m.loser_to_match_id) : "null"}, winner_qualifies = ${m.winner_qualifies ? lit(m.winner_qualifies) : "null"}, winner_qualifies_label = ${m.winner_qualifies_label ? lit(m.winner_qualifies_label) : "null"}, progression_confidence = ${m.progression_confidence ? lit(m.progression_confidence) : "null"}, progression_evidence = ${m.progression_confidence ? "'SOURCE_STRUCTURED_HTML'" : "null"} where id = ${lit(m.id)};`);
for (const [i] of plans.entries()) out.push(`insert into auth.users (id, email, aud, role, instance_id, raw_user_meta_data) values ('${U(i + 1)}', 'qa-f872-dry-${i + 1}@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{"username":"qa_f872_dry_${i + 1}"}');`);
const draft = (slug: string) => `select public.app_pickem_admin_save_draft('${ADMIN}', null, '${slug}', '${EVT}', 'QA F87.2 · ${slug}', '${d.kind}', array['${STAGE}']::text[], ${lit(JSON.stringify(d))}::jsonb, '${sha(canonicalDescriptor(d))}', '[]'::jsonb, ${d.nodes.reduce((s, n) => s + n.points, 0)}, 'MATCH', null)->>'id';`;
out.push(draft("qa-f872-b1"));
out.push(draft("qa-f872-b4"));
writeFileSync(`${DIR}/setup.sql`, out.join("\n") + "\n");

writeFileSync(`${DIR}/picks1.sql`, plans.flatMap((p, i) => Object.entries(picksOf(p)).map(([mid, team]) => `select public.app_pickem_save_pick('${U(i + 1)}', :'b1', '${mid}', '${team}', null, '{}')->>'ok';`)).join("\n") + "\n");

// Madurez respecto al primer cierre REAL (:ref, lo pasa el script): antigüedad exacta y partidas antes/después.
const mat: string[] = [];
plans.forEach((p, i) => {
  const u = U(i + 1);
  mat.push(`update auth.users set created_at = :'ref'::timestamptz - interval '${p.ageSec} seconds' where id = '${u}';`);
  const row = (when: string, mode: string) => mode === "PVP_PRIVATE"
    ? `insert into public.duel_matches (user_id, difficulty, status, state, rng, rules_version, mode, player_b_id, deck_b_id, deck_id, winner, created_at, updated_at) select '${u}', 'NORMAL', 'COMPLETED', '{}', '{}', 'qa-f872', 'PVP_PRIVATE', '${U(i === 0 ? 2 : 1)}', id, id, 'A', ${when}, ${when} from public.duel_decks limit 1;`
    : `insert into public.duel_matches (user_id, difficulty, status, state, rng, rules_version, mode, winner, created_at, updated_at) values ('${u}', 'NORMAL', 'COMPLETED', '{}', '{}', 'qa-f872', 'PVE', 'A', ${when}, ${when});`;
  for (let k = 0; k < p.before; k++) mat.push(row(`:'ref'::timestamptz - interval '${k + 1} hours'`, p.privateOnly ? "PVP_PRIVATE" : "PVE"));
  for (let k = 0; k < (p.after ?? 0); k++) mat.push(row(`:'ref'::timestamptz + interval '${k + 1} hours'`, "PVE"));
});
writeFileSync(`${DIR}/maturity.sql`, mat.join("\n") + "\n");

const exp: string[] = [];
const ctx = { descriptor: d, real };
plans.forEach((p, i) => {
  const s = scoreEntry(ctx, picksOf(p), () => true); const t = tierFor(R1, s) ?? "";
  if (t !== p.want) throw new Error(`${p.name}: TS da ${t}, se esperaba ${p.want}`);
  exp.push([U(i + 1), p.name, t, p.eligible].join("\t"));
});
writeFileSync(`${DIR}/expected.tsv`, exp.join("\n") + "\n");
writeFileSync(`${DIR}/rewards1.json`, JSON.stringify(R1));
writeFileSync(`${DIR}/rewards4.json`, JSON.stringify(R4));
writeFileSync(`${DIR}/nopolicy.json`, JSON.stringify(noPolicy));
writeFileSync(`${DIR}/v9policy.json`, JSON.stringify(v9));
writeFileSync(`${DIR}/meta.env`, [`CHK=${sha(canonicalDescriptor(d))}`, `ADMIN=${ADMIN}`, `EVT=${EVT}`, ...plans.map((p, i) => `${p.name}=${U(i + 1)}`)].join("\n") + "\n");
console.log(`ok · ${d.nodes.length} partidos · ${plans.length} usuarios · checksum ${sha(canonicalDescriptor(d)).slice(0, 12)}`);
