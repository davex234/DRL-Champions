/**
 * CONFIG — configuración del bot: token + lista blanca configurable. Seguro por defecto:
 * sin lista blanca NADIE está autorizado. Nunca guarda estado de juego.
 */
import type { BotConfig } from "./types";

export const DEFAULT_BOT_NAME = "DRL Champions";

export function makeConfig(cfg: Partial<BotConfig> & { token: string }): BotConfig {
  return {
    token: cfg.token,
    allowedUsers: [...(cfg.allowedUsers ?? [])],
    botName: cfg.botName ?? DEFAULT_BOT_NAME,
  };
}

/** Config desde variables de entorno (TELEGRAM_BOT_TOKEN · TELEGRAM_ALLOWED_USERS="1,2,3"). */
export function configFromEnv(env: Record<string, string | undefined> = process.env): BotConfig {
  return makeConfig({
    token: env.TELEGRAM_BOT_TOKEN ?? "",
    allowedUsers: (env.TELEGRAM_ALLOWED_USERS ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
    botName: env.TELEGRAM_BOT_NAME,
  });
}

/** ¿Está el usuario en la lista blanca? (lista vacía ⇒ false SIEMPRE). */
export const isAuthorized = (cfg: BotConfig, userId: number | undefined): boolean =>
  userId !== undefined && cfg.allowedUsers.includes(userId);
