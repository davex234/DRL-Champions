"use client";

/**
 * MENÚ PRINCIPAL DE NEXUS — la Home deja de ser un cuadro de mandos.
 *
 * ────────────────────────── QUÉ CAMBIA, Y POR QUÉ ──────────────────────────
 *
 * La Home era `DailyLobby`: seis bloques apilados (héroe del día, «después», hoy, temporada,
 * jugar, circuito, colección) más una barra de navegación con seis secciones y ~20 enlaces
 * dentro. Eso responde muy bien a «¿qué hay?» y muy mal a «¿qué hago?». Y sobre todo: parece
 * una aplicación web, porque lo es.
 *
 * Ahora hay TRES acciones y ninguna más:
 *
 *     JUGAR       → el Play Hub de Fase 45, donde ya viven PvE, Ranked, Campaña, Draft y PvP
 *     INVENTARIO  → la bóveda: colección, equipos y estrategia
 *     TIENDA      → sobres, mis sobres y la apertura
 *
 * Nada se borra. Temporada, misiones, logros, eventos, Pick'ems, perfil y ajustes siguen
 * existiendo y siguen siendo alcanzables: bajan al menú secundario («MÁS», también con Escape),
 * que es donde va lo que se consulta de vez en cuando y no lo que se hace cada sesión.
 *
 * ────────────────────────── QUÉ NO HACE ──────────────────────────
 *
 * Presentación pura. No llama al servidor, no escribe, no decide una recompensa y no conoce las
 * reglas del combate. Recibe la foto del Daily Loop (que ya era de sólo lectura) y la pinta.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CardThumb } from "@/components/cards/CardThumb";
import type { CardDef } from "@/domain/cards/types";
import type { DailyLoopSnapshot } from "@/domain/dailyLoop";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/format";
import { NexusHall, LOBBY_VIDEO_READY, type HallAccent } from "./NexusHall";
import { MoreMenu } from "./MoreMenu";
import { AccountButton } from "@/components/layout/AccountButton";
import { ProgressDock } from "./ProgressDock";
import { SeasonDock } from "@/components/seasonTrack/SeasonDock";
import { OnboardingContinue, OnboardingWelcome, StarterMoment } from "@/components/onboarding/OnboardingHome";
import type { OnboardingView } from "@/domain/onboarding";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";
import { FirstSessionDiscovery } from "./FirstSessionDiscovery";

const t = ns("home");

/** Las tres. El orden es la jerarquía: JUGAR manda. */
const ACCIONES = [
  {
    id: "play" as const,
    href: "/jugar",
    titulo: "Jugar",
    sub: "Entra en la arena",
    k: "255, 46, 99",
    accent: "play" as HallAccent,
  },
  {
    id: "vault" as const,
    /* `/inventario` es OTRA cosa (sobres sin abrir y duplicadas, que van en TIENDA): la bóveda tiene ruta propia. */
    href: "/boveda",
    titulo: "Inventario",
    sub: "Tus cartas, tu poder",
    k: "79, 195, 247",
    accent: "vault" as HallAccent,
  },
  {
    id: "store" as const,
    href: "/tienda",
    titulo: "Tienda",
    sub: "Sobres y contenido",
    k: "255, 196, 77",
    accent: "store" as HallAccent,
  },
];

/** Iconos ORIGINALES, dibujados aquí: dos espadas, cartas apiladas y un carro. Nada calcado. */
function Icono({ id, className }: { id: "play" | "vault" | "store"; className?: string }) {
  const c = cn("h-full w-full", className);
  if (id === "play") {
    return (
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className={c}>
        <path d="M5 5l16 16M5 21l6-6M21 21L5 5m16 16l-6-6" />
        <path d="M24 4l4 4-3 3-4-4z" />
        <path d="M8 4L4 8l3 3 4-4z" />
      </svg>
    );
  }
  if (id === "vault") {
    return (
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" className={c}>
        <rect x="11" y="5" width="16" height="22" rx="2" />
        <path d="M8 8v17a2 2 0 002 2h13" />
        <path d="M5 11v14a2 2 0 002 2h10" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={c}>
      <path d="M3 4h4l3.5 15h13L27 8H9" />
      <circle cx="12" cy="26" r="2" />
      <circle cx="23" cy="26" r="2" />
    </svg>
  );
}

export function MainMenu({
  snap, cards, hero, heroOwnedLabel, username, level, credits, signedIn, network = "online", userKey = null,
}: {
  /** RESULTADO ÚNICO · id de la cuenta, solo para la marca «ya vista» de «Primera sesión completada». */
  userKey?: string | null;
  /**
   * Estado de la lectura del Daily Loop. Existe por una razón concreta: al rehacer la Home me dejé
   * este aviso por el camino, y una pantalla preciosa que NO dice que está sin datos miente. Si el
   * servidor no contesta, se dice — pequeño, arriba, sin romper la composición.
   */
  network?: "online" | "offline" | "error";
  snap: DailyLoopSnapshot;
  /** Cartas reales para la escena. */
  cards: CardDef[];
  /** Carta destacada real (regla determinista, sin rotación inventada). */
  hero: CardDef | null;
  heroOwnedLabel: string | null;
  username: string | null;
  level: number | null;
  /** Créditos REALES. Es la única moneda del producto: no se inventa una segunda. */
  credits: number | null;
  signedIn: boolean;
}) {
  useLocale();
  const router = useRouter();
  const [accent, setAccent] = useState<HallAccent>(null);
  const [videoReady, setVideoReady] = useState(LOBBY_VIDEO_READY);
  const [more, setMore] = useState(false);

  /*
   * F63 · LA PRIMERA SESIÓN. La guía llega en la misma foto (`snap.onboarding`); cada orden (EMPEZAR, crear equipo,
   * saltar) devuelve la foto nueva del servidor y sustituye a esta. Bienvenida y recursos ocupan el sitio de las tres
   * acciones (un solo botón que pulsar); del paso 3 en adelante, las tres acciones vuelven y la guía va debajo.
   */
  const [ob, setOb] = useState<OnboardingView | null>(snap.onboarding ?? null);
  useEffect(() => { setOb(snap.onboarding ?? null); }, [snap.onboarding]);
  const obMode = signedIn && ob?.active ? (ob.status === "NOT_STARTED" ? "welcome" : ob.current === "open" ? "starter" : "continue") : "none";

  const onVideoError = useCallback(() => setVideoReady(false), []);

  /* Escape abre y cierra el menú secundario. Un menú al que no se sale con Escape está roto. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMore((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const apuntar = useCallback((a: HallAccent) => {
    setAccent(a);
    playSound("ui.hover");
  }, []);

  /* Road to Champions: SÓLO si la campaña real dice algo. Nada se inventa. */
  const campaña = snap.campaign;
  const capitulo = campaña?.next ? `Capítulo ${campaña.next.chapterOrder}` : null;

  const ir = useCallback((href: string) => {
    playSound("ui.confirm");
    router.push(href);
  }, [router]);

  const hudCreditos = useMemo(
    () => (credits == null ? null : credits.toLocaleString(getIntlLocale())),
    [credits],
  );

  return (
    <main
      data-testid="main-menu"
      /*
       * `min-h-[100dvh]`, no `h-screen`: en escritorio la primera vista ocupa la pantalla entera sin
       * scroll, pero si la altura es pequeña —o alguien amplía por accesibilidad— la página PUEDE
       * crecer y desplazarse. Nada de `overflow: hidden` global: eso es lo que rompió la rueda en su
       * día y no se vuelve a hacer.
       */
      className="relative isolate flex min-h-[100dvh] flex-col"
    >
      <NexusHall
        cards={cards}
        hero={hero}
        accent={accent}
        videoReady={videoReady}
        onVideoError={onVideoError}
      />

      {/* ═══════════ HUD SUPERIOR ═══════════ */}
      <header className="relative z-10 flex items-start justify-between gap-4 px-[clamp(16px,2.4vw,40px)] pt-[clamp(14px,2vh,26px)]">
        {/* Marca REAL del producto. La referencia decía «NEXUS CHAMPIONS»; el producto no se llama así. */}
        <Link href="/" className="flex items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70">
          <span
            className="h-[clamp(26px,3.4vh,40px)] w-[clamp(26px,3.4vh,40px)] shrink-0"
            style={{
              backgroundImage: "url(/branding/icon/icon.svg)",
              backgroundSize: "contain",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
            }}
          />
          <span className="font-display text-[clamp(17px,2.3vh,27px)] font-extrabold uppercase leading-none tracking-[0.36em] text-white">
            {t("Nexus")}
          </span>
        </Link>

        <div className="flex items-center gap-[clamp(8px,1vw,16px)]">
          {signedIn && level != null && (
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center font-display text-[13px] font-bold text-white"
                style={{ clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)", background: "rgba(255,196,77,0.16)", boxShadow: "inset 0 0 0 1px rgba(255,196,77,0.6)" }}>
                {level}
              </span>
              <span className="hidden leading-tight sm:block">
                <b className="block font-display text-[12px] font-bold uppercase tracking-[0.14em] text-white">{username ?? t("Jugador")}</b>
                <span className="nx-label !text-[9px] text-white/45">{t("Nivel")} {level}</span>
              </span>
            </div>
          )}

          {network !== "online" && (
            <span
              data-testid="home-offline"
              className="nx-quick !py-1.5 !text-drl-gold"
              title={t("No se ha podido leer tu progreso: lo que ves puede estar desactualizado.")}
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-drl-gold" />
              <span className="nx-label !text-[9px] text-drl-gold">
                {network === "offline" ? t("Sin conexión") : t("Sin datos")}
              </span>
            </span>
          )}

          {hudCreditos && (
            <span className="nx-quick !py-1.5" data-testid="hud-credits">
              <span className="h-4 w-4 shrink-0 rounded-sm" style={{ background: "linear-gradient(140deg, #ffd66b, #b8821f)" }} />
              <b className="nx-readout text-[13px] text-drl-gold">{td(hudCreditos)}</b>
            </span>
          )}

          {/* IA 2026-10-07 · MI CUENTA también desde la portada (misma pieza que el armazón). */}
          {signedIn && <AccountButton testId="home-account" className="!h-10 !w-10" />}

          <button
            type="button"
            data-testid="more-toggle"
            aria-haspopup="dialog"
            aria-expanded={more}
            aria-label={t("Más opciones")}
            onClick={() => { playSound("ui.confirm"); setMore(true); }}
            className="nx-quick !px-2.5 !py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 text-white/70">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10l2.1 2.1m0-14.2l-2.1 2.1m-10 10l-2.1 2.1" />
            </svg>
          </button>
        </div>
      </header>

      {/* ═══════════ F63 · BIENVENIDA / RECURSOS: un solo botón, sobre la misma escena ═══════════ */}
      {(obMode === "welcome" || obMode === "starter") && ob && (
        <div className="relative z-10 flex flex-1 items-center px-[clamp(16px,2.6vw,48px)] py-6" data-testid="home-onboarding" data-mode={obMode}>
          {obMode === "welcome" ? <OnboardingWelcome view={ob} onView={setOb} /> : <StarterMoment view={ob} onView={setOb} credits={credits} />}
        </div>
      )}

      {/* ═══════════ LAS TRES ACCIONES ═══════════ */}
      {obMode !== "welcome" && obMode !== "starter" && (
      <div className="relative z-10 flex flex-1 items-center">
        <nav
          aria-label={t("Menú principal")}
          data-testid="main-actions"
          className="flex w-[min(92vw,640px)] flex-col gap-[clamp(12px,2vh,24px)] pl-[clamp(16px,2.6vw,48px)] pr-4"
        >
          {ACCIONES.map((a) => (
            <button
              key={a.id}
              type="button"
              data-testid={`action-${a.id}`}
              data-action={a.id}
              className="nx-menu-btn"
              style={{ "--k": a.k } as React.CSSProperties}
              onMouseEnter={() => apuntar(a.accent)}
              onMouseLeave={() => setAccent(null)}
              onFocus={() => apuntar(a.accent)}
              onBlur={() => setAccent(null)}
              onClick={() => ir(a.href)}
            >
              <span className="nx-menu-ticks" aria-hidden>
                <span /><span /><span />
              </span>
              <span className="relative flex items-center gap-[clamp(12px,1.6vw,24px)] pl-3">
                <span className="h-[clamp(34px,5.4vh,62px)] w-[clamp(34px,5.4vh,62px)] shrink-0" style={{ color: `rgb(${a.k})` }}>
                  <Icono id={a.id} />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block font-display text-[clamp(28px,5.6vh,58px)] font-extrabold uppercase leading-none tracking-[0.04em] text-white">
                    {td(a.titulo)}
                  </b>
                  <span className="mt-1.5 block font-display text-[clamp(10px,1.5vh,15px)] font-bold uppercase tracking-[0.3em] text-white/60">
                    {td(a.sub)}
                  </span>
                </span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"
                  className="nx-menu-arrow h-[clamp(18px,2.6vh,28px)] w-[clamp(18px,2.6vh,28px)] shrink-0 text-white/75">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </button>
          ))}

          {/* El lema. Dos líneas, como la referencia: no explica nada, ambienta. */}
          {/* F62 · con sesión, el progreso (misma foto del vestíbulo); sin sesión, el lema. */}
          {/* F86.2 · sin sesión, la puerta de la cuenta a la vista (antes solo vivía al fondo de «Más opciones»). */}
          {obMode === "continue" && ob ? <OnboardingContinue view={ob} onView={setOb} /> : signedIn && snap.signedIn ? <ProgressDock snap={snap} /> : !signedIn ? (
            <div data-testid="home-guest" className="mt-[clamp(6px,1.6vh,20px)] flex flex-wrap items-center gap-3">
              <Link href="/cuenta?registro=1" data-testid="home-signup"
                className="nx-clip-sm nx-press inline-flex min-h-[48px] items-center bg-drl px-6 font-display text-[14px] font-extrabold uppercase tracking-[0.16em] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70">
                {t("Crear cuenta")}
              </Link>
              <Link href="/cuenta" data-testid="home-login"
                className="inline-flex min-h-[44px] items-center px-2 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-white/75 underline-offset-4 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70">
                {t("Ya tengo cuenta · Entrar")}
              </Link>
              <p className="w-full text-[13px] text-white/55">{t("Con tu cuenta recibes tus sobres de bienvenida y todo se guarda en el servidor.")}</p>
            </div>
          ) : (
            <p className="mt-[clamp(10px,2.4vh,30px)] font-display text-[clamp(10px,1.4vh,14px)] font-bold uppercase leading-[1.8] tracking-[0.34em] text-white/35">
              {fill(t("Las cartas{salto}hacen leyendas", slots("salto")), { salto: <br /> })}
              <span className="mt-3 block h-px w-14 bg-white/25" />
            </p>
          )}
          {/* F83 · acceso a la ruta de temporada (solo con temporada activa o en reclamo; si no, no pinta nada). */}
          {signedIn && snap.signedIn && obMode !== "continue" && <SeasonDock />}
        </nav>
      </div>
      )}

      {/* ═══════════ ACCESOS INFERIORES · como mucho dos ═══════════ */}
      <footer className="relative z-10 flex items-end justify-between gap-4 px-[clamp(16px,2.4vw,40px)] pb-[clamp(14px,2.2vh,28px)]">
        {hero ? (
          <Link
            href="/coleccion"
            data-testid="quick-hero"
            className="nx-quick focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
          >
            <span className="shrink-0"><CardThumb card={hero} width={30} /></span>
            <span className="leading-tight">
              <span className="nx-label block !text-[9px] text-white/45">{t("Carta destacada")}</span>
              <b className="block font-display text-[12px] font-bold uppercase tracking-[0.12em] text-white">{td(hero.id.split("__")[0])}</b>
              {heroOwnedLabel && <span className="nx-label block !text-[8px] text-white/35">{td(heroOwnedLabel)}</span>}
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-3.5 w-3.5 text-white/50"><path d="M9 5l7 7-7 7" /></svg>
          </Link>
        ) : <span />}

        <p className="hidden font-display text-[10px] font-bold uppercase tracking-[0.42em] text-white/25 lg:block">
          {t("Play · Collect · Compete · Belong")}
        </p>

        {campaña && !campaña.complete && capitulo ? (
          <Link
            href="/jugar/road-to-champions"
            data-testid="quick-campaign"
            className="nx-quick focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 shrink-0 text-drl-gold">
              <path d="M7 4h10v5a5 5 0 01-10 0z" /><path d="M7 6H4v2a3 3 0 003 3m10-5h3v2a3 3 0 01-3 3" /><path d="M10 15h4v4h-4z" /><path d="M8 21h8" />
            </svg>
            <span className="leading-tight">
              <b className="block font-display text-[12px] font-bold uppercase tracking-[0.12em] text-white">{t("Road to Champions")}</b>
              <span className="nx-label block !text-[9px] text-white/45">{td(capitulo)} · {campaña.completed}/{campaña.total}</span>
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-3.5 w-3.5 text-white/50"><path d="M9 5l7 7-7 7" /></svg>
          </Link>
        ) : <span />}
      </footer>

      <MoreMenu open={more} onClose={() => setMore(false)} signedIn={signedIn} />
      {/* RESULTADO ÚNICO · «Primera sesión completada» (antes al pie del primer resultado): una vez, con la misma foto. */}
      {signedIn && <FirstSessionDiscovery snap={snap} userKey={userKey} offline={network !== "online"} />}
    </main>
  );
}
