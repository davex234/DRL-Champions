/**
 * PLATFORM — CANALES de actualización (ramas) estilo Riot/Steam.
 *
 * Stable / Beta / Developer / Nightly. El canal se persiste vía el adaptador KV y se
 * envía al servidor de updates como cabecera `X-DRL-Channel`, de modo que un único
 * endpoint (`update.drlchampions.com/latest.json`) sirve el manifiesto correcto por rama
 * (el updater oficial de Tauri no tiene variable {{channel}}; la cabecera es el mecanismo
 * canónico y no rompe el formato estático del manifiesto).
 */
import { getAdapter } from "./store";

export type Channel = "stable" | "beta" | "developer" | "nightly";

export interface ChannelInfo {
  id: Channel;
  label: string;
  desc: string;
  /** Nivel de riesgo 0..3 (UI: color del badge). */
  risk: 0 | 1 | 2 | 3;
}

export const CHANNELS: ChannelInfo[] = [
  { id: "stable", label: "Estable", desc: "Versiones pulidas y recomendadas para todos.", risk: 0 },
  { id: "beta", label: "Beta", desc: "Novedades antes de tiempo, razonablemente probadas.", risk: 1 },
  { id: "developer", label: "Developer", desc: "Builds de desarrollo; pueden contener bugs.", risk: 2 },
  { id: "nightly", label: "Nightly", desc: "Compilación diaria automática; inestable.", risk: 3 },
];

export const DEFAULT_CHANNEL: Channel = "stable";
const KEY = "channel";

export function isChannel(v: unknown): v is Channel {
  return v === "stable" || v === "beta" || v === "developer" || v === "nightly";
}

export function channelInfo(c: Channel): ChannelInfo {
  return CHANNELS.find((x) => x.id === c) ?? CHANNELS[0];
}

/** Cabeceras HTTP que el updater envía para seleccionar la rama en el servidor. */
export function channelHeaders(c: Channel): Record<string, string> {
  return { "X-DRL-Channel": c };
}

export async function loadChannel(): Promise<Channel> {
  try {
    const raw = await getAdapter().get(KEY);
    return isChannel(raw) ? raw : DEFAULT_CHANNEL;
  } catch {
    return DEFAULT_CHANNEL;
  }
}

export async function saveChannel(c: Channel): Promise<Channel> {
  if (!isChannel(c)) c = DEFAULT_CHANNEL;
  await getAdapter().set(KEY, c);
  return c;
}
