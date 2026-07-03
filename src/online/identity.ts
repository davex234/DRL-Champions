/**
 * IDENTIDAD DE CLIENTE + capa de AUTENTICACIÓN (preparada) — Online Fase 1/7.
 *
 * Local-first: la auth (Supabase) es OPCIONAL e INYECTABLE (`AuthSource`), igual que el patrón
 * `UpdaterBackend`/`KVAdapter` del proyecto. Con sesión ⇒ id = `user.id` + token bearer JWT; sin
 * ella ⇒ id anónimo DETERMINISTA (LAN/local/tests). El núcleo NO importa Supabase (desacoplado).
 */
import { seedFrom } from "@/sim/rng";
import type { ClientIdentity, ClientKind } from "./types";

export interface AuthSession { id: string; name: string; token: string | null }

/** Fuente de autenticación inyectable. En web/desktop la implementa un adaptador de Supabase (`useAuth`). */
export interface AuthSource { current(): AuthSession | null }

/** Fuente anónima (por defecto): sin sesión. */
export const anonymousAuth: AuthSource = { current: () => null };

/** Adaptador de auth a partir de un usuario ya resuelto (p. ej. de `useAuth()`), sin acoplar Supabase. */
export function authFromUser(user: { id: string; name?: string; token?: string | null } | null): AuthSource {
  return { current: () => (user ? { id: user.id, name: user.name ?? "Jugador", token: user.token ?? null } : null) };
}

/** Construye la identidad de un cliente. Determinista. */
export function makeIdentity(name: string, kind: ClientKind = "player", auth: AuthSource | null = anonymousAuth): ClientIdentity {
  const s = auth?.current() ?? null;
  if (s) return { id: s.id, name: s.name || name, kind, token: s.token };
  const id = `anon-${(seedFrom(name) >>> 0).toString(36)}`;
  return { id, name, kind, token: null };
}

export function makeServerIdentity(): ClientIdentity {
  return { id: "server", name: "Servidor autoritativo", kind: "server", token: null };
}
