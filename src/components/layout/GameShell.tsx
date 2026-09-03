"use client";

/**
 * GAMESHELL — el armazón del producto (Fase 9A).
 *
 * Sustituye a `AppShell`. El cambio no es estético: el menú lateral de catorce entradas
 * se convierte en **cinco secciones** en una barra superior (`src/design/nav.ts`), que es
 * la agrupación que salió de la auditoría del Paso 0.
 *
 * Tres decisiones que hacen que esto se lea como una aplicación y no como una web:
 *
 *  1. **La sección tiñe el producto.** El armazón pone `data-context` en la raíz y elige
 *     la variante de `DynamicGameBackground`. Sabes dónde estás antes de leer nada.
 *  2. **El fondo no hace scroll.** Es una capa fija detrás del contenido, no un
 *     `background` del documento: nada de paralaje de página larga.
 *  3. **Hay rutas inmersivas.** Jugar un duelo o abrir un sobre ocupan la pantalla
 *     entera, sin barras. Un juego no te enseña el menú mientras juegas.
 *
 * No toca datos: lee los mismos stores que leía `AppShell` y no escribe ninguno.
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useGameStore } from "@/store/useGameStore";
import { useEventsStore, claimableCount } from "@/store/useEventsStore";
import { useNewsStore, unreadCount } from "@/store/useNewsStore";
import { useRosterStore } from "@/store/useRosterStore";
import { levelFromXp } from "@/domain/progression/levels";
import { formatCredits, cn } from "@/lib/format";
import { SplashScreen } from "@/components/pwa/SplashScreen";
import { RegisterSW } from "@/components/pwa/RegisterSW";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import { PageTransition } from "./PageTransition";
import { CloudSync } from "@/components/sync/CloudSync";
import { useAuth } from "@/lib/supabase/auth";
import { UpdateWatcher } from "@/components/launcher/UpdateWatcher";
import { BrandMark } from "@/branding/Logo";
import {
  NAV_SECTIONS, MOBILE_NAV, isImmersive, sectionForPath, isItemActive,
  type NavSection,
} from "@/design/nav";
import { DynamicGameBackground, variantForSection } from "@/components/visual/DynamicGameBackground";

export function GameShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const section = sectionForPath(pathname);
  const variant = variantForSection(section?.id, pathname);

  // La rehidratación de Zustand es síncrona en cliente; se marca tras montar para no
  // desajustar SSR y cliente. Idéntico a lo que hacía `AppShell`.
  useEffect(() => {
    useGameStore.setState({ hydrated: true });
    useRosterStore.getState().sync();
    useEventsStore.getState().refresh();
  }, []);

  // Rutas inmersivas: el contenido manda, sin cromo alrededor.
  if (isImmersive(pathname)) {
    return (
      <div data-context={section?.id}>
        <DynamicGameBackground variant={variant} />
        <RegisterSW />
        <CloudSync />
        {children}
      </div>
    );
  }

  return (
    <div className="relative min-h-screen" data-context={section?.id}>
      <DynamicGameBackground variant={variant} />
      <SplashScreen />
      <RegisterSW />
      <CloudSync />
      <UpdateWatcher />

      <TopBar activeSection={section} pathname={pathname} />

      <main className="mx-auto w-full max-w-[1480px] px-4 pb-28 pt-6 md:px-8 md:pb-12">
        <PageTransition>{children}</PageTransition>

        {/*
          El aviso de instalación va DEBAJO del contenido, no encima.
          Antes era lo primero de cada pantalla: en el vestíbulo se comía la franja
          superior por delante del torneo en directo, y en la colección empujaba las
          cartas otros 90 px hacia abajo. Es una utilidad del navegador, no el contenido
          del juego, y ese es el sitio que le corresponde. En Duelos sigue sin aparecer,
          porque compite con la partida (Fase 8.5).
        */}
        {!pathname.startsWith("/duelos") && (
          <div className="mt-10">
            <InstallBanner />
          </div>
        )}
      </main>

      <MobileBar pathname={pathname} />
    </div>
  );
}

// ───────────────────────────── Barra superior ─────────────────────────────

function TopBar({ activeSection, pathname }: { activeSection: NavSection | null; pathname: string }) {
  return (
    <header
      className="nx-chrome sticky top-0 z-50"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex h-topbar w-full max-w-[1480px] items-center gap-3 px-4 md:px-8">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5" aria-label="Inicio">
          <BrandMark size={34} className="shrink-0 drop-shadow-[0_0_12px_rgba(255,46,99,0.3)]" />
          <span className="hidden leading-none sm:block">
            <span className="block font-display text-[17px] font-bold tracking-wide text-white">
              NE<span className="text-drl">XUS</span>
            </span>
            <span className="nx-label block">Valorant Cards</span>
          </span>
        </Link>

        {/*
          Secciones (escritorio). En móvil manda la barra inferior.

          Fase 9.6: la barra se estira a la ALTURA COMPLETA del cromo (`self-stretch` +
          `.nx-menu-item`). Un enlace de 34 px flotando en el centro de una barra de 64 es
          la firma de un navbar corporativo; una entrada que ocupa todo el alto y se tiñe
          al estar activa es la de un menú de juego. Misma navegación, misma tabla.
        */}
        <nav className="ml-2 hidden items-stretch self-stretch lg:flex" aria-label="Secciones">
          {NAV_SECTIONS.map((s) => (
            <SectionMenu key={s.id} section={s} active={activeSection?.id === s.id} pathname={pathname} />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Wallet />
        </div>
      </div>
    </header>
  );
}

/**
 * Sección con desplegable. Se abre al pasar el ratón Y al recibir el foco por teclado:
 * un menú que solo responde al ratón deja fuera a quien navega con tabulador.
 */
function SectionMenu({
  section, active, pathname,
}: {
  section: NavSection;
  active: boolean;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Un pequeño retardo al salir evita que el menú se cierre al cruzar el hueco
  // de unos pocos píxeles entre el botón y el panel.
  const schedule = (next: boolean) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (next) setOpen(true);
    else closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useEffect(() => { setOpen(false); }, [pathname]);

  const badges = useBadges();

  return (
    <div
      ref={ref}
      className="relative flex"
      onMouseEnter={() => schedule(true)}
      onMouseLeave={() => schedule(false)}
      onFocus={() => schedule(true)}
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) schedule(false); }}
      onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
    >
      <Link
        href={section.href}
        aria-current={active ? "page" : undefined}
        aria-expanded={open}
        aria-controls={menuId}
        data-active={active}
        className="nx-menu-item"
      >
        {section.label}
        {/* El menú abierto se insinúa sin robarle la marca a la sección activa. */}
        {open && !active && (
          <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-white/25" />
        )}
      </Link>

      {open && (
        <div
          id={menuId}
          className="absolute left-0 top-full z-50 w-[290px] animate-fade-in rounded-panel border border-white/12 bg-surface-elevated/95 p-1.5 shadow-e4 backdrop-blur-xl"
        >
          {section.items.map((it) => {
            const n = it.badge ? badges[it.badge] : 0;
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  "block rounded-card px-3 py-2.5 transition-colors duration-fast",
                  isItemActive(pathname, it.href)
                    ? "bg-[rgb(var(--nx-tint)/0.14)]"
                    : "hover:bg-white/[0.06]",
                )}
              >
                <span className="flex items-center gap-2">
                  <b className="font-display text-[15px] font-bold text-white">{it.label}</b>
                  {n > 0 && (
                    <span className="grid h-4 min-w-4 place-items-center rounded-full bg-drl px-1 text-[9px] font-bold tabular-nums text-white">
                      {n}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-white/45">{it.hint}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Insignias dinámicas. Un solo sitio las calcula; la barra y el menú las consumen. */
function useBadges(): Record<string, number> {
  const hydrated = useGameStore((s) => s.hydrated);
  const events = useEventsStore((s) => (hydrated ? claimableCount(s, Date.now()) : 0));
  const news = useNewsStore((s) => (hydrated ? unreadCount(s) : 0));
  return { events, news, duel: 0 };
}

/**
 * Nivel, fichas y créditos. Las tres cifras que un jugador comprueba sin pensar, siempre
 * en el mismo sitio. Con sesión, la de fichas es la del PERFIL (la escribe el servidor);
 * sin sesión, la del contador local, que es la única que existe en modo individual.
 */
function Wallet() {
  const hydrated = useGameStore((s) => s.hydrated);
  const credits = useGameStore((s) => s.credits);
  const xp = useGameStore((s) => s.xp);
  const localTokens = useEventsStore((s) => s.tokens);
  const { user, profile } = useAuth();
  const tokens = user && profile ? profile.tokens : localTokens;
  const level = levelFromXp(xp);

  return (
    <>
      <Link
        href="/cuenta"
        className="hidden items-center gap-2.5 rounded-control border border-white/10 bg-white/[0.04] px-2.5 py-1.5 transition-colors duration-fast hover:border-white/25 md:flex"
        aria-label="Tu nivel"
      >
        <span className="grid h-7 w-7 place-items-center rounded-chip bg-drl-cyan/15 font-display text-[13px] font-bold tabular-nums text-drl-cyan">
          {hydrated ? level.level : "—"}
        </span>
        <span className="w-[76px]">
          <span className="flex justify-between">
            <span className="nx-label !text-[9px]">Nivel</span>
            <span className="font-display text-[9px] font-bold tabular-nums text-white/40">
              {hydrated ? `${Math.round(level.progress * 100)}%` : ""}
            </span>
          </span>
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-drl-cyan to-drl transition-[width] duration-normal ease-out"
              style={{ width: hydrated ? `${level.progress * 100}%` : "0%" }}
            />
          </span>
        </span>
      </Link>

      <Currency
        value={hydrated ? formatCredits(tokens) : "—"}
        icon="🎟️"
        label="Fichas de evento"
        className="border-drl-cyan/25 bg-drl-cyan/[0.08] text-drl-cyan"
      />
      <Currency
        value={hydrated ? formatCredits(credits) : "—"}
        icon="🪙"
        label="Créditos"
        className="border-drl-gold/25 bg-drl-gold/[0.08] text-drl-gold"
      />
    </>
  );
}

function Currency({
  value, icon, label, className,
}: {
  value: string;
  icon: string;
  label: string;
  className: string;
}) {
  return (
    <span
      className={cn("flex items-center gap-1.5 rounded-control border px-2.5 py-1.5", className)}
      title={label}
    >
      <span aria-hidden className="text-[13px]">{icon}</span>
      <span className="font-display text-[15px] font-bold tabular-nums">{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

// ───────────────────────────── Barra inferior (móvil) ─────────────────────────────

function MobileBar({ pathname }: { pathname: string }) {
  const badges = useBadges();
  const active = sectionForPath(pathname);

  return (
    <nav
      className="nx-chrome fixed inset-x-0 bottom-0 z-50 flex h-mobilebar items-stretch lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegación principal"
    >
      {MOBILE_NAV.map((item) => {
        const on = item.section ? active?.id === item.section : pathname === "/";
        const n = item.section === "tienda" ? badges.events : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? "page" : undefined}
            className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1"
          >
            {/* Sin iconos emoji: una barra de acento sobre el destino activo. */}
            <span
              className={cn(
                "absolute inset-x-4 top-0 h-[2px] rounded-full transition-opacity duration-fast",
                on
                  ? "bg-[rgb(var(--nx-tint))] opacity-100 shadow-[0_0_10px_rgb(var(--nx-tint)/0.9)]"
                  : "opacity-0",
              )}
            />
            <span
              className={cn(
                "font-display text-[12px] font-bold uppercase tracking-[0.08em] transition-colors duration-fast",
                on ? "text-white" : "text-white/45",
              )}
            >
              {item.label}
            </span>
            {n > 0 && (
              <span className="absolute right-[18%] top-2.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-drl px-1 text-[8px] font-bold tabular-nums text-white">
                {n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
