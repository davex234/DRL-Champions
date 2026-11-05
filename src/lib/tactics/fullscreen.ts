/**
 * PANTALLA COMPLETA — la API del navegador, con su plan B.
 *
 * ────────────────────────── POR QUÉ NO ES `width: 100%` ──────────────────────────
 *
 * El encargo es explícito: pantalla completa DE VERDAD, no un `div` estirado. La diferencia importa
 * porque el caso de uso es poner NEXUS en una TV delante del equipo: con la API real desaparecen la
 * barra del navegador, las pestañas y la barra de tareas; con CSS, no.
 *
 * Pero la API falla en sitios reales y por motivos legítimos: iOS Safari no la implementa en
 * elementos arbitrarios, un `iframe` sin `allowfullscreen` la rechaza, y una política de permisos
 * puede bloquearla. Por eso hay un modo FOCUS: la misma pantalla ocupando el viewport entero con
 * `position: fixed`, que no es igual de bueno pero nunca deja al entrenador sin pizarra.
 *
 * Puro y sin React: se puede probar sin montar nada.
 */

export type FullscreenMode = "native" | "focus" | "off";

interface FullscreenCapableElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface FullscreenCapableDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

/** ¿Puede este navegador poner a pantalla completa un elemento cualquiera? */
export function canGoNativeFullscreen(doc: Document = document): boolean {
  const d = doc as FullscreenCapableDocument;
  // `fullscreenEnabled` es `false` cuando una política o un iframe lo prohíben: ahí no se intenta.
  return Boolean(d.fullscreenEnabled ?? (d as unknown as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);
}

/** El elemento que está a pantalla completa ahora mismo, si lo hay. */
export function currentFullscreenElement(doc: Document = document): Element | null {
  const d = doc as FullscreenCapableDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

/**
 * Entra a pantalla completa y dice CÓMO lo consiguió. Nunca lanza: si la API no está o la rechaza,
 * devuelve `"focus"` para que quien llama pinte el modo de respaldo.
 */
export async function enterFullscreen(el: HTMLElement | null): Promise<FullscreenMode> {
  if (!el) return "focus";
  if (!canGoNativeFullscreen(el.ownerDocument)) return "focus";
  const target = el as FullscreenCapableElement;
  try {
    if (target.requestFullscreen) await target.requestFullscreen();
    else if (target.webkitRequestFullscreen) await target.webkitRequestFullscreen();
    else return "focus";
    return "native";
  } catch {
    /*
     * Se ha llegado a pedir y el navegador ha dicho que no —lo más habitual: la llamada no venía de
     * un gesto del usuario—. No es un error del que informar: es un caso previsto.
     */
    return "focus";
  }
}

/** Sale de pantalla completa si estábamos en ella. Silencioso a propósito. */
export async function exitFullscreen(doc: Document = document): Promise<void> {
  const d = doc as FullscreenCapableDocument;
  if (!currentFullscreenElement(doc)) return;
  try {
    if (d.exitFullscreen) await d.exitFullscreen();
    else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
  } catch { /* si ya se ha salido (Escape), no hay nada que hacer */ }
}
