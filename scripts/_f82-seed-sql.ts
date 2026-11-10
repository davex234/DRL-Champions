/**
 * F82 · CONTENIDO INICIAL DE PRODUCCIÓN (instrumento de operador, fuera de CI). Genera UN fichero SQL; no toca la BD.
 *
 *   npx tsx scripts/_f82-seed-sql.ts <salida.sql>
 *
 * 1. BORRADORES de TODOS los sets elegibles (generador sobre el catálogo real: 23 equipos + 2 ediciones), `on conflict
 *    do nothing` (re-ejecutable). Nada se publica por generar.
 * 2. PUBLICA solo `PUBLISH` (pequeño y verificado): cada uno pasa `validateForPublish` aquí (o el script aborta), y el SQL
 *    re-comprueba en la BD que cada carta congelada existe en `content_cards` y está PUBLISHED (o aborta la transacción).
 *    El checksum es el MISMO del panel: sha256(canonicalPayload).
 * 3. Auditoría: una fila por acción en `content_audit_log` (actor NULL = operador, detalle `operator: F82`), igual que el
 *    resto de cambios de operador; el registro es append-only.
 * Todo en UNA transacción con guardia final (cuenta exacta de publicados) antes del COMMIT.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { generateEditionDrafts, generateTeamDrafts, isSkip, liveContext, type DraftProposal } from "../src/domain/collectionSets/generator";
import { validateForPublish } from "../src/domain/collectionSets/validate";
import { canonicalPayload } from "../src/domain/collectionSets/progress";

/** Publicados en F82: identidad verificada (20.2) o equipo impreso exacto, logo real, plantilla con carta para todos. */
const PUBLISH = ["team-g2-v1", "team-team-heretics-v1", "team-fnatic-v1", "team-leviatan-v1", "team-team-liquid-v1", "team-eternal-fire-v1"];

const out = process.argv[2];
if (!out) throw new Error("uso: _f82-seed-sql.ts <salida.sql>");
const ctx = liveContext();
const drafts = [...generateTeamDrafts(ctx), ...generateEditionDrafts(ctx)].filter((d): d is DraftProposal => !isSkip(d));
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const json = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;

const lines: string[] = ["begin;", "set local lock_timeout = '5s';"];
for (const d of drafts) {
  lines.push(`insert into public.collection_sets (id, family, version, kind, subject_id, title, status, requirements, reward, logo) values (${lit(d.id)}, ${lit(d.family)}, ${d.version}, ${lit(d.kind)}, ${lit(d.subjectId)}, ${lit(d.title)}, 'DRAFT', ${json(d.requirements)}, ${json(d.reward)}, ${d.logo ? lit(d.logo) : "null"}) on conflict (id) do nothing;`);
}
lines.push(`insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'f82_set_generate', 'collection_set', 'TEAM+EDITION', ${json({ operator: "F82", created: drafts.map((d) => d.id) })});`);

const allCards = new Set<string>();
for (const id of PUBLISH) {
  const d = drafts.find((x) => x.id === id);
  if (!d) throw new Error(`${id} no es un borrador elegible`);
  const issues = validateForPublish({ ...d, status: "DRAFT" }, ctx);
  if (issues.length) throw new Error(`${id}: ${JSON.stringify(issues)}`);
  d.requirements.forEach((r) => r.cardIds.forEach((c) => allCards.add(c)));
  const checksum = createHash("sha256").update(canonicalPayload(d)).digest("hex");
  lines.push(`update public.collection_sets set status = 'PUBLISHED', checksum = ${lit(checksum)}, published_at = now() where id = ${lit(id)} and status = 'DRAFT' and requirements = ${json(d.requirements)};`);
  lines.push(`insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'f82_set_publish', 'collection_set', ${lit(id)}, ${json({ operator: "F82", family: d.family, version: d.version, requirements: d.requirements.length, checksum })});`);
}
lines.push(`do $$ declare missing int; pub int; begin
  select count(*) into missing from unnest(array[${[...allCards].map(lit).join(",")}]) c where not exists (select 1 from public.content_cards cc where cc.card_id = c and cc.lifecycle = 'PUBLISHED');
  if missing <> 0 then raise exception 'F82_SEED: % cartas congeladas no existen o no están publicadas', missing; end if;
  select count(*) into pub from public.collection_sets where status = 'PUBLISHED';
  if pub <> ${PUBLISH.length} then raise exception 'F82_SEED: publicados % <> ${PUBLISH.length}', pub; end if;
end $$;`);
lines.push("commit;");
writeFileSync(out, lines.join("\n") + "\n");
console.log(`drafts=${drafts.length} publish=${PUBLISH.length} frozenCards=${allCards.size} → ${out}`);
