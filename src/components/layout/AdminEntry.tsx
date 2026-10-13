"use client";

/**
 * F58.2 · ACCESO «ADMINISTRACIÓN» DENTRO DEL JUEGO — discreto y solo para quien lo es.
 *
 * Vive junto a «Mi perfil» y «Cuenta» (desplegable de Temporada en escritorio, hoja «Menú» en móvil): es una
 * herramienta de TU cuenta, no un modo de juego. Para un jugador normal no existe: no se pinta ni deja hueco.
 *
 * Quién decide: el SERVIDOR, vía `useAdminSession` (`GET /api/admin/session` → `verifyAdmin` → `profiles.is_admin`).
 * Solo `granted` pinta; `checking` no (sin parpadeo de un acceso de admin mientras arranca la sesión) y el estado inicial
 * en servidor/hidratación es `checking` (sin desajuste). Esto es navegación, no seguridad: el panel y `/api/admin/*`
 * siguen verificando por su cuenta.
 */
import Link from "next/link";
import { useAdminSession, type AdminGate } from "@/lib/supabase/useAdminSession";
import { cn } from "@/lib/format";
import { NAV_MENU_ITEM, NAV_MENU_LABEL, NAV_MENU_ROW } from "@/design/nav";

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" />
    </svg>
  );
}

/** Clave de sesión con la ruta del juego desde la que se entró al panel («Volver al juego» regresa ahí). */
export const ADMIN_RETURN_KEY = "nx-admin-return";

/** Solo rutas internas del juego: nada de `//host`, esquemas ni el propio panel (sin redirecciones abiertas). */
export function safeReturnPath(v: string | null | undefined): string {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/admin") || /[\\\s]/.test(v) || v.length > 200) return "/";
  return v;
}

export function AdminEntry({ variant, onNavigate }: { variant: "menu" | "sheet"; onNavigate?: () => void }) {
  return <AdminEntryView gate={useAdminSession()} variant={variant} onNavigate={onNavigate} />;
}

/** La vista, separada del hook para poder probarla con cada estado (anónimo, usuario, comprobando, admin). */
export function AdminEntryView({ gate, variant, onNavigate }: { gate: AdminGate; variant: "menu" | "sheet"; onNavigate?: () => void }) {
  if (gate !== "granted") return null;
  const remember = () => {
    try { sessionStorage.setItem(ADMIN_RETURN_KEY, safeReturnPath(location.pathname + location.search)); } catch { /* sin almacenamiento: vuelve al lobby */ }
    onNavigate?.();
  };

  if (variant === "menu") {
    return (
      <div className="mt-1 border-t border-white/[0.08] pt-1" data-testid="admin-entry">
        {/* Navegación global limpia (2026-10-07): solo el nombre, centrado; el escudo y el dorado lo siguen distinguiendo. */}
        <Link href="/admin" onClick={remember} className={cn("nx-clip-sm nx-focus transition-colors duration-fast hover:bg-white/[0.07]", NAV_MENU_ITEM, NAV_MENU_ROW)}>
          <ShieldIcon className="h-4 w-4 shrink-0 text-drl-gold" />
          <b className={cn(NAV_MENU_LABEL, "text-[16px] tracking-[0.04em] text-drl-gold")}>Administración</b>
        </Link>
      </div>
    );
  }

  return (
    <section className="mt-5" data-testid="admin-entry">
      <p className="nx-label mb-1.5">Herramientas internas</p>
      <Link href="/admin" onClick={remember}
        className={cn("nx-clip-sm nx-focus min-h-[48px] border border-drl-gold/25 bg-drl-gold/[0.05] active:bg-drl-gold/[0.12]", NAV_MENU_ITEM)}>
        <ShieldIcon className="h-5 w-5 shrink-0 text-drl-gold" />
        <b className={cn(NAV_MENU_LABEL, "text-[17px] tracking-[0.04em] text-drl-gold")}>Administración</b>
      </Link>
    </section>
  );
}
