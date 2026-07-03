/**
 * PROTOCOLO — versión del protocolo online + negociación de compatibilidad (Online Fase 1/7).
 *
 * El protocolo se versiona SEPARADO de la versión de la app (`@/platform/version`): dos builds
 * distintas pueden hablar el mismo protocolo. El handshake intercambia protocolo + build y
 * RECHAZA versiones incompatibles (seguridad). Reutiliza `APP_VERSION` solo como sello de build.
 */
import { APP_VERSION, FULL_VERSION } from "@/platform/version";

/** Versión del protocolo de red. Se incrementa SOLO ante cambios incompatibles del wire. */
export const PROTOCOL_VERSION = 1;

/** Rango de protocolos que este cliente/servidor acepta (compat hacia atrás preparada). */
export const MIN_COMPATIBLE_PROTOCOL = 1;

export interface Handshake {
  protocol: number;
  minProtocol: number;
  build: string;        // FULL_VERSION (sello de build)
  appVersion: string;   // APP_VERSION
  kind: string;         // ClientKind
  name: string;
}

/** Construye el handshake local. */
export function localHandshake(kind: string, name: string): Handshake {
  return { protocol: PROTOCOL_VERSION, minProtocol: MIN_COMPATIBLE_PROTOCOL, build: FULL_VERSION, appVersion: APP_VERSION, kind, name };
}

/** ¿Son compatibles dos extremos? Determinista, sin efectos. */
export function isProtocolCompatible(a: Handshake, b: Handshake): boolean {
  // Cada extremo debe aceptar la versión del otro dentro de su ventana [min, current].
  const aOk = b.protocol >= a.minProtocol && b.protocol <= a.protocol;
  const bOk = a.protocol >= b.minProtocol && a.protocol <= b.protocol;
  return aOk && bOk;
}

/** Razón de rechazo (para el paquete `reject`). null = compatible. */
export function incompatibilityReason(local: Handshake, remote: Handshake): string | null {
  if (isProtocolCompatible(local, remote)) return null;
  return `Protocolo incompatible: local v${local.protocol} (min ${local.minProtocol}) vs remoto v${remote.protocol} (min ${remote.minProtocol}).`;
}
