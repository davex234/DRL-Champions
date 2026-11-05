/**
 * Supabase visto DESDE EL SERVIDOR (valorosters.com).
 *
 * `NEXT_PUBLIC_SUPABASE_URL` es el origen PÚBLICO (el navegador del jugador no pasa por el túnel SSH): con él se crean
 * los clientes, así que las URL que el servidor genera para el navegador (`getPublicUrl`, fotos de Storage) salen
 * públicas. Pero el TRÁFICO del servidor no debe dar la vuelta por Cloudflare hasta sí mismo: si existe
 * `SUPABASE_INTERNAL_URL` (p. ej. el túnel SSH local `http://127.0.0.1:54521`), cada petición al origen público se
 * reescribe hacia él. Sin esa variable todo queda exactamente como antes. Solo servidor: nunca `NEXT_PUBLIC_`.
 */
const origin = (raw: string | undefined): string | undefined => {
  const t = raw?.trim();
  if (!t) return undefined;
  try { return new URL(t).origin; } catch { return t.replace(/\/+$/, ""); }
};

/** Origen al que habla el servidor: el interno si está configurado, si no el público. */
export function serverSupabaseOrigin(env: Record<string, string | undefined> = process.env): string | undefined {
  return origin(env.SUPABASE_INTERNAL_URL) ?? origin(env.NEXT_PUBLIC_SUPABASE_URL);
}

/** Reescribe una URL del origen público al interno (si procede). Pura: se prueba sin red. */
export function toInternalUrl(url: string, env: Record<string, string | undefined> = process.env): string {
  const pub = origin(env.NEXT_PUBLIC_SUPABASE_URL), internal = origin(env.SUPABASE_INTERNAL_URL);
  if (!pub || !internal || pub === internal) return url;
  return url.startsWith(pub + "/") || url === pub ? internal + url.slice(pub.length) : url;
}

/** `fetch` para los clientes de supabase-js del servidor (`global.fetch`). */
export const serverSupabaseFetch: typeof fetch = (input, init) => {
  if (typeof input === "string") return fetch(toInternalUrl(input), init);
  if (input instanceof URL) return fetch(toInternalUrl(input.toString()), init);
  const next = toInternalUrl(input.url);
  return fetch(next === input.url ? input : new Request(next, input), init);
};
