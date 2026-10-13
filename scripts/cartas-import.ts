/**
 * CARTAS\ → CATÁLOGO DEL JUEGO (datos + assets web). Reproducible y de solo lectura sobre los originales.
 *
 *   npx tsx scripts/cartas-import.ts [--check]
 *
 * Entrada:
 *   · `docs/product/catalog-replace/NEW_CATALOG_MANIFEST.json` — una entrada por imagen de `Cartas\`,
 *     con jugador (cruzado contra `content_players`), edición (del nombre de fichero) y los datos
 *     IMPRESOS en la carta (OVR, rol y 6 estadísticas, leídos dos veces y concordantes). Ver
 *     `docs/product/catalog-replace-nogo.md` § 1 para cómo se construyó.
 *   · Los originales de `Cartas\` (1288×1800 RGBA). NUNCA se modifican: sólo se leen.
 *
 * Salida:
 *   · `public/cards/<card_id>.webp` — derivado web 750×1048, sin cambios visuales (sólo reescalado).
 *   · `src/data/cardCatalog.ts` — el catálogo de cartas (generado; no se edita a mano).
 *
 * Qué entra: las cartas SAFE cuyo jugador tiene trío de combate real. Qué NO entra (decisión del
 * usuario, 2026-09-21): las 11 de jugadores sin datos y las de jugadores sin rondas suficientes
 * (hoy, Kyu: 88 < 100). Quedan listadas en la salida, no se inventan. Las 2 de Rosé (BBL) entraron
 * el 2026-09-21 al reevaluarlas: solo estaban fuera por el nick en mojibake («RosÃ©», ya reparado).
 *
 * `--check` no escribe nada: comprueba que los assets y el fichero de datos existen y cuadran.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const MANIFEST = join(ROOT, "docs/product/catalog-replace/NEW_CATALOG_MANIFEST.json");
const SRC_DIR = join(ROOT, "Cartas");
const OUT_DIR = join(ROOT, "public/cards");
const DATA_FILE = join(ROOT, "src/data/cardCatalog.ts");
const CHECK = process.argv.includes("--check");

/** Jugadores sin trío de combate real (rondas < MIN_ROUNDS). Medido contra la BD, 2026-09-21. */
const SIN_COMBATE = new Set(["kyu"]);

/** Tamaño web: mismo aspecto que el original (1288×1800 ≈ 0,7156). */
const W = 750;
const H = Math.round((1800 / 1288) * W); // 1048

const ROLE: Record<string, string> = { DLT: "Duelista", INT: "Iniciador", SMO: "Controlador", SEN: "Centinela", FLX: "Flex" };

interface Row {
  status: string; source_file: string; sha256: string; card_id: string | null; player_id: string | null;
  edition: string | null; ovr: number; role: string; DMG: number; SCR: number; FKS: number; HS: number; AST: number; CLU: number;
}

async function main() {
  const rows = (JSON.parse(readFileSync(MANIFEST, "utf8")) as Row[]);
  const incluidas = rows.filter((r) => r.status === "SAFE" && r.player_id && !SIN_COMBATE.has(r.player_id));
  const fuera = rows.filter((r) => !incluidas.includes(r));

  const ids = new Set<string>();
  for (const r of incluidas) {
    if (!r.card_id || ids.has(r.card_id)) throw new Error(`card_id inválido o repetido: ${r.card_id}`);
    if (!ROLE[r.role]) throw new Error(`rol impreso desconocido «${r.role}» en ${r.source_file}`);
    ids.add(r.card_id);
  }

  if (!CHECK) mkdirSync(OUT_DIR, { recursive: true });
  let bytes = 0;
  for (const r of incluidas) {
    const src = join(SRC_DIR, r.source_file);
    const buf = readFileSync(src);
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== r.sha256) throw new Error(`el original ha cambiado desde el manifiesto: ${r.source_file}`);
    const out = join(OUT_DIR, `${r.card_id}.webp`);
    if (CHECK) {
      if (!existsSync(out)) throw new Error(`falta el asset ${out}`);
    } else {
      await sharp(buf).resize(W, H, { fit: "fill", kernel: "lanczos3" }).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile(out);
    }
    bytes += statSync(out).size;
  }

  const entries = incluidas.map((r) => ({
    id: r.card_id!, playerId: r.player_id!, variantId: r.edition!, ovr: r.ovr, role: ROLE[r.role],
    stats: { dmg: r.DMG, scr: r.SCR, fks: r.FKS, hs: r.HS, ast: r.AST, clu: r.CLU },
    source: r.source_file, sha256: r.sha256,
  }));
  const ts = `/**
 * CATÁLOGO DE CARTAS — FICHERO GENERADO por \`scripts/cartas-import.ts\`. No se edita a mano.
 *
 * Una entrada por carta de \`Cartas\\\` importada (${entries.length}). Los números (OVR, rol y las 6
 * estadísticas DMG·SCR·FKS·HS·AST·CLU) son los IMPRESOS en la carta. El trío de combate NO está
 * aquí: sale de las métricas reales del jugador (\`src/data/catalog.ts\`).
 * \`source\`/\`sha256\` identifican el original del que sale cada carta.
 */
import type { CardManifestEntry } from "@/domain/cards/types";

export const CARD_IMAGE_SIZE = { width: ${W}, height: ${H} } as const;

export const CARD_MANIFEST: CardManifestEntry[] = ${JSON.stringify(entries, null, 1).replace(/\n\s*/g, " ").replace(/\}, \{/g, "},\n  {").replace(/^\[ /, "[\n  ").replace(/ \]$/, ",\n]")};
`;
  if (CHECK) {
    if (readFileSync(DATA_FILE, "utf8") !== ts) throw new Error("src/data/cardCatalog.ts no coincide con el manifiesto");
  } else {
    writeFileSync(DATA_FILE, ts);
  }

  console.log(JSON.stringify({
    incluidas: incluidas.length, jugadores: new Set(incluidas.map((r) => r.player_id)).size,
    assetsMB: +(bytes / 1048576).toFixed(1), mediaKB: Math.round(bytes / incluidas.length / 1024),
    fuera: fuera.map((r) => `${r.source_file} (${r.status === "SAFE" ? "sin trío de combate real" : r.status})`),
  }, null, 1));
}

void main().catch((e) => { console.error(e); process.exit(1); });
