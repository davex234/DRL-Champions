/**
 * CLIENTE VLR — la ÚNICA capa con red del conector.
 *
 * Resuelve la URL de entrada (cualquier forma de /event/...) a `VlrEventRef`, construye las URLs
 * canónicas y expone `createHttpFetcher()` (fetch global + User-Agent explícito). Todo lo demás
 * del conector es puro; en tests se inyecta un `VlrFetcher` de fixtures y esta capa no se toca.
 */
import type { VlrEventRef, VlrFetcher } from "./types";

export const VLR_BASE = "https://www.vlr.gg";

/**
 * Extrae `{eventId, slug}` de cualquier URL de torneo de VLR:
 * /event/2765/slug · /event/stats/2765/slug · /event/matches/2765 · con o sin query/esquema.
 * Devuelve `undefined` si la URL no apunta a un torneo de VLR (estado imposible rechazado).
 */
export function parseVlrUrl(url: string): VlrEventRef | undefined {
  const m = /(?:^|\/\/|\.)vlr\.gg\/event(?:\/[a-z-]+)?\/(\d+)(?:\/([a-z0-9-]+))?/i.exec(url.trim());
  if (!m) return undefined;
  return { eventId: m[1], slug: m[2] || undefined };
}

/** URLs canónicas de las tres páginas del evento. */
export function eventUrls(ref: VlrEventRef): { overview: string; stats: string; matches: string } {
  const tail = ref.slug ? `/${ref.slug}` : "";
  return {
    overview: `${VLR_BASE}/event/${ref.eventId}${tail}`,
    stats: `${VLR_BASE}/event/stats/${ref.eventId}${tail}`,
    matches: `${VLR_BASE}/event/matches/${ref.eventId}${tail}/?series_id=all`,
  };
}

/** URL absoluta de una página de partido desde su ruta relativa ("/378662/..."). */
export function matchUrl(path: string): string {
  return path.startsWith("http") ? path : `${VLR_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Fetcher HTTP real (un reintento ante fallo transitorio). Solo se usa fuera de tests/CI. */
export function createHttpFetcher(): VlrFetcher {
  const get = async (url: string): Promise<string> => {
    const res = await fetch(url, {
      headers: {
        "user-agent": "DRLChampions-Importer/1.0 (+tournament data import)",
        accept: "text/html",
      },
    });
    if (!res.ok) throw new Error(`VLR HTTP ${res.status} — ${url}`);
    return await res.text();
  };
  return async (url: string): Promise<string> => {
    try {
      return await get(url);
    } catch {
      await new Promise((r) => setTimeout(r, 750));
      return await get(url);
    }
  };
}
