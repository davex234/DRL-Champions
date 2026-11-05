/**
 * F59 · IMPORTADOR DE ARTE DE AGENTES — `personajes/{cara,entero}` → `public/agents/<id>/{face,full}.webp`
 * + `src/domain/tactics/agentArtManifest.ts` (GENERADO) + inventario en `docs/product/qa/fase59-agent-visual-system/`.
 *
 *   npm run agent-art:import            importa (sólo escribe lo que cambia)
 *   npm run agent-art:import -- --check  no escribe nada; sale con 1 si algo no coincide
 *
 * Reglas:
 *   · Los originales NO se tocan (sólo se leen).
 *   · Fichero → agente por identidad normalizada (`planAgentArt`, `agentArt.ts`); nunca por posición.
 *   · Dos ficheros para el mismo agente y pieza → FALLA (no se elige uno en silencio).
 *   · Ficheros que no son de ningún agente del roster → se informan y no se importan.
 *   · Formato de salida WEBP (conserva alfa; nada de JPG). Cara ≤ 256 px, cuerpo ≤ 352 px de ancho: sin ampliar.
 *   · Caras OPACAS con fondo blanco liso (fade, iso, killjoy): se quita SOLO el blanco conectado al borde
 *     (relleno por inundación), en el derivado. Los cuerpos enteros opacos conservan su fondo de estudio:
 *     el componente los funde con el marco (máscara), no se recortan.
 *   · Idempotente: misma entrada → mismos bytes y mismo manifiesto; no hay fechas en la salida.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { TACTICAL_AGENTS } from "@/domain/tactics/roster";
import { AGENT_ART_KINDS, AGENT_ART_SOURCE_DIRS, planAgentArt, type AgentArtKind, type SourceFile } from "@/domain/tactics/agentArt";

const ROOT = process.cwd();
const SRC = join(ROOT, "personajes");
const PUBLIC = join(ROOT, "public", "agents");
const MANIFEST = join(ROOT, "src", "domain", "tactics", "agentArtManifest.ts");
const EVIDENCE = join(ROOT, "docs", "product", "qa", "fase59-agent-visual-system");
const CHECK = process.argv.includes("--check");

const MAX = { face: { width: 256, height: 256 }, full: { width: 352, height: 720 } } as const;
const WEBP = { quality: 90, alphaQuality: 100, effort: 6, smartSubsample: true } as const;

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const changed: string[] = [];

function put(path: string, data: Buffer | string) {
  const next = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  if (existsSync(path) && readFileSync(path).equals(next)) return;
  changed.push(path.slice(ROOT.length + 1).replace(/\\/g, "/"));
  if (!CHECK) writeFileSync(path, next);
}

/** Quita el blanco liso CONECTADO AL BORDE (no el blanco de dentro de la figura). */
async function removeWhiteBackdrop(input: Buffer): Promise<{ buf: Buffer; removed: number }> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const isBg = (i: number) => {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    return Math.min(r, g, b) >= 228 && Math.max(r, g, b) - Math.min(r, g, b) <= 28;
  };
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    if (bg[p] || !isBg(p)) continue;
    bg[p] = 1;
    const x = p % w, y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  let removed = 0;
  const mask = Buffer.alloc(w * h);
  for (let p = 0; p < w * h; p++) { mask[p] = bg[p] ? 0 : 255; removed += bg[p]; }
  // Borde suave de ~1 px: sin escalera ni halo duro.
  const { data: soft, info: si } = await sharp(mask, { raw: { width: w, height: h, channels: 1 } }).blur(0.8).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  if (si.channels !== 1 || soft.length !== w * h) throw new Error(`máscara inesperada: ${si.channels} canales`);
  for (let p = 0; p < w * h; p++) data[p * 4 + 3] = Math.min(data[p * 4 + 3], soft[p]);
  const buf = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return { buf, removed };
}

interface Out { src: string; width: number; height: number; alpha: boolean; source: string; sourceSha: string; backdrop?: "white-removed"; small?: { src: string; width: number; height: number } }

/** Cara pequeña para chips, filas, roster y fichas del mapa (se muestran a 16–48 px): ~5 KB en vez de ~16 KB. */
const FACE_SMALL = 96;

(async () => {
  const files: SourceFile[] = [];
  const inventory: Record<string, unknown>[] = [];
  const seenSha = new Map<string, string>();
  for (const kind of AGENT_ART_KINDS) {
    const dir = join(SRC, AGENT_ART_SOURCE_DIRS[kind]);
    for (const file of readdirSync(dir).sort()) {
      files.push({ kind, file });
      const raw = readFileSync(join(dir, file));
      let meta: Record<string, unknown> = {};
      try {
        const m = await sharp(raw).metadata();
        const st = await sharp(raw).stats();
        meta = { format: m.format === "heif" ? "avif" : m.format, width: m.width, height: m.height, hasAlphaChannel: !!m.hasAlpha, transparent: !st.isOpaque };
      } catch (e) { meta = { error: (e as Error).message }; }
      const h = sha(raw);
      const dup = seenSha.get(h);
      seenSha.set(h, `${AGENT_ART_SOURCE_DIRS[kind]}/${file}`);
      inventory.push({ path: `personajes/${AGENT_ART_SOURCE_DIRS[kind]}/${file}`, kind, bytes: raw.length, sha256: h, ...meta, duplicateOf: dup ?? null });
    }
  }

  const plan = planAgentArt(files);
  if (plan.collisions.length) {
    console.error("[agent-art] COLISIONES — dos ficheros para el mismo agente y pieza; resuélvelo en personajes/:", JSON.stringify(plan.collisions, null, 1));
    process.exit(1);
  }

  const manifest: Record<string, Partial<Record<AgentArtKind, Out>>> = {};
  for (const kind of AGENT_ART_KINDS) {
    for (const [agentId, file] of Object.entries(plan.assigned[kind])) {
      const rel = `personajes/${AGENT_ART_SOURCE_DIRS[kind]}/${file}`;
      const raw = readFileSync(join(ROOT, rel));
      let input: Buffer = raw;
      let backdrop: Out["backdrop"];
      if (kind === "face" && (await sharp(raw).stats()).isOpaque) {
        const r = await removeWhiteBackdrop(raw);
        if (r.removed > 0) { input = r.buf; backdrop = "white-removed"; }
      }
      const { data, info } = await sharp(input)
        .resize({ ...MAX[kind], fit: "inside", withoutEnlargement: true })
        .webp(WEBP)
        .toBuffer({ resolveWithObject: true });
      const dir = join(PUBLIC, agentId);
      if (!CHECK) mkdirSync(dir, { recursive: true });
      put(join(dir, `${kind}.webp`), data);
      const alpha = !(await sharp(data).stats()).isOpaque;
      let small: Out["small"];
      if (kind === "face") {
        const s = await sharp(input).resize({ width: FACE_SMALL, height: FACE_SMALL, fit: "inside", withoutEnlargement: true }).webp(WEBP).toBuffer({ resolveWithObject: true });
        put(join(dir, "face-96.webp"), s.data);
        small = { src: `/agents/${agentId}/face-96.webp?v=${sha(s.data).slice(0, 10)}`, width: s.info.width, height: s.info.height };
      }
      manifest[agentId] = { ...manifest[agentId], [kind]: {
        src: `/agents/${agentId}/${kind}.webp?v=${sha(data).slice(0, 10)}`,
        width: info.width, height: info.height, alpha, source: rel, sourceSha: sha(raw).slice(0, 16), ...(backdrop ? { backdrop } : {}), ...(small ? { small } : {}),
      } };
    }
  }

  // Sin basura: una pieza que ya no tiene origen se retira (sólo face/full de agentes reales; el legado F48 no se toca).
  for (const a of TACTICAL_AGENTS) for (const kind of AGENT_ART_KINDS) {
    for (const f of kind === "face" ? ["face.webp", "face-96.webp"] : ["full.webp"]) {
      const p = join(PUBLIC, a.id, f);
      if (!manifest[a.id]?.[kind] && existsSync(p)) { changed.push(`removed ${p}`); if (!CHECK) rmSync(p); }
    }
  }

  const ids = TACTICAL_AGENTS.map((a) => a.id).sort();
  const line = (o?: Out) => (o ? JSON.stringify(o).replace(/"(\w+)":/g, "$1: ").replace(/,(?=\w+: )/g, ", ") : "null");
  const ts = `/**
 * F59 · MANIFIESTO DE ARTE DE AGENTES — FICHERO GENERADO por \`npm run agent-art:import\`. No se edita a mano.
 *
 * Una fila por agente del roster real (\`roster.ts\`); \`null\` = esa pieza no existe y el componente pinta su
 * respaldo sin pedir nada. \`source\` es el original en \`personajes/\` (intacto); \`sourceSha\` detecta si cambió.
 * \`?v=\` es el hash del derivado: cambia sólo si cambia la imagen.
 */
export interface AgentArtAsset {
  src: string;
  width: number;
  height: number;
  /** ¿El derivado tiene transparencia? Los cuerpos opacos traen fondo de estudio y se funden con máscara. */
  alpha: boolean;
  source: string;
  sourceSha: string;
  /** Se quitó un fondo blanco liso conectado al borde (sólo caras opacas). */
  backdrop?: "white-removed";
  /** Cara de 96 px para tamaños pequeños (\`srcset\` y fichas del mapa). */
  small?: { src: string; width: number; height: number };
}

export const AGENT_ART_MANIFEST: Readonly<Record<string, { face: AgentArtAsset | null; full: AgentArtAsset | null }>> = {
${ids.map((id) => `  ${JSON.stringify(id)}: {\n    face: ${line(manifest[id]?.face)},\n    full: ${line(manifest[id]?.full)},\n  },`).join("\n")}
};
`;
  put(MANIFEST, ts);

  if (!CHECK) mkdirSync(EVIDENCE, { recursive: true });
  const mapping = ids.map((id) => ({
    agentId: id, displayName: TACTICAL_AGENTS.find((a) => a.id === id)!.name,
    faceSource: manifest[id]?.face?.source ?? null, fullSource: manifest[id]?.full?.source ?? null,
    faceAsset: manifest[id]?.face?.src ?? null, fullAsset: manifest[id]?.full?.src ?? null,
    hasFace: !!manifest[id]?.face, hasFull: !!manifest[id]?.full,
    faceBackdropRemoved: manifest[id]?.face?.backdrop === "white-removed",
  }));
  const json = (o: unknown) => JSON.stringify(o, null, 1) + "\n";
  put(join(EVIDENCE, "asset-inventory.json"), json({ roots: ["personajes/cara", "personajes/entero"], files: inventory }));
  put(join(EVIDENCE, "agent-mapping.json"), json({ canonicalAgents: ids.length, source: "src/domain/tactics/roster.ts (TACTICAL_AGENTS)", renamed: plan.renamed, mapping }));
  put(join(EVIDENCE, "missing-assets.json"), json({
    bothAssets: mapping.filter((m) => m.hasFace && m.hasFull).map((m) => m.agentId),
    faceOnly: mapping.filter((m) => m.hasFace && !m.hasFull).map((m) => m.agentId),
    fullOnly: mapping.filter((m) => !m.hasFace && m.hasFull).map((m) => m.agentId),
    none: mapping.filter((m) => !m.hasFace && !m.hasFull).map((m) => m.agentId),
    unrecognizedFiles: plan.unknown, collisions: plan.collisions,
  }));

  const summary = { agents: ids.length, face: Object.keys(plan.assigned.face).length, full: Object.keys(plan.assigned.full).length, missing: plan.missing, unknown: plan.unknown.length, renamed: plan.renamed.length, changed };
  console.log(JSON.stringify(summary, null, 1));
  if (CHECK && changed.length) { console.error("[agent-art] --check: la salida no coincide con los originales; ejecuta npm run agent-art:import"); process.exit(1); }
})();
