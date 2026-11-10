"use client";

/**
 * GAMESHELL — el armazón del producto (Fase 9A · Fase 44: menú principal de juego).
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
 * FASE 44 · JUGAR ES LA PALABRA MÁS IMPORTANTE. La sección «Jugar» deja de ser un enlace de 13 px: es un botón de
 * juego (`PlayButton`) a la derecha de la barra y en el CENTRO elevado del dock móvil, y se convierte en CONTINUAR
 * PARTIDA solo cuando el servidor lo dice (`/api/game/play-status`). En móvil hay por fin acceso a TODAS las secciones
 * (hoja «Menú»). Sin conexión, un único aviso para todo el juego. Las transiciones de pantalla van por familia.
 *
 * No toca datos: lee los mismos stores que leía `AppShell` y no escribe ninguno.
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MotionConfig } from "framer-motion";
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
import { CollectionRewardNotice } from "@/components/trophies/CollectionRewardNotice";
import { useAuth } from "@/lib/supabase/auth";
import { useEconomyView } from "@/lib/game/serverEconomy";
import { economyVisible } from "@/lib/game/localEconomy";
import { useSocialBadge } from "@/lib/social/client";
// F85 · pulso social (presencia + contador + retos) y aviso global de retos.
import { SocialLive, SocialPresence } from "@/components/social/SocialLive";
import { useLiveBadge } from "@/lib/liveEvents/client";
import { useCupBadge } from "@/lib/cups/client";
import { CupLiveNotice } from "@/components/cups/CupLiveNotice";
import { UpdateWatcher } from "@/components/launcher/UpdateWatcher";
import { TelemetryProbe } from "@/components/telemetry/TelemetryProbe";
import { BrandMark } from "@/branding/Logo";
import {
  MOBILE_NAV, NAV_MENU_ITEM, NAV_MENU_LABEL, NAV_MENU_ROW, isImmersive, sectionForPath, isItemActive,
  ACCOUNT_SECTION, ROUTES,
  type NavSection,
} from "@/design/nav";
import { AccountButton } from "./AccountButton";
import { mobileMenu, playCta, playSection, shellOfflineNotice, shellSections } from "@/design/gameShell";
import { usePlayStatus, refreshPlayStatus } from "@/lib/gameShell/playStatus";
import { PlayButton } from "@/components/ui/game/PlayButton";
import { GameSheet } from "@/components/ui/game/GameOverlay";
import { GameOffline } from "@/components/ui/game/GameStates";
import { GameMomentProvider } from "@/components/ui/game/GameMoment";
import { AudioSettingsPanel } from "@/components/ui/game/AudioSettingsPanel";
import { OpeningAnimationSettings } from "@/components/ui/game/OpeningAnimationSettings";
import { GameEnvironment } from "@/components/visual/GameEnvironment";
import { environmentForPath } from "@/design/environment";
import { MusicDirector } from "@/components/audio/MusicDirector";
import { playSound } from "@/lib/sound";
import { AdminEntry } from "./AdminEntry";
import { ContentSync } from "./ContentSync";
import { useAdminSession } from "@/lib/supabase/useAdminSession";
import { OnboardingRail } from "@/components/onboarding/OnboardingRail";
import { ns, td, tdIn } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("layout");

export function GameShell({ children }: { children: React.ReactNode }) {
  useLocale();
  const pathname = usePathname();
  const section = sectionForPath(pathname);
  /* Fase 44.1 · cada sección declara su ambiente (lobby, bóveda, cámara de sobres, sala táctica…). */
  const environment = environmentForPath(pathname);
  const { user } = useAuth();
  const status = usePlayStatus(user?.id ?? null, pathname);
  const online = useOnline();

  // Al SALIR de una pantalla inmersiva (partida, apertura) la foto de «¿hay partida?» ya es vieja: se pide otra.
  const prev = useRef(pathname);
  useEffect(() => {
    if (prev.current !== pathname && isImmersive(prev.current)) refreshPlayStatus(user?.id ?? null, true);
    prev.current = pathname;
  }, [pathname, user?.id]);

  // La rehidratación de Zustand es síncrona en cliente; se marca tras montar para no
  // desajustar SSR y cliente. Idéntico a lo que hacía `AppShell`.
  useEffect(() => {
    useGameStore.setState({ hydrated: true });
    useRosterStore.getState().sync();
    useEventsStore.getState().refresh();
  }, []);

  /*
   * F58 · El panel de administración es OTRA aplicación: su propio armazón (`AdminShell`, montado por
   * `app/admin/layout.tsx`), sin la barra del juego, sin música, sin ambiente y sin `CloudSync` (un
   * administrador que revisa el panel no sincroniza su partida local desde aquí).
   */
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return <>{children}</>;

  // Rutas inmersivas: el contenido manda, sin cromo alrededor.
  if (isImmersive(pathname)) {
    return (
      <MotionConfig reducedMotion="user">
        <div data-context={section?.id}>
          <GameEnvironment variant={environment} />
          <MusicDirector />
          <RegisterSW />
          <CloudSync />
          <ContentSync />
          {/* La sonda va TAMBIÉN aquí: sin esto, la ceremonia del sobre y la partida
              de duelo —las dos zonas de mayor intención— serían invisibles. */}
          <TelemetryProbe />
          {/* Colecciones · la portada (inmersiva) es donde se llega al iniciar sesión, cuando se liquida lo pendiente: el
              aviso va también aquí. En la apertura de sobres, los duelos y el lanzador, no: espera a la siguiente pantalla. */}
          {pathname === "/" && <CollectionRewardNotice />}
          {/* F85 · en la arena PvP, el aviso social vive (solo la revancha de la partida en pantalla, ya terminada); en
              las demás rutas inmersivas (sobre, entrenador), solo la presencia. */}
          {pathname.startsWith("/duelos/pvp") ? <SocialLive /> : <SocialPresence />}
          <GameMomentProvider placement="bottom">{children}</GameMomentProvider>
        </div>
      </MotionConfig>
    );
  }

  const cta = playCta(status);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen" data-context={section?.id} data-shell="game">
        <GameEnvironment variant={environment} />
        <MusicDirector />
        <SplashScreen />
        <RegisterSW />
        <CloudSync />
        <ContentSync />
        <UpdateWatcher />
        {/* Colecciones · recompensa guardada en segundo plano (solo aquí: las rutas inmersivas no se tapan). */}
        <CollectionRewardNotice />
        <TelemetryProbe />

        <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:bg-drl focus:px-4 focus:py-3 focus:font-display focus:uppercase focus:text-white">
          {t("Saltar al contenido")}
        </a>

        <TopBar activeSection={section} pathname={pathname} cta={td(cta)} />

        <GameMomentProvider>
          <main id="contenido" className="mx-auto w-full max-w-[1480px] px-4 pb-32 pt-6 md:px-8 lg:pb-12">
            {!online && shellOfflineNotice(pathname) && <GameOffline className="mb-5" />}
            {/* F86.1 · «Tu partida de torneo está lista» en cualquier pantalla (mismo sondeo que el indicador; nunca navega solo). */}
            <CupLiveNotice />
            {/* F63 · en qué paso de tu inicio estás, en cualquier pantalla (solo con la guía activa). */}
            <OnboardingRail />
            <PageTransition>{children}</PageTransition>

            {/*
              El aviso de instalación va DEBAJO del contenido, no encima.
              Antes era lo primero de cada pantalla: en el vestíbulo se comía la franja
              superior por delante del torneo en directo, y en la colección empujaba las
              cartas otros 90 px hacia abajo. Es una utilidad del navegador, no el contenido
              del juego, y ese es el sitio que le corresponde. En Duelos sigue sin aparecer,
              porque compite con la partida (Fase 8.5).
            */}
            {!pathname.startsWith("/duelos") && !pathname.startsWith("/entrenador/partido") && (
              <div className="mt-10">
                <InstallBanner />
              </div>
            )}
          </main>
        </GameMomentProvider>

        <MobileBar pathname={pathname} cta={td(cta)} />
        <SocialLive />
      </div>
    </MotionConfig>
  );
}

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine !== false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);
  return online;
}

// ───────────────────────────── Barra superior ─────────────────────────────

function TopBar({ activeSection, pathname, cta }: { activeSection: NavSection | null; pathname: string; cta: ReturnType<typeof playCta> }) {
  useLocale();
  const [menu, setMenu] = useState(false);
  const { user } = useAuth();
  // F58.2 · arranca YA la comprobación de admin (compartida): el acceso está resuelto antes de abrir el menú.
  useAdminSession();
  useEffect(() => { setMenu(false); }, [pathname]);
  return (
    <header
      className="nx-gamebar sticky top-0 z-50"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex h-topbar w-full max-w-[1480px] items-center gap-2 px-4 md:px-8">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5 pr-2" aria-label={t("Lobby de NEXUS")}>
          <BrandMark size={36} className="shrink-0 drop-shadow-[0_0_12px_rgba(255,46,99,0.35)] transition-transform duration-fast group-hover:scale-105" />
          {/* Fase 44 · entre 1024 y 1279 px el texto del logo cede su sitio a JUGAR (la matriz responsive lo recortaba). */}
          <span className="hidden leading-none sm:block lg:hidden xl:block">
            <span className="block font-display text-[19px] font-bold tracking-wide text-white">
              {t("NE")}<span className="text-drl">{t("XUS")}</span>
            </span>
            <span className="nx-label block">{t("Lobby")}</span>
          </span>
        </Link>

        {/*
          Secciones (escritorio). En móvil manda el dock inferior + la hoja «Menú».

          Fase 9.6: la barra se estira a la ALTURA COMPLETA del cromo (`self-stretch`). Fase 44: JUGAR ya no está
          aquí como una entrada más; es el botón de la derecha. Aquí quedan las secciones de PREPARAR y PROGRESAR.
        */}
        <nav className="ml-2 hidden items-stretch self-stretch lg:flex" aria-label={t("Secciones")}>
          {shellSections().map((s) => (
            <SectionMenu key={s.id} section={s} active={activeSection?.id === s.id} pathname={pathname} />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Wallet />
          {/* IA 2026-10-07 · MI CUENTA (perfil, progresión, cuenta, feedback): icono de usuario, en todos los anchos. Sin
              sesión, el hueco del HUD ya es ENTRAR (que lleva al mismo sitio). */}
          {user && <AccountButton pathname={pathname} testId="shell-account" />}
          <PlayMenu pathname={pathname} active={activeSection?.id === "jugar"} />
          <PlayButton cta={td(cta)} size="bar" className="hidden lg:inline-flex" testId="shell-play" />
          <button
            type="button"
            onClick={() => setMenu(true)}
            className="grid h-11 w-11 place-items-center text-white/80 hover:text-white lg:hidden"
            aria-label={t("Abrir menú")}
            data-testid="shell-menu"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 7h16M4 12h16M4 17h10" /></svg>
          </button>
        </div>
      </div>
      <MobileMenuSheet open={menu} onClose={() => setMenu(false)} pathname={pathname} />
    </header>
  );
}

/**
 * Sección con desplegable. Se abre al pasar el ratón y, con teclado, con ↓ (y se cierra con Escape).
 *
 * Fase 44 · antes se abría también al RECIBIR EL FOCO: tabular por la barra abría cada desplegable y metía sus
 * entradas en el recorrido, y JUGAR quedaba a 26 tabulaciones. Ahora Tab recorre las secciones (Enter navega) y ↓
 * entra en el menú: el mismo acceso para teclado, sin castigar a quien solo quiere llegar a JUGAR.
 */
function SectionMenu({
  section, active, pathname,
}: {
  section: NavSection;
  active: boolean;
  pathname: string;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const single = section.items.length <= 1;

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
      onMouseEnter={() => { if (!single) schedule(true); }}
      onMouseLeave={() => schedule(false)}
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) schedule(false); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { setOpen(false); (ref.current?.querySelector("a") as HTMLElement | null)?.focus(); }
        if (e.key === "ArrowDown" && !single) {
          e.preventDefault();
          setOpen(true);
          window.setTimeout(() => (document.getElementById(menuId)?.querySelector("a") as HTMLElement | null)?.focus(), 0);
        }
      }}
    >
      <Link
        href={section.href}
        aria-current={active ? "page" : undefined}
        aria-expanded={single ? undefined : open}
        aria-controls={single ? undefined : menuId}
        data-active={active}
        className="nx-gamebar-link"
        onMouseEnter={() => playSound("ui.hover")}
        onMouseMove={trackNavLight}
        onClick={() => playSound("ui.nav")}
      >
        {tdIn("design", section.label)}
      </Link>

      {open && !single && (
        <SectionPanel id={menuId} section={section} pathname={pathname} badges={badges} />
      )}
    </div>
  );
}

/** Fase 44.1 · la luz del enlace sigue al puntero (variable CSS: sin estado de React ni re-render). */
function trackNavLight(e: React.MouseEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--nx-lx", `${Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * 100)}%`);
}

/**
 * DESPLEGABLE DE SECCIÓN — el ÚNICO renderer de los menús del armazón en escritorio (Colección, Tienda, Temporada, Mundo
 * y «Más» = Jugar). Navegación global limpia (2026-10-07): solo el nombre de cada opción, en mayúsculas, centrado y en
 * filas compactas (`NAV_MENU_ITEM` / `NAV_MENU_LABEL`, la misma regla que la hoja móvil, «Administración» y el «Más» de
 * la portada). El ancho se ajusta al nombre más largo (`w-max`, con un mínimo común para que los menús no bailen).
 */
export function SectionPanel({ id, section, pathname, badges, align = "left" }: { id: string; section: NavSection; pathname: string; badges: Record<string, number>; align?: "left" | "right" }) {
  useLocale();
  return (
    <div
      id={id}
      className={cn("nx-dialog absolute top-full z-50 w-max min-w-[240px] max-w-[calc(100vw-32px)] animate-fade-in p-2", align === "right" ? "right-0" : "left-0")}
      data-menu-style="nav"
    >
      {section.items.map((it) => {
        const n = it.badge ? badges[it.badge] : 0;
        const active = isItemActive(pathname, it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "nx-clip-sm nx-focus transition-colors duration-fast", NAV_MENU_ITEM, NAV_MENU_ROW,
              active ? "bg-[rgb(var(--nx-tint)/0.16)] shadow-[inset_0_0_0_1px_rgb(var(--nx-tint)/0.55)]" : "hover:bg-white/[0.07]",
            )}
          >
            <b className={cn(NAV_MENU_LABEL, "text-[16px] tracking-[0.04em] text-white")}>{tdIn("design", it.label)}</b>
            {n > 0 && (
              <span className="nx-clip-sm grid h-5 min-w-5 place-items-center bg-drl px-1.5 text-[10px] font-bold tabular-nums text-white">
                {n}
              </span>
            )}
          </Link>
        );
      })}
      {/* F58.2 · junto a «Mi perfil» y «Cuenta»: solo existe si el servidor confirma que eres admin. */}
      {section.id === "progreso" && <AdminEntry variant="menu" />}
    </div>
  );
}

/** «MÁS»: el resto de «Jugar» (modos, competitivo, social, eventos, Pick'ems…) en un desplegable junto al botón. */
function PlayMenu({ pathname, active }: { pathname: string; active: boolean }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const badges = useBadges();
  const section = playSection();
  const n = badges.social + badges.live;
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative hidden self-stretch lg:flex" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={menuId}
        data-active={active}
        className="nx-gamebar-link"
        onMouseEnter={() => playSound("ui.hover")}
        onMouseMove={trackNavLight}
        data-testid="shell-play-menu"
      >
        {t("Más")}
        <svg aria-hidden viewBox="0 0 24 24" className={cn("h-4 w-4 transition-transform duration-fast", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth={2.2}><path d="m6 9 6 6 6-6" /></svg>
        {n > 0 && <span className="nx-clip-sm grid h-5 min-w-5 place-items-center bg-drl px-1.5 text-[10px] font-bold tabular-nums text-white">{n}</span>}
      </button>
      {open && <SectionPanel id={menuId} section={section} pathname={pathname} badges={badges} align="right" />}
    </div>
  );
}

function MobileMenuSheet({ open, onClose, pathname }: { open: boolean; onClose: () => void; pathname: string }) {
  useLocale();
  const badges = useBadges();
  return (
    <GameSheet open={open} onClose={onClose} title={t("Menú")} eyebrow={t("NEXUS")} testId="shell-menu-sheet">
      <MobileMenuNav pathname={pathname} badges={badges} onNavigate={onClose} />
      {/* F58.2 · acceso interno, solo para administradores confirmados por el servidor. */}
      <AdminEntry variant="sheet" onNavigate={onClose} />
      <div className="nx-clip-sm mt-6 border border-white/10 bg-white/[0.02] p-4">
        <AudioSettingsPanel />
        {/* WALKOUT 0.8 · cómo se presentan las especiales (3D / automático / reducidas) */}
        <OpeningAnimationSettings className="mt-5 border-t border-white/10 pt-4" />
      </div>
    </GameSheet>
  );
}

/**
 * Lista de la hoja «Menú» (móvil): todas las secciones con la MISMA regla de opción que los desplegables (solo el nombre,
 * mayúsculas, centrado; la insignia se centra junto al nombre). Exportada para el contrato de navegación.
 */
export function MobileMenuNav({ pathname, badges, onNavigate }: { pathname: string; badges: Record<string, number>; onNavigate?: () => void }) {
  useLocale();
  const all = [playSection(), ...shellSections()].flatMap((s) => s.items);
  return (
    <nav aria-label={t("Todas las secciones")} className="space-y-5" data-menu-style="nav">
      {mobileMenu().map((g) => (
        <section key={g.id}>
          <p className="nx-label mb-1.5">{td(g.label)}</p>
          <ul className="grid gap-1">
            {g.items.map((it) => {
              const item = all.find((x) => x.href === it.href);
              const n = item?.badge ? badges[item.badge] : 0;
              const active = isItemActive(pathname, it.href);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn("nx-clip-sm nx-focus min-h-[48px]", NAV_MENU_ITEM, active ? "bg-[rgb(var(--nx-tint)/0.16)] shadow-[inset_0_0_0_1px_rgb(var(--nx-tint)/0.55)]" : "bg-white/[0.03] active:bg-white/[0.08]")}
                  >
                    <b className={cn(NAV_MENU_LABEL, "text-[17px] tracking-[0.04em] text-white")}>{tdIn("design", it.label)}</b>
                    {n > 0 && <span className="nx-clip-sm grid h-6 min-w-6 place-items-center bg-drl px-1.5 text-[11px] font-bold text-white">{n}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/** Insignias dinámicas. Un solo sitio las calcula; la barra y el menú las consumen. */
function useBadges(): Record<string, number> {
  const hydrated = useGameStore((s) => s.hydrated);
  const events = useEventsStore((s) => (hydrated ? claimableCount(s, Date.now()) : 0));
  const news = useNewsStore((s) => (hydrated ? unreadCount(s) : 0));
  /* FASE 29 · el número social lo cuenta el SERVIDOR (solicitudes + retos recibidos pendientes). */
  const { user } = useAuth();
  const social = useSocialBadge(!!user);
  /* FASE 30 · «EN DIRECTO» en Eventos solo si hay un partido REAL en directo (lo cuenta el servidor). */
  const live = useLiveBadge(!!user);
  /* F86 · «Torneos»: mis cruces de torneo que piden acción ahora (un sondeo compartido por minuto). */
  const cup = useCupBadge(!!user);
  /*
   * CORE GAME LOOP · el Centro de eventos local (`/eventos`, `localStorage`) NO deja reclamar con cuenta (la economía es
   * del servidor), así que con sesión su número anunciaba recompensas imposibles. Con cuenta: 0.
   */
  return { events: user ? 0 : events, news, duel: 0, social, cup, live };
}

/**
 * Nivel y DRL Credits. Las dos cifras que un jugador comprueba sin pensar, siempre en el
 * mismo sitio.
 *
 * Hasta la F18.2 había una tercera: «🎟️ Fichas de evento». Tenía un problema de fondo —con
 * sesión enseñaba `profiles.tokens` y sin sesión un contador de `localStorage`, así que el
 * mismo jugador veía dos saldos distintos según hubiera entrado o no— y desapareció con la
 * moneda. Ahora hay UNA sola moneda, y vive en el servidor.
 */
function Wallet() {
  useLocale();
  // F81.2 · «rehidratado» no basta: la caché o la demo NO son de esta cuenta hasta que llegue su estado del servidor.
  const view = useEconomyView();
  const hydrated = useGameStore((s) => s.hydrated) && economyVisible(view);
  const credits = useGameStore((s) => s.credits);
  const xp = useGameStore((s) => s.xp);
  const level = levelFromXp(xp);
  const { user, loading, configured } = useAuth();

  /*
   * F64 · SIN SESIÓN NO HAY CIFRAS. El store local arranca con nivel 1 y 6.000 créditos: enseñarlos a quien no ha entrado
   * era un dato falso en el HUD. Con Supabase configurado y sin usuario, el hueco del HUD es la puerta: ENTRAR.
   */
  if (configured && !loading && !user) {
    return (
      <Link href="/cuenta" data-testid="hud-signin" className="nx-clip-sm nx-press flex min-h-[40px] items-center border border-drl/40 bg-drl/[0.1] px-3 font-display text-[12px] font-bold uppercase tracking-[0.16em] text-white transition-colors duration-fast hover:bg-drl/20">
        {t("Entrar")}
      </Link>
    );
  }

  return (
    <>
      <Link
        href={ROUTES.accountProgress}
        className="nx-clip-sm hidden items-center gap-2.5 border border-white/10 bg-white/[0.04] px-2.5 py-1.5 transition-colors duration-fast hover:border-white/25 md:flex lg:hidden xl:flex"
        aria-label={hydrated ? t("Tu progreso · nivel {level}", { level: level.level }) : t("Tu progreso")}
      >
        <span className="nx-clip-sm grid h-8 w-8 place-items-center bg-drl-cyan/15 font-display text-[15px] font-bold tabular-nums text-drl-cyan">
          {hydrated ? level.level : "—"}
        </span>
        <span className="w-[76px]">
          <span className="flex justify-between">
            <span className="nx-label !text-[10px]">{t("Nivel")}</span>
            <span className="font-display text-[10px] font-bold tabular-nums text-white/50">
              {hydrated ? `${Math.round(level.progress * 100)}%` : ""}
            </span>
          </span>
          <span className="mt-1 block h-1 overflow-hidden bg-white/10">
            <span
              className="block h-full origin-left bg-gradient-to-r from-drl-cyan to-drl transition-transform duration-normal ease-out"
              style={{ transform: `scaleX(${hydrated ? level.progress : 0})` }}
            />
          </span>
        </span>
      </Link>

      <Currency
        value={hydrated ? formatCredits(credits) : "—"}
        label={t("DRL Credits")}
        className="border-drl-gold/25 bg-drl-gold/[0.08] text-drl-gold"
      />
    </>
  );
}

function Currency({
  value, label, className,
}: {
  value: string;
  label: string;
  className: string;
}) {
  useLocale();
  return (
    <span
      className={cn("nx-clip-sm flex items-center gap-1.5 border px-2.5 py-1.5", className)}
      title={td(label)}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" /><path d="M12 8v8" /></svg>
      <span className="nx-readout text-[16px]">{td(value)}</span>
      <span className="sr-only">{td(label)}</span>
    </span>
  );
}

// ───────────────────────────── Barra inferior (móvil) ─────────────────────────────

function MobileBar({ pathname, cta }: { pathname: string; cta: ReturnType<typeof playCta> }) {
  useLocale();
  const badges = useBadges();
  const active = sectionForPath(pathname);

  return (
    <nav
      className="nx-dock fixed inset-x-0 bottom-0 z-50 flex h-mobilebar items-stretch lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label={t("Navegación principal")}
    >
      {MOBILE_NAV.map((item) => {
        // IA 2026-10-07 · MI CUENTA no es una sección de la barra: se marca por su ruta. La Tienda ya no lleva el número
        // del Centro de eventos (salió de la Tienda).
        const on = item.section === ACCOUNT_SECTION
          ? pathname === ROUTES.account || pathname.startsWith(`${ROUTES.account}/`)
          : item.section ? active?.id === item.section : pathname === "/";
        const n = item.section === "jugar" ? badges.social : 0;
        if (item.play) {
          return (
            <div key={item.href} className="relative flex min-w-0 flex-1 justify-center">
              <span className="absolute -top-6">
                <PlayButton cta={td(cta)} size="dock" testId="dock-play" />
                {n > 0 && (
                  <span className="nx-clip-sm absolute -right-1 top-1 grid h-5 min-w-5 place-items-center bg-white px-1 text-[10px] font-bold tabular-nums text-drl">{n}</span>
                )}
              </span>
            </div>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? "page" : undefined}
            onClick={() => playSound("ui.nav")}
            className="nx-press relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1"
          >
            {/* Sin iconos emoji: una barra de acento sobre el destino activo. */}
            <span
              className={cn(
                "absolute inset-x-4 top-0 h-[3px] transition-opacity duration-fast",
                on
                  ? "bg-[rgb(var(--nx-tint))] opacity-100 shadow-[0_0_10px_rgb(var(--nx-tint)/0.9)]"
                  : "opacity-0",
              )}
            />
            <span
              className={cn(
                "font-display text-[13px] font-bold uppercase tracking-[0.08em] transition-colors duration-fast",
                on ? "text-white" : "text-white/55",
              )}
            >
              {tdIn("design", item.label)}
            </span>
            {n > 0 && (
              <span className="nx-clip-sm absolute right-[16%] top-2 grid h-4 min-w-4 place-items-center bg-drl px-1 text-[9px] font-bold tabular-nums text-white">
                {n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
