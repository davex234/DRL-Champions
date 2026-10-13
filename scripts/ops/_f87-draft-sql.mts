/**
 * F87 · BORRADOR REAL «Champions 2026 · Playoffs» como SQL de OPERADOR (instrumento, fuera de CI).
 *
 *   ssh … psql -At < export.sql > live.json      (partidos/fases VIVOS de vlr-2766, solo lectura)
 *   npx tsx scripts/ops/_f87-draft-sql.mts live.json > draft.sql
 *
 * Deriva el descriptor con el MISMO dominio que el panel (sin aristas de admin: los cruces de perdedores los define el
 * administrador con el cuadro oficial antes de publicar; el validador lo bloquea mientras falten). Estado DRAFT,
 * recompensas = propuesta F87 en BORRADOR (nunca activas), auditoría con actor NULL y «operador F87» en el detalle (no
 * se atribuye a ninguna cuenta). Idempotente: `on conflict (slug) do nothing`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalDescriptor, deriveFormat, type RealMatchRow, type StageRow } from "../../src/domain/pickems/format";
import { canonicalRewards, proposedRewards } from "../../src/domain/pickems/bracketRewards";

const live = JSON.parse(readFileSync(process.argv[2], "utf8")) as { stages: StageRow[]; matches: RealMatchRow[] };
const P = live.stages.find((s) => s.kind === "playoff")!;
const res = deriveFormat({ eventId: "vlr-2766", stages: [P], matches: live.matches.filter((m) => m.stage_id === P.id) });
const d = res.descriptor!;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const rewards = proposedRewards("champions-2026-playoffs"); // status DRAFT
const errors = res.issues.filter((i) => i.severity === "ERROR");
console.log(`-- ${new Date().toISOString()} · ${d.nodes.length} partidos · ${errors.length} errores del validador (${[...new Set(errors.map((e) => e.code))].join(", ")})`);
console.log("begin;");
console.log(`insert into public.pickem_brackets (slug, event_id, title, status, format_kind, stage_ids, descriptor, descriptor_checksum, admin_edges, max_points, lock_policy, rewards, rewards_status, rewards_checksum)
values ('champions-2026-playoffs', 'vlr-2766', 'Champions 2026 · Playoffs', 'DRAFT', ${lit(d.kind)}, array[${d.stageIds.map(lit).join(",")}]::text[], ${lit(JSON.stringify(d))}::jsonb, '${sha(canonicalDescriptor(d))}', '[]'::jsonb, ${d.nodes.reduce((s, n) => s + n.points, 0)}, 'MATCH', ${lit(JSON.stringify(rewards))}::jsonb, 'DRAFT', '${sha(canonicalRewards(rewards))}')
on conflict (slug) do nothing;`);
console.log(`insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
select null, 'pickem_draft_create', 'pickem_bracket', id::text, ${lit(JSON.stringify({ operator: "F87 despliegue (SQL de operador)", slug: "champions-2026-playoffs", checksum: sha(canonicalDescriptor(d)), validatorErrors: errors.map((e) => e.code), rewards: "propuesta F87 en BORRADOR (no activa)" }))}::jsonb
  from public.pickem_brackets where slug = 'champions-2026-playoffs' and not exists (select 1 from public.content_audit_log where entity_type = 'pickem_bracket' and action = 'pickem_draft_create' and detail->>'slug' = 'champions-2026-playoffs');`);
console.log(`do $$ begin if (select status from public.pickem_brackets where slug = 'champions-2026-playoffs') <> 'DRAFT' or (select rewards_status from public.pickem_brackets where slug = 'champions-2026-playoffs') = 'ACTIVE' then raise exception 'F87: el borrador no es borrador o sus recompensas están activas'; end if; end $$;`);
console.log("commit;");
console.log("select slug, status, rewards_status, jsonb_array_length(descriptor->'nodes') from public.pickem_brackets;");
