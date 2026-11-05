/**
 * LEER TODAS LAS FILAS DE UNA CONSULTA, POR CURSOR, O FALLAR (colecciones ilimitadas).
 *
 * ────────────────────────── EL PROBLEMA ──────────────────────────
 *
 * PostgREST corta cada respuesta en `max_rows` (1.000 en `supabase/config.toml`) y NO avisa: una consulta que debería
 * devolver 1.125 cartas devuelve 1.000 con un 200. El estado de juego leía `user_cards` de una vez, así que una cuenta
 * con más de 1.000 cartas veía —y el motor de sobres, el desguace y las misiones decidían sobre— un subconjunto
 * arbitrario de su colección.
 *
 * ────────────────────────── LA REGLA ──────────────────────────
 *
 *   · Se pagina por CLAVE (`uid > último`), no por desplazamiento: una carta insertada o borrada mientras se lee no
 *     desplaza las páginas siguientes, así que ninguna fila se repite ni se salta.
 *   · No hay tope de páginas. El bucle termina cuando la base dice que no queda nada, no cuando se cansa.
 *   · Un error en cualquier página lanza `IncompleteReadError`. NUNCA se devuelve una lectura parcial como si fuera
 *     completa: quien llama decide con todo o no decide.
 *   · El tamaño real de página lo dicta el servidor. La primera página pide además el recuento exacto: si llegan menos
 *     filas de las pedidas y aun así quedan más, el servidor tiene un `max_rows` menor y se adopta ese tamaño. Así una
 *     página «corta» nunca se confunde con la última.
 */

/** Lo que devuelve una consulta de supabase-js con `{ count: "exact" }`. */
export interface KeysetPage<T> { data: T[] | null; error: { message?: string; code?: string } | null; count?: number | null }

export class IncompleteReadError extends Error {
  readonly code?: string;
  constructor(what: string, cause?: { message?: string; code?: string } | null) {
    super(`lectura incompleta de ${what}${cause?.message ? `: ${cause.message}` : ""}`);
    this.name = "IncompleteReadError";
    this.code = cause?.code;
  }
}

/** Tamaño de página pedido. Igual al `max_rows` de PostgREST: pedir más no traería más. */
export const KEYSET_PAGE = 1000;

export interface KeysetOptions<T> {
  /** Nombre para el mensaje de error. */
  what: string;
  /** Construye la página: filas con clave > `after` (o desde el principio), en orden ascendente de clave, `limit` filas. */
  page: (after: string | null, limit: number, withCount: boolean) => PromiseLike<KeysetPage<T>>;
  /** Clave de orden de una fila (única y estable). */
  key: (row: T) => string;
  /** Se llama con cada página, en orden. Para agregar sin retener todas las filas. */
  onPage: (rows: T[]) => void;
  pageSize?: number;
}

/** Recorre TODAS las filas por cursor. Devuelve cuántas leyó y cuántas consultas hizo. Lanza si alguna página falla. */
export async function keysetEach<T>(o: KeysetOptions<T>): Promise<{ rows: number; queries: number }> {
  let size = o.pageSize ?? KEYSET_PAGE;
  let after: string | null = null;
  let rows = 0, queries = 0;
  for (;;) {
    const first = queries === 0;
    const res = await o.page(after, size, first);
    queries++;
    if (res.error) throw new IncompleteReadError(o.what, res.error);
    const page = res.data ?? [];
    if (page.length === 0) return { rows, queries };
    o.onPage(page);
    rows += page.length;
    const last = o.key(page[page.length - 1]);
    if (after !== null && !(last > after)) throw new IncompleteReadError(o.what, { message: "el cursor no avanza (orden inestable)" });
    after = last;
    if (first) {
      // ¿Todo cupo en la primera página? Con recuento exacto se sabe sin otra consulta.
      if (typeof res.count === "number" && page.length >= res.count) return { rows, queries };
      // Página más corta de lo pedido y aún quedan filas: el servidor recorta. Ese es el tamaño real.
      if (page.length < size) size = page.length;
    } else if (page.length < size) {
      return { rows, queries };
    }
  }
}

/** Como `keysetEach`, devolviendo todas las filas. Para lecturas que de verdad necesitan cada fila en memoria. */
export async function keysetAll<T>(o: Omit<KeysetOptions<T>, "onPage">): Promise<T[]> {
  const out: T[] = [];
  await keysetEach<T>({ ...o, onPage: (rows) => { for (const r of rows) out.push(r); } });
  return out;
}

/** Trocea una lista para filtros `in(...)`: una URL de PostgREST con cientos de UUID deja de caber en la pasarela. */
export function chunked<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
