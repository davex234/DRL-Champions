import type { EngineNotification, NotificationCode, LogLevel } from "./types";

let seq = 0;

export function makeNotification(code: NotificationCode, level: LogLevel, message: string): EngineNotification {
  seq += 1;
  return { id: `ntf_${seq}_${Math.floor(Math.random() * 1e4).toString(36)}`, at: Date.now(), code, level, message, sentTelegram: false };
}

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TELEGRAM_WEBHOOK);
}

/**
 * Envía el mensaje a Telegram a través de un WEBHOOK propio
 * (`NEXT_PUBLIC_TELEGRAM_WEBHOOK`), nunca exponiendo el token del bot en el
 * cliente. Si no está configurado, no envía (se registra igualmente en la app).
 */
export async function dispatchTelegram(message: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_TELEGRAM_WEBHOOK;
  if (!url) return false;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `🃏 DRL Data Engine\n${message}` }),
    });
    return true;
  } catch {
    return false;
  }
}
