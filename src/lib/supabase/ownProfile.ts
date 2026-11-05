/**
 * FASE 69 · el perfil PROPIO se lee por el servidor (`GET /api/game/me`), no por REST: tras 0058 `authenticated`
 * solo conserva las columnas públicas de `profiles` (ver `profileExposure.ts`). Una lectura en vuelo por usuario se
 * comparte durante 2 s entre el proveedor de auth y la comprobación de administración: abrir una pantalla sigue
 * costando UNA lectura del perfil, como antes.
 */
import type { Profile } from "./types";

let inflight: { uid: string; at: number; p: Promise<Profile | null> } | null = null;

export function fetchOwnProfile(token: string, uid: string, force = false): Promise<Profile | null> {
  const cur = inflight;
  if (!force && cur && cur.uid === uid && Date.now() - cur.at < 2_000) return cur.p;
  const p = fetch("/api/game/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as { profile?: Profile | null };
      // El token manda: si en plena transición de cuenta la fila es de otro usuario, no se pinta.
      return body.profile && body.profile.id === uid ? body.profile : null;
    })
    .catch(() => null);
  inflight = { uid, at: Date.now(), p };
  return p;
}
