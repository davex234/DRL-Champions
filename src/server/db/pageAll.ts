/**
 * LEER UNA TABLA ENTERA POR POSTGREST, SIN QUE SE CORTE EN SILENCIO (Bloque 8.4.4).
 *
 * ────────────────────────── EL PROBLEMA ──────────────────────────
 *
 * `supabase/config.toml` fija `max_rows = 1000`. PostgREST no avisa cuando lo aplica: una
 * consulta que debería devolver 6.864 filas devuelve **exactamente 1.000** y ni el cliente ni
 * el servidor ven un error. Medido contra el entorno local:
 *
 *     select card_id from content_pool_entries        →  6.864 filas en la tabla
 *     GET /rest/v1/content_pool_entries?select=card_id →  1.000 filas devueltas, 200 OK
 *
 * Eso es tolerable en una lista que se enseña; es un fallo cuando lo que se hace con las filas
 * es **sumar**. El resumen de un pool suma pesos, y de esa suma sale la cuota que el panel
 * enseña como probabilidad. Un total calculado sobre 1.000 de 1.200 entradas no es una cuota
 * aproximada: es una cifra distinta presentada como un hecho.
 *
 * ────────────────────────── POR QUÉ SE ARREGLA AHORA ──────────────────────────
 *
 * Hoy **no se puede disparar**, y conviene decirlo con precisión en vez de inflar el hallazgo:
 * la clave primaria de `content_pool_entries` es `(pool_id, card_id)`, así que un pool no puede
 * tener más entradas que cartas hay en el catálogo, y hoy hay 773. Lo mismo vale para
 * `card_mints`, que tiene como mucho una fila por carta.
 *
 * Lo que cambia con este bloque es que **el catálogo ya no es una constante**: 8.4.2 le dio a
 * un administrador un formulario para crear cartas. El día que se creen 228 más, el resumen de
 * un pool empieza a mentir y el contador de acuñación empieza a repetir números de serie, sin
 * un error, sin un aviso y sin nada que relacione la causa con el efecto. Paginar la lectura
 * cuesta un bucle y cierra la puerta antes de que alguien la cruce.
 *
 * ────────────────────────── CÓMO SE USA ──────────────────────────
 *
 * Se le pasa una función que construye la consulta acotada a un rango, y devuelve todas las
 * páginas concatenadas. `null` significa error de lectura (o tope de páginas alcanzado), igual que en el resto del servidor:
 * quien llama decide si eso es un repliegue o un fallo.
 */

/** Tamaño de página. Igual al `max_rows` de PostgREST: pedir más no traería más. */
export const PAGE_SIZE = 1000;

/**
 * Trae todas las filas de una consulta, en páginas de `PAGE_SIZE`.
 *
 * `build(desde, hasta)` tiene que devolver la MISMA consulta con `.range(desde, hasta)` y un
 * `.order(...)` estable — sin orden, dos páginas pueden traer la misma fila y perderse otra.
 *
 * El corte es por página incompleta, no por un total conocido de antemano: entre dos páginas
 * puede insertarse una fila, y confiar en un `count` leído antes daría un bucle de más.
 */
export async function pageAll<T>(
  build: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  /** Tope de seguridad: si se alcanza, es que la consulta no está acotada como se cree. */
  maxPaginas = 200,
): Promise<T[] | null> {
  const out: T[] = [];
  for (let p = 0; p < maxPaginas; p++) {
    const desde = p * PAGE_SIZE;
    const { data, error } = await build(desde, desde + PAGE_SIZE - 1);
    if (error) return null;
    const filas = data ?? [];
    out.push(...filas);
    if (filas.length < PAGE_SIZE) return out;
  }
  // COLECCIONES ILIMITADAS · tope alcanzado: lo leído NO es todo. Se responde como un error de lectura (`null`), nunca
  // como una lista completa: quien suma o decide con ella debe saber que no la tiene entera.
  return null;
}
