"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useGameStore } from "@/store/useGameStore";
import { useEventsStore, claimableCount } from "@/store/useEventsStore";
import { useRosterStore } from "@/store/useRosterStore";
import { levelFromXp } from "@/domain/progression/levels";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/format";
import { SplashScreen } from "@/components/pwa/SplashScreen";
import { RegisterSW } from "@/components/pwa/RegisterSW";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import { PageTransition } from "./PageTransition";
import { CloudSync } from "@/components/sync/CloudSync";

const NAV = [
  { href: "/", label: "Inicio", icon: "🏠" },
  { href: "/eventos", label: "Eventos", icon: "🎉" },
  { href: "/tienda", label: "Tienda", icon: "🛒" },
  { href: "/coleccion", label: "Colección", icon: "🗂️" },
  { href: "/inventario", label: "Inventario", icon: "🎒" },
  { href: "/mercado", label: "Mercado", icon: "💱" },
  { href: "/ranking", label: "Ranking", icon: "🏅" },
  { href: "/logros", label: "Logros", icon: "🏆" },
  { href: "/cuenta", label: "Cuenta", icon: "👤" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hydrated = useGameStore((s) => s.hydrated);
  // Selector dirigido: solo recalcula la insignia cuando cambia el nº reclamable.
  const claimable = useEventsStore((s) => (hydrated ? claimableCount(s, Date.now()) : 0));

  // La rehidratación de Zustand (localStorage) es síncrona en cliente; marcamos
  // "hydrated" tras montar para evitar desajustes SSR/cliente.
  useEffect(() => {
    useGameStore.setState({ hydrated: true });
    // Reconstruye el catálogo con los jugadores importados persistidos.
    useRosterStore.getState().sync();
    useEventsStore.getState().refresh();
  }, []);

  return (
    <div className="relative min-h-screen bg-grid">
      <SplashScreen />
      <RegisterSW />
      <CloudSync />
      <TopBar />
      <div className="mx-auto flex w-full max-w-[1400px] gap-6 px-4 pb-28 pt-4 md:px-6 md:pb-8">
        {/* Sidebar (desktop) */}
        <aside className="sticky top-20 hidden h-[calc(100vh-6rem)] w-56 shrink-0 flex-col gap-1 md:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.href}
              {...item}
              active={isActive(pathname, item.href)}
              badge={item.href === "/eventos" ? claimable : 0}
            />
          ))}
          <div className="mt-auto rounded-xl border border-white/5 bg-base-700/50 p-4 text-xs text-white/40">
            <p className="font-display uppercase tracking-wider text-drl">DRL Champions</p>
            <p className="mt-1">Versión 0.5 · Beta</p>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <InstallBanner />
          <PageTransition>{children}</PageTransition>
        </main>
      </div>

      {/* Navegación inferior (móvil) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-1 overflow-x-auto border-t border-white/10 bg-base-800/95 px-2 py-2 backdrop-blur md:hidden"
        style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
      >
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 flex-1 basis-[56px] flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-medium transition-colors",
              isActive(pathname, item.href) ? "text-drl" : "text-white/50",
            )}
          >
            <span className="relative text-lg">
              {item.icon}
              {item.href === "/eventos" && claimable > 0 && (
                <span className="absolute -right-1.5 -top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-drl px-1 text-[8px] font-bold text-white">
                  {claimable}
                </span>
              )}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function NavLink({
  href,
  label,
  icon,
  active,
  badge = 0,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-4 py-3 font-display text-sm uppercase tracking-wide transition-all",
        active
          ? "bg-drl/15 text-white shadow-[inset_0_0_0_1px_rgba(255,46,99,0.4)]"
          : "text-white/55 hover:bg-white/5 hover:text-white",
      )}
    >
      <span className={cn("text-lg transition-transform group-hover:scale-110")}>{icon}</span>
      {label}
      {badge > 0 && (
        <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-drl px-1.5 text-xs font-bold text-white shadow-glow">
          {badge}
        </span>
      )}
      {active && badge === 0 && <span className="ml-auto h-2 w-2 rounded-full bg-drl shadow-glow" />}
    </Link>
  );
}

function TopBar() {
  const hydrated = useGameStore((s) => s.hydrated);
  const credits = useGameStore((s) => s.credits);
  const xp = useGameStore((s) => s.xp);
  const tokens = useEventsStore((s) => s.tokens);
  const level = levelFromXp(xp);

  return (
    <header
      className="sticky top-0 z-50 border-b border-white/10 bg-base-900/80 backdrop-blur-xl"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-4 px-4 py-3 md:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-drl to-[#7b1733] font-display text-lg font-bold text-white shadow-glow">
            D
          </div>
          <div className="leading-none">
            <p className="font-display text-lg font-bold tracking-wide text-white">
              DRL <span className="text-drl">CHAMPIONS</span>
            </p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">
              Valorant Card Game
            </p>
          </div>
        </Link>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {/* Nivel */}
          <div className="hidden items-center gap-2 rounded-xl border border-white/10 bg-base-700/60 px-3 py-1.5 sm:flex">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-drl-cyan/20 font-display text-sm font-bold text-drl-cyan">
              {hydrated ? level.level : "—"}
            </div>
            <div className="w-20">
              <div className="flex justify-between text-[9px] text-white/40">
                <span>NIVEL</span>
                <span>{hydrated ? `${Math.round(level.progress * 100)}%` : ""}</span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-drl-cyan to-drl transition-all"
                  style={{ width: hydrated ? `${level.progress * 100}%` : "0%" }}
                />
              </div>
            </div>
          </div>

          {/* Tokens de evento */}
          <div className="flex items-center gap-2 rounded-xl border border-drl-cyan/30 bg-drl-cyan/10 px-3 py-2">
            <span className="text-base">🎟️</span>
            <span className="font-display text-base font-bold tabular-nums text-drl-cyan">
              {hydrated ? formatCredits(tokens) : "—"}
            </span>
          </div>

          {/* Créditos */}
          <div className="flex items-center gap-2 rounded-xl border border-drl-gold/30 bg-drl-gold/10 px-3 py-2 shadow-[0_0_18px_rgba(255,211,92,0.12)]">
            <span className="text-base">🪙</span>
            <span className="font-display text-base font-bold tabular-nums text-drl-gold">
              {hydrated ? formatCredits(credits) : "—"}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
