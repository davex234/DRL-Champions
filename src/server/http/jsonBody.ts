/**
 * FULL GAME AUDIT (2026-10-07) · EL CUERPO JSON DE UNA PETICIÓN, SOLO SI ES UN OBJETO.
 *
 * `await req.json()` devuelve lo que venga: `null`, una cadena, un número o un array son JSON válido. Las rutas hacían
 * `body.action` sobre eso y un `null` lanzaba TypeError → 500 (reproducido en producción en 12 rutas). Aquí: el objeto,
 * o `null` si el cuerpo falta, no es JSON o no es un objeto. Cada ruta decide qué responde (normalmente su 400 de
 * siempre para una acción desconocida).
 */
export async function readJsonObject<T extends object = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    const v: unknown = await req.json();
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as T) : null;
  } catch {
    return null;
  }
}
