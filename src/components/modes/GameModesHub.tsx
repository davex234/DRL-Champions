"use client";

/**
 * PLAY HUB · `/jugar` — F71 · PLAY EXPERIENCE 2.0: VER → ELEGIR → JUGAR.
 *
 * Antes (F35–F51) esta pantalla lo enseñaba todo a la vez: héroe de campaña con capítulos, cuatro fichas de modo
 * con su explicación, el centro táctico con su lista de capacidades, los desafíos del día y un muro de gestión.
 * Ahora son TRES áreas grandes y visuales —Road to Champions, Duelos, Tactical Coach—, cada una con su arte, su
 * título, como mucho una micro-línea y un botón. Los cuatro modos de duelo viven en `/duelos`.
 *
 * Presentación pura: el estado y el destino de la campaña y la partida abierta salen de `gameModes()`.
 * La banda de «partida en curso» se queda: es corta y evita empezar otra sin querer.
 */
import { cn } from "@/lib/format";
import { NxButton } from "@/components/ui/NxButton";
import { campaignAreaCta, COACH_ROUTE, DUELS_ROUTE, type GameModeCard, type PlayAreaId } from "@/lib/campaign/presentation";
import { playSound } from "@/lib/sound";
import { focusEnvironment } from "@/components/dailyLoop/LobbyPlayStage";
import { AgentPanelArt, ModePanel, PanelImage } from "./ModePanel";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("modes");

/** Tinte de cada área («r,g,b»): campaña oro de campeones, duelos magenta de arena, coach cian de pizarra. */
export const AREA_TINT: Record<PlayAreaId, string> = { RTC: "255,211,92", DUELS: "255,46,99", COACH: "47,224,255" };

/** Tinte de la banda de partida en curso según el modo que la tiene (los de F35). */
const MODE_TINT: Record<GameModeCard["id"], string> = {
  ROAD_TO_CHAMPIONS: "255,211,92", QUICK: "63,192,122", RANKED: "255,46,99", FRIEND: "150,120,255", DRAFT_GAUNTLET: "255,211,92",
};

/** Alto de los paneles: franjas legibles en móvil, columnas altas de modo de juego desde `lg`. */
const PANEL = "min-h-[232px] sm:min-h-[280px] lg:min-h-[540px]";

function RtcArt() {
  return (
    <>
      <PanelImage src="/game/arenas/nexus-champions/stage-960.webp" eager position="50% 40%" />
      <span className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(255,211,92,0.10), rgba(40,26,0,0.35))", mixBlendMode: "color" }} />
      <svg viewBox="0 0 600 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full opacity-70">
        <polyline points="40,250 150,190 240,230 330,150 420,190 520,90 590,110" fill="none" stroke="rgba(255,211,92,0.7)" strokeWidth="2" className="nx-energy" />
      </svg>
    </>
  );
}

function DuelsArt() {
  return (
    <>
      <span className="absolute inset-0" style={{ background: "radial-gradient(60% 60% at 50% 60%, rgba(255,46,99,0.35), transparent 70%)" }} />
      {/* Cara a cara: Phoenix mira a la derecha, Jett a la izquierda. */}
      <AgentPanelArt agentId="phoenix" side="left" width="60%" opacity={0.85} />
      <AgentPanelArt agentId="jett" side="right" width="60%" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <path d="M58 0 42 100" stroke="rgba(255,46,99,0.9)" strokeWidth="0.6" />
      </svg>
    </>
  );
}

function CoachArt() {
  return (
    <>
      <PanelImage src="/maps/thumbs/ascent.webp" position="center" className="opacity-60" style={{ filter: "hue-rotate(160deg) saturate(1.6) brightness(1.1)" }} />
      <span className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(47,224,255,0.12), rgba(2,14,28,0.5))" }} />
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <path className="nx-coach-route" d="M120 230C170 180 240 150 300 80" fill="none" stroke="#2fe0ff" strokeWidth="2.5" style={{ strokeDasharray: "6 7" }} />
        {[[120, 230], [138, 214], [104, 214], [150, 238], [126, 246]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="6" fill="#06121f" stroke="#2fe0ff" strokeWidth="2" />
        ))}
      </svg>
    </>
  );
}

export function GameModesHub({
  cards, rtcProgress = null, offline = false, className,
}: {
  /** `gameModes(facts)`: la campaña y, si la hay, la partida abierta. */
  cards: GameModeCard[];
  /** Progreso de la campaña para la micro-línea («7/15»); `null` = no se afirma nada. */
  rtcProgress?: { completed: number; total: number } | null;
  offline?: boolean;
  className?: string;
}) {
  useLocale();
  const rtc = cards.find((c) => c.id === "ROAD_TO_CHAMPIONS") ?? null;
  /* Si hay partida abierta manda ella (F45): se sube arriba y es la acción dominante. */
  const open = cards.find((c) => c.status === "EN PARTIDA") ?? null;
  const rtcNote = rtc && rtc.status !== "DISPONIBLE" && rtc.status !== "EN PARTIDA" && rtc.status !== "CARGANDO"
    ? rtc.status
    : rtcProgress && rtc?.status !== "CARGANDO" ? `${rtcProgress.completed}/${rtcProgress.total}` : null;

  return (
    <div className={cn("space-y-4", className)} data-testid="game-modes-hub">
      <h1 className="font-display text-[clamp(28px,4vw,44px)] font-bold uppercase leading-none text-white">{t("Jugar")}</h1>

      {offline && (
        <p role="status" className="border-l-2 border-drl-gold bg-white/[0.03] px-4 py-2 text-caption text-drl-gold">{t("Sin conexión · tu progreso está a salvo.")}</p>
      )}

      {open && (
        <section
          data-testid="play-hub-resume"
          data-mode={open.id}
          onMouseEnter={() => focusEnvironment("quick")}
          onMouseLeave={() => focusEnvironment(null)}
          className="nx-clip relative isolate flex flex-col gap-3 overflow-hidden px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
          style={{ boxShadow: `inset 0 0 0 1px rgba(${MODE_TINT[open.id]},0.55)`, background: `radial-gradient(70% 140% at 0% 50%, rgba(${MODE_TINT[open.id]},0.26), transparent 62%), linear-gradient(160deg, rgba(12,15,26,0.82), rgba(6,8,14,0.9))` }}
        >
          <div className="min-w-0">
            <p className="nx-label" style={{ color: `rgb(${MODE_TINT[open.id]})` }}>{t("Partida en curso")}</p>
            {/* F71 · una partida PvE abierta marca «en partida» a la vez RtC y Partida rápida (los hechos no dicen de
                cuál viene), así que su nombre no se afirma: se dice lo que es seguro. PvP/Draft sí se saben. */}
            <h2 className="mt-1 font-display text-[clamp(22px,3vw,32px)] font-bold uppercase leading-none text-white">{open.id === "ROAD_TO_CHAMPIONS" || open.id === "QUICK" ? t("Continuar partida") : td(open.title)}</h2>
          </div>
          <NxButton variant="primary" size="lg" href={open.cta.href} className="shrink-0" data-cta="primary" onClick={() => playSound("play.confirm")} data-testid="play-hub-resume-cta">{td(open.cta.label)}</NxButton>
        </section>
      )}

      <section aria-label={t("Modos de juego")} data-testid="play-areas" className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:gap-4">
        {rtc && (
          <ModePanel
            testId="play-area-RTC" ctaTestId="play-area-cta-RTC" dataMode="ROAD_TO_CHAMPIONS" rgb={AREA_TINT.RTC} focus="campaign"
            title={<>{t("Road to")} <span style={{ color: `rgb(${AREA_TINT.RTC})` }}>{t("Champions")}</span></>}
            note={td(rtcNote)} cta={campaignAreaCta(rtc)} primary={!open} art={<RtcArt />} className={PANEL}
          />
        )}
        <ModePanel
          testId="play-area-DUELS" ctaTestId="play-area-cta-DUELS" rgb={AREA_TINT.DUELS} focus="ranked"
          title={t("Duelos")} cta={{ label: t("Jugar"), href: DUELS_ROUTE }} art={<DuelsArt />} className={PANEL}
        />
        <ModePanel
          testId="play-area-COACH" ctaTestId="play-area-cta-COACH" rgb={AREA_TINT.COACH} focus="quick"
          title={<>{t("Tactical")} <span style={{ color: `rgb(${AREA_TINT.COACH})` }}>{t("Coach")}</span></>}
          cta={{ label: t("Entrar"), href: COACH_ROUTE }} ctaKind="coach" art={<CoachArt />} className={PANEL}
        />
      </section>
    </div>
  );
}
