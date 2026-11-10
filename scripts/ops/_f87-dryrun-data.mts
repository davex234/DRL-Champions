/**
 * F87 · DATOS DEL ENSAYO AISLADO (fuera de CI). Genera, con el MISMO dominio TS que usa la app:
 *   · el descriptor congelado + checksum de dos ámbitos REALES de Champions 2026 (vlr-2766):
 *       G = fase de grupos (GSL, 20 partidos, terminada) — para picks → liquidación → reclamos;
 *       P = playoffs (doble a 8, por jugar) con aristas de admin DE PRUEBA (solo existen en la copia desechable);
 *   · los picks deterministas de 4 usuarios SINTÉTICOS y la puntuación ESPERADA (TS) para comparar con la SQL.
 *
 *   npx tsx scripts/ops/_f87-dryrun-data.mts > /tmp/f87/setup.sql   (y escribe /tmp/f87/expected.tsv vía argv[2])
 *
 * Nada de esto toca una base de datos: imprime SQL para el contenedor `--network none` del ensayo.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import snapshot from "../../src/domain/pickems/fixtures/vlr-2766-champions-2026.snapshot.json" with { type: "json" };
import { canonicalDescriptor, deriveFormat, type RealMatchRow, type StageRow } from "../../src/domain/pickems/format";
import { realStateOf, scoreEntry } from "../../src/domain/pickems/prediction";
import { proposedRewards, tierFor } from "../../src/domain/pickems/bracketRewards";

const real = snapshot.matches as unknown as RealMatchRow[];
const stages = snapshot.stages as StageRow[];
const G = stages.find((s) => s.kind === "group")!;
const P = stages.find((s) => s.kind === "playoff")!;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const ADMIN = "3befce61-4c21-4c84-8397-40504fe6ec27"; // actor admin EN LA COPIA (cuenta real como actor; la copia se destruye)
export const USERS = [
  "00000000-0000-4000-8000-00000f870001", // QA1 · acierta todo (perfecto)
  "00000000-0000-4000-8000-00000f870002", // QA2 · siempre el equipo A
  "00000000-0000-4000-8000-00000f870003", // QA3 · solo 10 de 20 (participación insuficiente)
  "00000000-0000-4000-8000-00000f870004", // QA4 · sin picks
];

const gMatches = real.filter((m) => m.stage_id === G.id);
const g = deriveFormat({ eventId: "vlr-2766", stages: [G], matches: gMatches }).descriptor!;
const pMatches = real.filter((m) => m.stage_id === P.id);
const adminEdges = [ // DE PRUEBA: no afirman nada sobre el cuadro real; solo hacen publicable la copia.
  { from: "754732", to: "754738", source: "LOSER" as const, slot: 1 as const },
  { from: "754733", to: "754738", source: "LOSER" as const, slot: 2 as const },
  { from: "754730", to: "754739", source: "LOSER" as const, slot: 1 as const },
  { from: "754731", to: "754739", source: "LOSER" as const, slot: 2 as const },
  { from: "754734", to: "754741", source: "LOSER" as const, slot: null },
  { from: "754735", to: "754740", source: "LOSER" as const, slot: null },
];
const pRes = deriveFormat({ eventId: "vlr-2766", stages: [P], matches: pMatches, adminEdges });
const p = pRes.descriptor!;
const pErrors = pRes.issues.filter((i) => i.severity === "ERROR");
if (pErrors.length) throw new Error(`playoffs de prueba no publicables: ${JSON.stringify(pErrors)}`);

const rewards = proposedRewards("champions-2026-grupos");
rewards.status = "ACTIVE";

// Picks de la fase de grupos sobre los equipos REALES de cada partido (válidos: el cuadro se cura con la realidad).
const rs = realStateOf(gMatches);
const picks: Record<string, Record<string, string>> = { [USERS[0]]: {}, [USERS[1]]: {}, [USERS[2]]: {}, [USERS[3]]: {} };
gMatches.forEach((m, i) => {
  const r = rs.get(m.id)!;
  picks[USERS[0]][m.id] = r.winnerId!;
  picks[USERS[1]][m.id] = r.teamA!.id;
  if (i % 2 === 0) picks[USERS[2]][m.id] = r.winnerId!;
});

const out: string[] = [];
out.push(`-- generado por scripts/ops/_f87-dryrun-data.mts · ${new Date().toISOString()}`);
out.push(`\\set admin '${ADMIN}'`);
for (const [i, u] of USERS.entries()) out.push(`insert into auth.users (id, email, aud, role, instance_id, raw_user_meta_data) values ('${u}', 'qa-f87-dry-${i + 1}@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{"username":"qa_f87_dry_${i + 1}"}');`);
const draft = (slug: string, title: string, d: typeof g, edges: unknown[]) =>
  `select public.app_pickem_admin_save_draft('${ADMIN}', null, ${lit(slug)}, 'vlr-2766', ${lit(title)}, '${d.kind}', array[${d.stageIds.map(lit).join(",")}]::text[], ${lit(JSON.stringify(d))}::jsonb, '${sha(canonicalDescriptor(d))}', ${lit(JSON.stringify(edges))}::jsonb, ${d.nodes.reduce((s, n) => s + n.points, 0)}, 'MATCH', null)->>'id';`;
out.push(`-- G`);
out.push(draft("dry-champions-2026-grupos", "Ensayo · Champions 2026 · Grupos", g, []));
out.push(`-- P`);
out.push(draft("dry-champions-2026-playoffs", "Ensayo · Champions 2026 · Playoffs", p, adminEdges));
out.push(`-- REWARDS_G ${lit(JSON.stringify(rewards))}`);
console.log(out.join("\n"));

const exp: string[] = ["user\tpoints\tcorrect\tcompletion\tratio\tperfect\ttier"];
const final = { descriptor: g, real: rs };
for (const u of USERS) {
  const s = scoreEntry(final, picks[u], () => true);
  exp.push([u, s.points, s.correct, s.completion.toFixed(5), s.ratio.toFixed(5), s.perfect ? "t" : "f", tierFor(rewards, s) ?? ""].join("\t"));
}
const meta = {
  gChecksum: sha(canonicalDescriptor(g)), pChecksum: sha(canonicalDescriptor(p)),
  gMax: g.nodes.reduce((s, n) => s + n.points, 0), pMax: p.nodes.reduce((s, n) => s + n.points, 0),
  rewards, picks, gMatchIds: gMatches.map((m) => m.id), pUqf: p.nodes.filter((n) => n.section === "upper" && n.column === 0).map((n) => n.matchId),
};
if (process.argv[2]) {
  writeFileSync(`${process.argv[2]}/expected.tsv`, exp.join("\n") + "\n");
  writeFileSync(`${process.argv[2]}/meta.json`, JSON.stringify(meta));
  // Picks por la RPC (psql -v gid=…), para la ventana «abierta» de la copia.
  const pk: string[] = [];
  for (const u of USERS) for (const [mid, team] of Object.entries(picks[u])) pk.push(`select public.app_pickem_save_pick('${u}', :'gid', '${mid}', '${team}', null, '{}')->>'ok';`);
  writeFileSync(`${process.argv[2]}/picks.sql`, pk.join("\n") + "\n");
  writeFileSync(`${process.argv[2]}/rewards_g.json`, JSON.stringify(rewards));
  writeFileSync(`${process.argv[2]}/meta.env`, [`G_CHK=${meta.gChecksum}`, `P_CHK=${meta.pChecksum}`, `G_MAX=${meta.gMax}`, `P_MAX=${meta.pMax}`, `N_PICKS=${pk.length}`, `ADMIN=${ADMIN}`, `QA1=${USERS[0]}`, `QA2=${USERS[1]}`, `QA3=${USERS[2]}`, `QA4=${USERS[3]}`].join("\n") + "\n");
}
