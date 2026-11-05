/**
 * RELOJ INYECTABLE + PARSEO ISO PURO (Data Import Engine · Fase 1/7).
 *
 * El importer es 100% determinista: NADA de `Date.now`, `new Date` ni `Math.random`. El instante
 * lógico se inyecta (`now`) y las fechas ISO se parsean con un algoritmo ARITMÉTICO puro
 * (Howard Hinnant `days_from_civil`), independiente de zona horaria y locale. Mismo string ⇒ mismo
 * epoch, siempre, en cualquier máquina.
 */

/** Días desde 1970-01-01 para una fecha civil (proléptico gregoriano). Puro. m ∈ 1..12. */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = y - (m <= 2 ? 1 : 0);
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Parseo ISO-8601 PURO → epoch ms (UTC). Sin `new Date`. Devuelve `undefined` si el string no es una
 * fecha válida. Soporta `YYYY-MM-DD`, `YYYY-MM-DDThh:mm[:ss[.mmm]]`, sufijo `Z` u offset `±hh:mm`.
 */
export function parseIso(iso?: string): number | undefined {
  if (!iso) return undefined;
  const m = ISO_RE.exec(iso.trim());
  if (!m) return undefined;
  const [, ys, mos, ds, hs, mins, ss, ms, tz] = m;
  const year = +ys, month = +mos, day = +ds;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const hh = hs ? +hs : 0, mm = mins ? +mins : 0, sec = ss ? +ss : 0;
  const milli = ms ? +ms.padEnd(3, "0") : 0;
  if (hh > 23 || mm > 59 || sec > 59) return undefined;
  let offsetMin = 0;
  if (tz && tz !== "Z") {
    const sign = tz[0] === "-" ? -1 : 1;
    const clean = tz.slice(1).replace(":", "");
    offsetMin = sign * (+clean.slice(0, 2) * 60 + +clean.slice(2, 4));
  }
  const days = daysFromCivil(year, month, day);
  return (days * 86400 + hh * 3600 + mm * 60 + sec) * 1000 + milli - offsetMin * 60000;
}

/** Reloj lógico inyectable. `now` es un instante fijo; `parseIso` es puro por defecto. */
export interface ImportClock {
  readonly now: number;
  readonly parseIso: (iso?: string) => number | undefined;
}

/** Construye un reloj determinista. `now` DEBE inyectarse (nunca `Date.now`). */
export function makeClock(now: number, iso: (s?: string) => number | undefined = parseIso): ImportClock {
  return { now, parseIso: iso };
}
