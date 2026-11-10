/**
 * AVATARES DEL PERFIL (Fase 31). El avatar de NEXUS es un EMOJI de un conjunto cerrado, no una
 * URL: nunca se pinta como `<img>`, así que no hay `javascript:`, `data:` ni SSRF posibles. Esta
 * lista es la misma que ya ofrecía `/cuenta`; aquí se centraliza para que el servidor pueda
 * validarla y el perfil público pueda sanear lo que haya en la base de datos.
 */
export const AVATARS = ["🎮", "🦅", "🐉", "🔥", "👑", "⚡", "🎯", "🦊", "🐺", "🌟", "💎", "🃏"] as const;

export type AvatarId = (typeof AVATARS)[number];

export const DEFAULT_AVATAR: AvatarId = "🎮";

export const isAllowedAvatar = (a: unknown): a is AvatarId => typeof a === "string" && (AVATARS as readonly string[]).includes(a);

/**
 * Lo que se enseña de un avatar guardado. La base de datos permite escribir cualquier texto en
 * `profiles.avatar` (grant de columna de la Fase 9), así que el perfil público no se fía: fuera
 * del conjunto cerrado se sirve el avatar por defecto.
 */
export const safeAvatar = (a: string | null | undefined): string => (isAllowedAvatar(a) ? a : DEFAULT_AVATAR);
