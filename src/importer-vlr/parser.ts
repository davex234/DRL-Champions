/**
 * PRIMITIVAS DE PARSING — utilidades PURAS string→dato para el HTML de vlr.gg.
 *
 * Sin DOM, sin dependencias: regex + slicing deterministas. Todo lo que devuelve `undefined`
 * significa "el dato no está en la página", nunca un estado inventado (cero estados imposibles:
 * los números inválidos se descartan, no se propagan como NaN).
 */

/** Decodifica las entidades HTML que usa vlr.gg. Puro. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(+d));
}

/** Texto plano de un fragmento HTML (sin tags, espacios colapsados). Puro. */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Todas las capturas de una regex global. Puro. */
export function findAll(re: RegExp, s: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(s)) !== null) { out.push(m); if (m.index === g.lastIndex) g.lastIndex++; }
  return out;
}

/** Fragmento entre `start` (primera aparición desde `from`) y `end`. `undefined` si no está. */
export function sliceBetween(s: string, start: string, end: string, from = 0): string | undefined {
  const i = s.indexOf(start, from);
  if (i < 0) return undefined;
  const j = s.indexOf(end, i + start.length);
  return j < 0 ? undefined : s.slice(i + start.length, j);
}

/** Número finito o `undefined` (nunca NaN). Tolera "%", "$", "," y espacios. */
export function num(s: string | undefined | null): number | undefined {
  if (s == null) return undefined;
  const cleaned = s.replace(/[,%$\s]/g, "");
  if (!/^[+-]?\d*\.?\d+$/.test(cleaned)) return undefined;
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? v : undefined;
}

/** Código de país ("KR") desde una clase de flag de VLR ("flag mod-kr"). */
export function flagCountry(cls: string | undefined): string | undefined {
  const m = /(?:^|\s)mod-([a-z]{2})(?:\s|$)/.exec(cls ?? "");
  return m ? m[1].toUpperCase() : undefined;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Rango de fechas de VLR → ISO. Formatos reales: "Aug 1–25, 2024", "Jun 30 – Jul 13, 2025",
 * "Aug 1, 2024" (un día). Guion ASCII o en-dash. Devuelve fechas `YYYY-MM-DD`.
 */
export function parseVlrDates(text: string | undefined): { start?: string; end?: string } {
  if (!text) return {};
  const yearMatch = /(\d{4})/.exec(text);
  if (!yearMatch) return {};
  const year = +yearMatch[1];
  const body = text.replace(/,?\s*\d{4}/, "");
  const parts = body.split(/[–—-]/).map((p) => p.trim()).filter(Boolean);
  const parsePart = (part: string, inheritMonth?: number): { m: number; d: number } | undefined => {
    const withMonth = /^([A-Za-z]{3,})\.?\s+(\d{1,2})$/.exec(part);
    if (withMonth) {
      const m = MONTHS[withMonth[1].slice(0, 3).toLowerCase()];
      return m ? { m, d: +withMonth[2] } : undefined;
    }
    const dayOnly = /^(\d{1,2})$/.exec(part);
    if (dayOnly && inheritMonth) return { m: inheritMonth, d: +dayOnly[1] };
    return undefined;
  };
  const a = parts.length > 0 ? parsePart(parts[0]) : undefined;
  const b = parts.length > 1 ? parsePart(parts[1], a?.m) : undefined;
  const iso = (p: { m: number; d: number } | undefined): string | undefined =>
    p && p.d >= 1 && p.d <= 31 ? `${year}-${pad2(p.m)}-${pad2(p.d)}` : undefined;
  return { start: iso(a), end: iso(b ?? a) };
}

/** Timestamp UTC de VLR ("2024-08-01 04:00:00") → ISO-8601 con Z. */
export function utcTsToIso(ts: string | undefined): string | undefined {
  if (!ts) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(ts.trim());
  return m ? `${m[1]}T${m[2].length === 5 ? m[2] + ":00" : m[2]}Z` : undefined;
}

/** Clave laxa para comparar nombres de equipo entre páginas (misma idea que normalizeKey). */
export function looseName(s: string | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}
