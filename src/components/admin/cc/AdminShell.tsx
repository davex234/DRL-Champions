"use client";

/**
 * F58 · ARMAZÓN DEL CONTROL CENTER — otra aplicación dentro del producto: barra lateral persistente, cabecera con
 * búsqueda global (Ctrl/Cmd+K), admin actual y estado del sistema (de `/api/admin/system`, no decorativo).
 *
 * Solo se monta DESPUÉS de `AdminGuard` (layout): si el servidor no confirma `is_admin`, nada de esto se pinta.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ADMIN_SECTIONS, PALETTE_ACTIONS, sectionFor } from "@/domain/admin/nav";
import { useAuth } from "@/lib/supabase/auth";
import { cn } from "@/lib/format";
import { useAdminQuery, useDebounced } from "./api";
import { LevelBadge, type Level } from "./ui";
import { ADMIN_RETURN_KEY, safeReturnPath } from "@/components/layout/AdminEntry";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("admin");

interface SearchHit { group: string; id: string; label: string; sub: string; href: string }

export function AdminShell({ children }: { children: ReactNode }) {
  useLocale();
  const pathname = usePathname() ?? "/admin";
  const active = sectionFor(pathname);
  const [palette, setPalette] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const { user } = useAuth();
  const system = useAdminQuery<{ overall: Level; environment: string; version: string }>("/api/admin/system");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { setMobileNav(false); }, [pathname]);
  // F58.2 · «Volver al juego» regresa a la pantalla del juego desde la que se entró (validada), o al lobby.
  const [gameHref, setGameHref] = useState("/");
  useEffect(() => { try { setGameHref(safeReturnPath(sessionStorage.getItem(ADMIN_RETURN_KEY))); } catch { /* lobby */ } }, []);

  const groups = useMemo(() => {
    const m = new Map<string, typeof ADMIN_SECTIONS[number][]>();
    for (const s of ADMIN_SECTIONS) m.set(s.group, [...(m.get(s.group) ?? []), s]);
    return [...m.entries()];
  }, []);

  const nav = (
    <nav aria-label={tr("Secciones del panel")} className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4">
      {groups.map(([g, items]) => (
        <div key={g}>
          <p className="px-2 pb-1.5 font-display text-[10px] font-bold uppercase tracking-[0.24em] text-ink-faint">{td(g)}</p>
          <ul className="space-y-0.5">
            {items.map((s) => {
              const on = active?.id === s.id;
              return (
                <li key={s.id}>
                  <Link href={s.href} aria-current={on ? "page" : undefined}
                    className={cn("nx-focus group flex items-center gap-2.5 rounded-control px-2.5 py-2 text-[13px] font-medium transition",
                      on ? "bg-gradient-to-r from-drl/20 to-transparent text-ink-primary shadow-[inset_2px_0_0_#ff2e63]" : "text-ink-muted hover:bg-white/[0.04] hover:text-ink-primary")}>
                    <span aria-hidden className={cn("grid h-6 w-6 place-items-center rounded-[6px] text-[13px]", on ? "bg-drl/25 text-drl-glow" : "bg-white/[0.04] text-ink-faint group-hover:text-ink-secondary")}>{s.icon}</span>
                    {td(s.label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <Link href={gameHref} className="nx-focus mt-auto rounded-control border border-white/10 px-3 py-2 text-center text-[12px] text-ink-faint hover:text-ink-secondary">{tr("← Volver al juego")}</Link>
    </nav>
  );

  return (
    <div data-shell="admin" className="min-h-screen bg-surface-canvas text-ink-secondary [background-image:radial-gradient(1200px_600px_at_80%_-10%,rgba(25,227,255,0.06),transparent),radial-gradient(900px_500px_at_-10%_10%,rgba(255,46,99,0.07),transparent)]">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[200] focus:rounded focus:bg-drl focus:px-3 focus:py-2 focus:text-white">{tr("Saltar al contenido")}</a>
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-white/[0.07] bg-surface-canvas/85 px-3 backdrop-blur-md md:px-5">
        <button type="button" className="nx-focus rounded-control border border-white/10 px-2.5 py-1.5 text-ink-muted lg:hidden" onClick={() => setMobileNav((v) => !v)} aria-expanded={mobileNav} aria-label={tr("Menú del panel")}>☰</button>
        <Link href="/admin" className="nx-focus flex items-center gap-2 rounded-control pr-2">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-[8px] bg-gradient-to-br from-drl to-drl-cyan/60 font-display text-sm font-black text-white">N</span>
          <span className="hidden font-display text-[15px] font-bold uppercase tracking-[0.18em] text-ink-primary sm:block">{tr("Control Center")}</span>
        </Link>
        <button type="button" onClick={() => setPalette(true)} className="nx-focus ml-2 flex min-w-0 flex-1 items-center gap-2 rounded-control border border-white/10 bg-white/[0.03] px-3 py-1.5 text-left text-[13px] text-ink-faint hover:border-white/20 md:max-w-md">
          <span aria-hidden>⌕</span><span className="truncate">{tr("Buscar usuarios, cartas, jugadores, sobres…")}</span>
          <kbd className="ml-auto hidden rounded border border-white/15 px-1.5 text-[10px] text-ink-faint sm:block">Ctrl K</kbd>
        </button>
        <div className="ml-auto flex items-center gap-3">
          <Link href={gameHref} data-testid="admin-back-to-game" aria-label={tr("Volver al juego")} className="nx-focus inline-flex shrink-0 items-center gap-1.5 rounded-control border border-white/12 px-2.5 py-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-ink-secondary hover:border-white/25 hover:text-ink-primary sm:px-3">← <span className="hidden sm:inline">{tr("Volver al juego")}</span><span className="sm:hidden">{tr("Juego")}</span></Link>
          <Link href="/admin/system" className="nx-focus rounded-control" title={tr("Estado del sistema (comprobaciones reales)")}>
            {system.data ? <LevelBadge level={system.data.overall} label={system.data.overall === "HEALTHY" ? tr("Sistema OK") : system.data.overall === "WARNING" ? tr("Avisos") : tr("Crítico")} />
              : system.error ? <LevelBadge level="WARNING" label={tr("Sin estado")} /> : <span className="text-[11px] text-ink-faint">{tr("Comprobando…")}</span>}
          </Link>
          <span className="hidden text-right text-[11px] leading-tight md:block">
            <span className="block font-semibold text-ink-secondary">{user?.email ?? tr("admin")}</span>
            <span className="text-ink-faint">{system.data ? `${system.data.environment} · v${system.data.version}` : tr("administrador")}</span>
          </span>
        </div>
      </header>
      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 border-r border-white/[0.06] bg-surface-base/60 lg:block">{nav}</aside>
        {mobileNav && <div className="fixed inset-x-0 bottom-0 top-14 z-30 overflow-y-auto bg-surface-canvas/95 lg:hidden">{nav}</div>}
        <main id="admin-main" className="min-w-0 flex-1 px-4 py-6 md:px-7 lg:px-9">{children}</main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  useLocale();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const dq = useDebounced(q.trim(), 220);
  const remote = useAdminQuery<{ hits: SearchHit[] }>(dq.length >= 2 ? `/api/admin/search?q=${encodeURIComponent(dq)}` : null);
  const t = q.trim().toLowerCase();
  const local: SearchHit[] = [
    ...PALETTE_ACTIONS.filter((a) => !t || a.label.toLowerCase().includes(t)).map((a) => ({ group: tr("Acciones"), id: a.id, label: a.label, sub: "", href: a.href })),
    ...ADMIN_SECTIONS.filter((s) => !t || s.label.toLowerCase().includes(t) || s.description.toLowerCase().includes(t)).map((s) => ({ group: tr("Secciones"), id: s.id, label: s.label, sub: s.description, href: s.href })),
  ];
  const items = [...local, ...(remote.data?.hits ?? [])];
  const go = (h: SearchHit) => { onClose(); router.push(h.href); };
  useEffect(() => { setIdx(0); }, [q]);
  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/65 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={tr("Paleta de comandos")} className="w-full max-w-xl overflow-hidden rounded-panel border border-white/12 bg-surface-elevated shadow-2xl"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
          if (e.key === "Enter" && items[idx]) go(items[idx]);
        }}>
        <label htmlFor="cc-palette" className="sr-only">{tr("Buscar en el panel")}</label>
        <input id="cc-palette" autoFocus value={q} onChange={(e) => setQ(e.target.value.slice(0, 80))} placeholder={tr("Buscar usuario, carta, jugador, equipo, sobre, evento o sección…")}
          className="w-full border-b border-white/10 bg-transparent px-4 py-3.5 text-[15px] text-ink-primary placeholder:text-ink-faint focus:outline-none" role="combobox" aria-expanded="true" aria-controls="cc-palette-list" aria-activedescendant={items[idx] ? `cc-opt-${idx}` : undefined} />
        <ul id="cc-palette-list" role="listbox" className="max-h-[55vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-ink-faint">{remote.loading ? tr("Buscando…") : tr("Sin resultados")}</li>}
          {items.map((h, i) => (
            <li key={`${h.group}:${h.id}`} id={`cc-opt-${i}`} role="option" aria-selected={i === idx}>
              {(i === 0 || items[i - 1].group !== h.group) && <p className="px-3 pb-1 pt-2 font-display text-[10px] font-bold uppercase tracking-[0.2em] text-ink-faint">{td(h.group)}</p>}
              <button type="button" onMouseEnter={() => setIdx(i)} onClick={() => go(h)} className={cn("flex w-full items-center justify-between gap-3 rounded-control px-3 py-2 text-left text-[13px]", i === idx ? "bg-white/[0.08] text-ink-primary" : "text-ink-secondary")}>
                <span className="truncate">{td(h.label)}</span><span className="truncate text-[11px] text-ink-faint">{td(h.sub)}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-white/[0.07] px-4 py-2 text-[11px] text-ink-faint">{tr("↑↓ para moverte · Enter para abrir · Esc para cerrar · la paleta nunca sanciona, borra ni concede.")}</p>
      </div>
    </div>
  );
}
