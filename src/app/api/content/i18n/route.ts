/**
 * `/api/content/i18n?locale=en|de|it` — público y de SOLO LECTURA: la capa opcional de traducciones del contenido
 * editable (texto español → traducción). Con el interruptor apagado, sin tabla o ante cualquier error responde una capa
 * vacía: el juego enseña entonces el español, que es el respaldo. Ver `i18n/content.ts`.
 */
import { NextResponse } from "next/server";
import { CONTENT_TRANSLATIONS_ENABLED } from "@/config/features";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { CONTENT_MAX_ENTRIES, sanitizeContentTranslations } from "@/i18n/content";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE = { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" };
const TTL_MS = 60_000;
const memo = new Map<string, { at: number; entries: Record<string, string> }>();

export async function GET(req: Request) {
  const locale = new URL(req.url).searchParams.get("locale");
  if (!isLocale(locale)) return NextResponse.json({ error: "Idioma inválido" }, { status: 400 });
  if (!CONTENT_TRANSLATIONS_ENABLED || locale === DEFAULT_LOCALE) return NextResponse.json({ locale, entries: {} }, { headers: CACHE });
  const hit = memo.get(locale);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ locale, entries: hit.entries }, { headers: CACHE });
  let entries: Record<string, string> = {};
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = sb
      ? await sb.from("content_translations").select("source, target").eq("locale", locale).limit(CONTENT_MAX_ENTRIES)
      : { data: null, error: null };
    if (!error && data) entries = sanitizeContentTranslations(Object.fromEntries(data.map((r: { source: string; target: string }) => [r.source, r.target])));
  } catch { /* sin tabla o sin base de datos: capa vacía */ }
  memo.set(locale, { at: Date.now(), entries });
  return NextResponse.json({ locale, entries }, { headers: CACHE });
}
