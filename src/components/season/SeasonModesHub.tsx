"use client";

/**
 * IA 2026-10-07 · HUB DE TEMPORADA — `/temporada`: PASE DE BATALLA · OBJETIVOS · CRAFTEO.
 *
 * El mismo lenguaje que el selector de JUGAR (`GameModesHub`): tres paneles grandes con su arte, un título enorme y UN
 * botón (`ModePanel`, la pieza compartida — no una copia). Presentación pura: cada panel lleva al sistema CANÓNICO que
 * ya existe (el pase de Fase 34/F83, los objetivos del pase + misiones F73, la Forja de F73/F79). Aquí no se lee ni se
 * calcula nada: ni niveles, ni recompensas, ni recetas.
 */
import { cn } from "@/lib/format";
import { ROUTES } from "@/design/nav";
import { ModePanel, PanelImage } from "@/components/modes/ModePanel";
import { CARDS } from "@/data/catalog";
import { packArtwork } from "@/data/packArtwork";
import { CardArt } from "@/components/cards/CardArt";

/** Las tres áreas, en su orden. Exactamente tres: el contrato (`seasonHub.render.test`) lo fija. */
export const SEASON_AREAS = [
  { id: "PASS", title: "Pase de batalla", href: ROUTES.battlePass, cta: "Ver pase", rgb: "255,211,92", focus: "campaign" },
  { id: "OBJECTIVES", title: "Objetivos", href: ROUTES.objectives, cta: "Ver objetivos", rgb: "47,224,255", focus: "quick" },
  { id: "CRAFTING", title: "Crafteo", href: ROUTES.crafting, cta: "Entrar", rgb: "169,112,255", focus: "draft" },
] as const;

export type SeasonAreaId = (typeof SEASON_AREAS)[number]["id"];

const PANEL = "min-h-[232px] sm:min-h-[280px] lg:min-h-[540px]";

/** Pase: el escenario de campeones con la VÍA de niveles encendiéndose hacia el premio. */
function PassArt() {
  const nodes = [[60, 250], [150, 205], [240, 222], [330, 160], [420, 175], [510, 100]];
  return (
    <>
      <PanelImage src="/game/arenas/nexus-champions/stage-960.webp" position="50% 30%" className="opacity-70" />
      <span className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(255,211,92,0.14), rgba(40,26,0,0.45))", mixBlendMode: "color" }} />
      <svg viewBox="0 0 600 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <polyline points={nodes.map((p) => p.join(",")).join(" ")} fill="none" stroke="rgba(255,211,92,0.75)" strokeWidth="3" className="nx-energy" />
        {nodes.map(([x, y], i) => (
          <polygon key={i} transform={`translate(${x} ${y})`} points="0,-11 9.5,-5.5 9.5,5.5 0,11 -9.5,5.5 -9.5,-5.5"
            fill={i < 4 ? "rgba(255,211,92,0.9)" : "rgba(10,10,18,0.9)"} stroke="#ffd35c" strokeWidth="2" />
        ))}
      </svg>
    </>
  );
}

/** Objetivos: una lista de tareas con sus marcas, en el cian de la casa. */
function ObjectivesArt() {
  return (
    <>
      <span className="absolute inset-0" style={{ background: "radial-gradient(60% 60% at 50% 40%, rgba(47,224,255,0.28), transparent 70%)" }} />
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(110 ${54 + i * 46})`}>
            <rect width="26" height="26" fill="rgba(6,18,31,0.9)" stroke="#2fe0ff" strokeWidth="2.2" />
            {i < 2 && <path d="M5 13l6 6 11-13" fill="none" stroke="#2fe0ff" strokeWidth="3" />}
            <rect x="42" y="8" width={[150, 120, 170, 96][i]} height="10" fill={i < 2 ? "rgba(47,224,255,0.75)" : "rgba(255,255,255,0.22)"} />
          </g>
        ))}
      </svg>
    </>
  );
}

/** Una carta real de escaparate (no una promesa de salida): la de mayor OVR del catálogo con imagen, estable. */
const CRAFT_CARD = CARDS.filter((c) => !!c.image).sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id))[0] ?? null;

/** Crafteo: dos sobres y una carta REALES (su arte de siempre) sobre el violeta de la Forja. Decorativo: `alt=""`. */
function CraftingArt() {
  const pack = (id: string) => packArtwork(id);
  return (
    <>
      <span className="absolute inset-0" style={{ background: "radial-gradient(55% 55% at 50% 42%, rgba(169,112,255,0.38), transparent 72%)" }} />
      <span className="absolute inset-x-0 top-[12%] flex items-end justify-center">
        {pack("premium") && <img src={pack("premium")!} alt="" loading="lazy" className="relative -mr-10 w-[110px] rotate-[-12deg] opacity-90 drop-shadow-[0_10px_18px_rgba(0,0,0,0.6)]" />}
        {pack("oro") && <img src={pack("oro")!} alt="" loading="lazy" className="relative z-10 w-[132px] drop-shadow-[0_10px_18px_rgba(0,0,0,0.6)]" />}
        {CRAFT_CARD?.image && <span className="relative -ml-8 block w-[104px] rotate-[10deg]"><CardArt src={CRAFT_CARD.image} alt="" className="w-full" /></span>}
      </span>
    </>
  );
}

const ART: Record<SeasonAreaId, () => React.ReactElement> = { PASS: PassArt, OBJECTIVES: ObjectivesArt, CRAFTING: CraftingArt };

export function SeasonModesHub({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[1480px] space-y-4 px-4 pb-10 pt-5 md:px-8", className)} data-testid="season-hub">
      <h1 className="font-display text-[clamp(28px,4vw,44px)] font-bold uppercase leading-none text-white">Temporada</h1>
      <section aria-label="Temporada" data-testid="season-areas" className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:gap-4">
        {SEASON_AREAS.map((a, i) => {
          const Art = ART[a.id];
          return (
            <ModePanel
              key={a.id}
              testId={`season-area-${a.id}`}
              ctaTestId={`season-area-cta-${a.id}`}
              dataMode={a.id}
              rgb={a.rgb}
              focus={a.focus}
              title={a.title}
              cta={{ label: a.cta, href: a.href }}
              primary={i === 0}
              art={<Art />}
              className={PANEL}
            />
          );
        })}
      </section>
    </div>
  );
}
