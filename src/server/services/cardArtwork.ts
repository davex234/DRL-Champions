/**
 * EXPORTAR UNA VERSIÓN DE CARTA COMO IMAGEN — el adaptador, no un segundo renderizador.
 *
 * ────────────────────────── QUÉ HAY Y QUÉ FALTABA ──────────────────────────
 *
 * El proyecto ya sabe rasterizar cartas: `card-generator` produce `CardSpec`,
 * `artwork-composer` lo convierte en `ArtworkComposition` y `artwork-renderer` lo saca a
 * PNG · WEBP · thumbnail · preview · manifest.json con sharp. Funciona desde julio.
 *
 * Lo que faltaba no era un renderizador: era el **puente**. Ese motor come `CardSpec`, que
 * nace de una generación de torneo, y las cartas del panel nacen de otro sitio —una fila de
 * `content_card_versions`—. Este módulo es ese puente y nada más.
 *
 * ────────────────────────── NO DUPLICA NI UNA DERIVACIÓN ──────────────────────────
 *
 * Cada campo sale de quien ya lo sabía:
 *
 *   fila de versión → `fromVersionRow()`   la MISMA proyección que usa el catálogo servido
 *   variante        → `getVariant()`       paleta, rango, serializada, límite de serie
 *   bucket          → `bucketForRank()`    la función del dominio de sobres
 *   serie / tipo    → `seriesOf()` · `kindForFamily()`   exportadas por card-generator
 *   referencias     → `resolveArtwork()`   exportada por card-generator
 *   valor           → `marketValue()`      la del mercado
 *
 * Aquí no se calcula un OVR, ni una rareza, ni un rango, ni una serie. Se leen.
 *
 * ────────────────────────── LOS DOS ÚNICOS MAPEOS ──────────────────────────
 *
 * `tier` y `family` no existen en el catálogo del panel, y se traducen sin inventar nada:
 *
 *   · `tier` es el mismo eje que `rarityBucket` en el vocabulario de `intel/decide`. Se
 *     traduce 1:1. No se recalcula desde el OVR —eso sería una segunda autoridad de rareza—.
 *   · `family` es el GRUPO de la variante, que es exactamente lo que una carta creada a mano
 *     es: una carta de su familia de variante, sin accolade de torneo detrás.
 *
 * ────────────────────────── DÓNDE SE GUARDA, Y POR QUÉ AHÍ ──────────────────────────
 *
 * En `output/artwork/admin/<cardId>/v<N>/`, que es la salida NATIVA del renderizador. No se
 * toca la tabla `assets` ni el bucket de Storage: su `CHECK` de `subject_type` no admite
 * `card` y ampliarlo es una migración. Ver `docs/cards/CARD-ARTWORK-EXPORT.md`.
 *
 * Una carpeta POR VERSIÓN es lo que garantiza lo que el encargo exige: publicar la v2 no
 * puede pisar el PNG de la v1 porque escriben en sitios distintos.
 *
 * ────────────────────────── LA FOTO QUE NO HAY ──────────────────────────
 *
 * `public/players` está vacío. El renderizador NO falla por eso: `AssetMaterializer`
 * sustituye por el marcador oficial y lo marca (`substituted`). Aquí se cuenta cuántos
 * elementos se han sustituido y se devuelve, para que la pantalla lo diga en vez de dar por
 * buena una carta con un hueco. **No se inventa ninguna foto.**
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArtworkEngine, playerAsset, teamAsset, countryAsset } from "@/artwork";
import { composeArtwork, type ComposerCtx } from "@/artwork-composer";
import { ArtworkRenderer } from "@/artwork-renderer";
import { seriesOf, kindForFamily } from "@/card-generator/specs";
import { resolveArtwork } from "@/card-generator/artwork";
import type { CardSpec } from "@/card-generator";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import { getVariant } from "@/domain/cards/variants";
import { marketValue } from "@/domain/economy/pricing";
import { decideMarket } from "@/live/market";
import { fromVersionRow, fromPlayerRow, type ContentCardVersionRow, type ContentPlayerRow } from "@/server/catalog/rows";
import type { RarityTier } from "@/intel/decide";
import type { VariantId } from "@/domain/cards/types";

/** Raíz de la salida. Fuera de `public/`: estos ficheros no se sirven solos, los sirve el panel. */
export const ARTWORK_ROOT = join(process.cwd(), "output", "artwork", "admin");

/** Carpeta de UNA versión. Es lo que aísla la v1 de la v2. */
export const artworkDir = (cardId: string, version: number): string =>
  join(ARTWORK_ROOT, cardId, `v${version}`);

/**
 * `rarityBucket` → `RarityTier`. Dos vocabularios del mismo eje, no una regla nueva.
 * `uncommon` no tiene par propio en `intel/decide`, y cae en «comun» como el resto de lo
 * que no es raro: es el mismo criterio que usa el generador para las variantes base.
 */
const TIER_POR_BUCKET: Record<RarityBucket, RarityTier> = {
  common: "comun",
  uncommon: "comun",
  rare: "rara",
  epic: "epica",
  legendary: "legendaria",
};

export interface ArtworkResult {
  cardId: string;
  version: number;
  /** Ficheros escritos, relativos a la carpeta de la versión. */
  files: { kind: string; path: string; bytes: number }[];
  /** Cuántos elementos usaron el marcador oficial por no existir el asset real. */
  substituted: number;
  /** `true` si ya estaba renderizado con la misma huella y no se ha vuelto a rasterizar. */
  cached: boolean;
  fingerprint: string;
}

/**
 * Fila de versión (+ su jugador) → `CardSpec`.
 *
 * `season` sale de la calibración con la que la carta nació (`data_version`, p. ej.
 * `VCT-2026`), no de un reloj: dos ejecuciones sobre la misma versión producen el mismo
 * spec, que es lo que permite que el render sea idempotente.
 */
export function specFromVersion(
  vRow: ContentCardVersionRow, pRow: ContentPlayerRow,
): { spec: CardSpec; ctx: ComposerCtx } {
  const card = fromVersionRow(vRow);
  const player = fromPlayerRow(pRow);
  const variant = getVariant(card.variantId as VariantId);
  const bucket = bucketForRank(variant.rank);
  const season = Number((card.dataVersion ?? "").match(/(\d{4})/)?.[1] ?? 0);

  const spec: CardSpec = {
    cardId: card.id,
    playerId: card.playerId,
    variantId: card.variantId as VariantId,
    ovr: card.ovr,
    stats: card.stats,
    family: variant.group,
    season,
    series: seriesOf(card.variantId as VariantId),
    kind: kindForFamily(variant.group),
    rarityBucket: bucket,
    tier: TIER_POR_BUCKET[bucket],
    serialized: variant.serialized,
    serialLimit: variant.serialLimit,
    decision: "new",
    decisionReason: `Definición v${vRow.version} del catálogo administrativo`,
    status: "published",
    releaseState: "approved",
    confidence: 1,
    issues: [],
    badges: [],
    narrativeTags: [],
    historicalTags: [],
    /*
     * La política de mercado la decide `decideMarket()`, que ya existe. Escribirla a mano
     * aquí sería una segunda opinión sobre si una carta va al mercado — justo lo que no toca.
     */
    eligibility: {
      packs: [], craft: { salvage: true, upgradeTargets: [] },
      market: decideMarket(variant.group, TIER_POR_BUCKET[bucket]),
    },
    artwork: resolveArtwork(player, card.variantId as VariantId),
    estimatedValue: marketValue(card),
    ruleIds: [],
  };

  const ctx: ComposerCtx = {
    nick: player.nick,
    teamSlug: player.team ? slug(player.team) : undefined,
    countryIso: player.country || undefined,
    role: player.role?.toLowerCase(),
    region: player.region?.toLowerCase(),
    generationId: `ADMIN-${card.id}-v${vRow.version}`,
  };

  return { spec, ctx };
}

const slug = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * Renderiza UNA versión. Idempotente por construcción.
 *
 * El renderizador ya trae render incremental: lee el `manifest.json` que haya en la carpeta
 * y, si la huella de la composición coincide, reutiliza en vez de rasterizar. Así que volver
 * a pulsar «Generar imagen» sobre una versión ya generada no produce ficheros nuevos ni
 * cambia los que hay — solo lo confirma.
 */
export async function renderCardVersion(
  sb: SupabaseClient, cardId: string, version: number,
): Promise<{ ok: true; data: ArtworkResult } | { ok: false; error: string; status: number }> {
  const { data: vRow } = await sb.from("content_card_versions")
    .select("*").eq("card_id", cardId).eq("version", version).maybeSingle();
  if (!vRow) return { ok: false, error: `No existe ${cardId} v${version}`, status: 404 };

  const { data: pRow } = await sb.from("content_players")
    .select("*").eq("id", (vRow as ContentCardVersionRow).player_id).maybeSingle();
  if (!pRow) {
    return { ok: false, error: `El jugador ${(vRow as ContentCardVersionRow).player_id} no está en el catálogo`, status: 409 };
  }

  const { spec, ctx } = specFromVersion(vRow as unknown as ContentCardVersionRow, pRow as unknown as ContentPlayerRow);

  const artwork = new ArtworkEngine();
  artwork.register(playerAsset(spec.playerId));
  if (ctx.teamSlug) artwork.register(teamAsset(ctx.teamSlug));
  if (ctx.countryIso) artwork.register(countryAsset(ctx.countryIso));

  const comp = composeArtwork(spec, artwork, ctx);
  const outputDir = artworkDir(cardId, version);

  /*
   * `now` es la marca de la VERSIÓN, no el reloj de la petición. Con el reloj, cada pulsación
   * cambiaría la metadata embebida y el manifest, y «idempotente» dejaría de serlo.
   */
  const now = Date.parse((vRow as ContentCardVersionRow).effective_from) || 0;
  const renderer = new ArtworkRenderer(artwork, { outputDir, now, generationId: ctx.generationId });

  const antes = renderer.snapshotStats().rendered;
  const manifest = await renderer.renderGeneration([comp], ctx.generationId!);
  const stats = renderer.snapshotStats();

  const entrada = manifest.cards[0];
  const files = (entrada?.files ?? []).map((f) => ({
    kind: f.kind, path: f.path, bytes: f.bytes,
  }));

  return {
    ok: true,
    data: {
      cardId, version, files,
      substituted: comp.layers
        .flatMap((l) => l.elements)
        .filter((e) => e.isPlaceholder).length,
      cached: stats.rendered === antes,
      fingerprint: entrada?.artworkFingerprint ?? "",
    },
  };
}

/** Qué hay generado para una versión, sin generar nada. Para pintar la ficha. */
export function artworkStatus(cardId: string, version: number): {
  generated: boolean; files: { kind: string; path: string; bytes: number }[]; fingerprint: string;
} {
  const dir = artworkDir(cardId, version);
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return { generated: false, files: [], fingerprint: "" };
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      cards?: { artworkFingerprint?: string; files?: { kind: string; path: string; bytes: number }[] }[];
    };
    const c = m.cards?.[0];
    const files = (c?.files ?? []).filter((f) => existsSync(join(dir, f.path)));
    return { generated: files.length > 0, files, fingerprint: c?.artworkFingerprint ?? "" };
  } catch {
    return { generated: false, files: [], fingerprint: "" };
  }
}
