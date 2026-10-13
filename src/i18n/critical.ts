/**
 * I18N · OPERACIONES CRÍTICAS (puro: lo pueden usar la lógica de compra y los componentes).
 *
 * Mientras hay una operación crítica abierta (compra de un sobre, apertura con su cinemática), un cambio de idioma NO
 * se aplica: queda pendiente y se aplica al cerrarse la última. Cambiar de idioma nunca repite ni cancela una petición;
 * esto solo evita que los textos cambien bajo una animación o un diálogo de compra a medias.
 */
const G = globalThis as unknown as { __vrI18nCritical?: { count: number; onIdle: (() => void) | null } };
const C = (G.__vrI18nCritical ??= { count: 0, onIdle: null });

export function isCriticalOperationActive(): boolean {
  return C.count > 0;
}

/** Abre una operación crítica y devuelve la función que la cierra (idempotente). */
export function beginCriticalOperation(): () => void {
  C.count++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    C.count = Math.max(0, C.count - 1);
    if (C.count === 0) C.onIdle?.();
  };
}

/** Envuelve una promesa como operación crítica. */
export async function withCriticalOperation<T>(run: () => Promise<T>): Promise<T> {
  const end = beginCriticalOperation();
  try { return await run(); } finally { end(); }
}

/** Lo registra el proveedor: qué hacer cuando ya no queda ninguna operación crítica. */
export function onCriticalIdle(listener: (() => void) | null): void {
  C.onIdle = listener;
}

/** Solo para tests. */
export function __resetCriticalForTests(): void {
  C.count = 0;
  C.onIdle = null;
}
