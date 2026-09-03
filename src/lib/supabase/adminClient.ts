"use client";

/**
 * Cliente de las rutas /api/admin/* desde el navegador.
 *
 * SEC-03: las rutas admin exigen `Authorization: Bearer <access_token>` de Supabase Auth
 * y comprueban `profiles.is_admin` en el servidor. Este módulo es el único sitio donde el
 * panel obtiene ese token, para que ninguna llamada se quede sin cabecera por descuido.
 */
import { getSupabase } from "./client";

/** Cabecera de autorización con la sesión actual, o `null` si no hay sesión. */
export async function adminAuthHeader(): Promise<Record<string, string> | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : null;
}

/** `fetch` a una ruta admin con el token de sesión ya puesto. Lanza si no hay sesión. */
export async function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const h = await adminAuthHeader();
  if (!h) throw new Error("Inicia sesión como administrador");
  return fetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), ...h } });
}

/**
 * Descarga un artefacto protegido.
 *
 * Un `<a href>` no puede llevar cabecera `Authorization`, así que los enlaces directos
 * dejarían de funcionar al cerrar la ruta. Se descarga con `fetch` autenticado y se
 * entrega al navegador mediante un object URL.
 */
export async function adminDownload(url: string, filename: string): Promise<void> {
  const res = await adminFetch(url, { cache: "no-store" });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((msg as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
