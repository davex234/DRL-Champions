/**
 * LAYOUT DE `/admin/*` — un solo sitio donde se decide quién entra (V-1).
 *
 * Antes cada página repetía `if (!ADMIN_ENABLED) return <Acceso restringido/>`. Diez copias
 * de una comprobación que no comprobaba nada: `ADMIN_ENABLED` lee `NEXT_PUBLIC_ADMIN`, una
 * variable pública del bundle. Diez copias también significan que la página número once
 * nace desprotegida por olvido — y en este árbol ya hay once rutas.
 *
 * Ahora la decisión vive aquí y solo aquí, y la toma el servidor (`AdminGuard` →
 * `GET /api/admin/session` → `verifyAdmin` → `profiles.is_admin`). Cualquier página nueva
 * bajo `/admin/` queda protegida por el hecho de estar ahí.
 *
 * ────────────────────────── QUÉ PASA CON `ADMIN_ENABLED` ──────────────────────────
 *
 * Se conserva, pero **degradado a lo que siempre debió ser**: un interruptor de despliegue,
 * no una comprobación de acceso. Sigue apagando el panel entero allí donde no debe existir
 * —el comportamiento en producción no cambia: sin `NEXT_PUBLIC_ADMIN=1` no hay panel para
 * nadie—, y ahora, cuando está encendido, ya no abre la puerta: solo deja llegar hasta la
 * puerta. Quien decide es el servidor.
 *
 * El cambio real de comportamiento está en desarrollo: antes cualquiera abría `/admin`
 * porque `NODE_ENV !== "production"`; ahora hace falta una cuenta con `profiles.is_admin`.
 * Es más estricto a propósito — el panel deja de ser una puerta abierta por comodidad.
 *
 * `noindex` no es seguridad, pero es higiene: una pantalla de administración no tiene por
 * qué acabar en un índice de búsqueda.
 */
import type { Metadata } from "next";
import { AdminGuard } from "@/components/layout/AdminGuard";
import { AdminShell } from "@/components/admin/cc/AdminShell";
import { ADMIN_ENABLED } from "@/config/admin";
import { AdminDisabled } from "@/components/admin/cc/AdminDisabled";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!ADMIN_ENABLED) return <AdminDisabled />;
  // F58 · el armazón del Control Center se pinta SOLO tras la confirmación del servidor (AdminGuard).
  return <AdminGuard><AdminShell>{children}</AdminShell></AdminGuard>;
}
