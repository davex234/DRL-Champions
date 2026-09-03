/**
 * FORMATTER — renderizado POR CANAL: telegram (MarkdownV2 reutilizando el escapado OFICIAL
 * del Telegram Control, congelado), discord (markdown simple) y consola (texto plano).
 * Puro: mismo mensaje ⇒ mismos bytes.
 */
import { esc, b } from "@/telegram-control";
import type { RenderedTemplate } from "./templates";

export function renderForChannel(channelId: string, t: RenderedTemplate): string {
  const [head, ...rest] = t.body.split("\n");
  if (channelId === "telegram") {
    return `🏆 ${b(head)}\n${rest.map((l) => esc(l)).join("\n")}`;
  }
  if (channelId === "discord") {
    return `**${head}**\n${rest.join("\n")}`;
  }
  return `[${t.title}] ${t.body.replace(/\n/g, " · ")}`;
}
