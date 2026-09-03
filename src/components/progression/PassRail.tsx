"use client";

/**
 * EL RECORRIDO DEL PASE (Fase 9.6).
 *
 * EL PROBLEMA, tal cual se ve en `16-progreso-pase`: los treinta niveles del pase son
 * **treinta celdas de tabla en fila**. Todas del mismo tamaño, todas con el mismo borde,
 * cada una con «NIVEL 7 / 320 / te faltan 7 niveles». No hay recorrido, no hay hitos, no
 * se ve dónde estás y —lo peor— la siguiente recompensa, que es lo único que mueve a
 * seguir jugando, está enterrada entre veintinueve iguales.
 *
 * Un pase de temporada es un CAMINO. Eso es lo que se dibuja aquí.
 *
 * LAS PIEZAS
 *
 *   · **La vía.** Una línea que recorre los niveles y se ILUMINA hasta donde has llegado.
 *     Es lo que convierte una fila de cajas en un trayecto con origen y destino.
 *   · **Los nodos.** Una placa por nivel. Los hitos —los niveles con sobre, cosmético o
 *     carta— son MÁS GRANDES: un recorrido sin hitos es una regla milimetrada.
 *   · **Los estados.** Reclamado (apagado, con su marca), reclamable (encendido y
 *     latiendo), siguiente (marcado como destino) y bloqueado. Antes los cuatro se
 *     distinguían leyendo un pie de texto.
 *   · **Tú, dentro.** Un marcador de posición sobre el nivel actual.
 *
 * DECISIONES
 *
 *   1. **La vía se desplaza sola hasta donde estás.** Con treinta niveles y el jugador en
 *      el 12, arrancar en el 1 obliga a buscarse en la lista. El desplazamiento es
 *      instantáneo (`behavior: auto`) al montar: una animación de scroll al abrir la
 *      pantalla se lee como un fallo, no como una entrada.
 *   2. **Iconos dibujados, no emoji.** 🪙 y 🎟️ cambian de dibujo en cada sistema
 *      operativo y rompen el tono. Los glifos son SVG propio.
 *   3. **Sin bucles por nodo.** El único latido es el del nodo reclamable, y solo puede
 *      haber unos pocos a la vez. Treinta placas latiendo serían treinta repintados por
 *      fotograma.
 */
import { useEffect, useRef } from "react";
import type { Reward } from "@/domain/events/types";
import type { PassTrackLevelView } from "@/server/services/progression";
import { getPack } from "@/data/packs";
import { formatCredits, cn } from "@/lib/format";

/** Qué clase de recompensa domina el nivel. Decide el glifo y si el nivel es un hito. */
type RewardKind = "credits" | "tokens" | "pack" | "cosmetic" | "card" | "materials" | "xp" | "none";

/**
 * El orden importa: un nivel que da un sobre Y créditos es «un nivel de sobre». Lo raro es
 * lo que se recuerda, y lo que se recuerda es lo que debe dar nombre al nodo.
 */
function kindOf(r: Reward): RewardKind {
  if (r.cardId) return "card";
  if (r.cosmetics?.length) return "cosmetic";
  if (r.packId) return "pack";
  if (r.materials && Object.keys(r.materials).length > 0) return "materials";
  if (r.tokens) return "tokens";
  if (r.credits) return "credits";
  if (r.xp) return "xp";
  return "none";
}

/** Un hito es un nivel con algo que no sea moneda. Son los que crecen en la vía. */
const MILESTONE: RewardKind[] = ["pack", "cosmetic", "card"];

/** Glifos originales. SVG en línea: sin red, sin emoji del sistema, mismo dibujo en todo. */
function RewardGlyph({ kind, className }: { kind: RewardKind; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {kind === "credits" && (
        <>
          <circle cx="12" cy="12" r="7.5" {...common} />
          <circle cx="12" cy="12" r="3.6" {...common} strokeWidth={1.2} />
        </>
      )}
      {kind === "tokens" && (
        <>
          <path d="M4 8.5h16v2.2a1.6 1.6 0 0 0 0 2.6v2.2H4v-2.2a1.6 1.6 0 0 0 0-2.6Z" {...common} />
          <path d="M12 9v6" {...common} strokeDasharray="1.6 2" />
        </>
      )}
      {kind === "pack" && (
        <>
          <path d="M6 4h12v16H6z" {...common} />
          <path d="M6 8h12" {...common} />
          <path d="M10 12l2 2 2-2" {...common} />
        </>
      )}
      {kind === "cosmetic" && (
        <>
          <path d="M12 3l7 4.2v8.6L12 20l-7-4.2V7.2Z" {...common} />
          <path d="M9.6 9.4L12.8 12l-3.2 2.6Z" {...common} />
        </>
      )}
      {kind === "card" && (
        <>
          <path d="M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5Z" {...common} />
          <circle cx="12" cy="10" r="2.6" {...common} />
          <path d="M9 16h6" {...common} />
        </>
      )}
      {kind === "materials" && (
        <>
          <path d="M12 4l6 4v8l-6 4-6-4V8Z" {...common} />
          <path d="M12 4v16M6 8l12 8M18 8L6 16" {...common} strokeWidth={0.9} />
        </>
      )}
      {kind === "xp" && <path d="M7 14l5-6 5 6M7 18l5-6 5 6" {...common} />}
      {kind === "none" && <path d="M8 12h8" {...common} />}
    </svg>
  );
}

/** Una línea corta que describe la recompensa. Sin emoji: el glifo ya lo dice. */
export function describeReward(r: Reward): string {
  const parts: string[] = [];
  if (r.credits) parts.push(`${formatCredits(r.credits)} créditos`);
  if (r.tokens) parts.push(`${formatCredits(r.tokens)} fichas`);
  if (r.packId) {
    const pack = getPack(r.packId);
    parts.push(`${r.packCount ?? 1}× ${pack?.name ?? r.packId}`);
  }
  if (r.materials) {
    const total = Object.values(r.materials).reduce((s, n) => s + (n ?? 0), 0);
    if (total > 0) parts.push(`${total} materiales`);
  }
  // Los ids cosméticos son «familia:nombre»; al jugador se le enseña la familia.
  if (r.cosmetics?.length) {
    parts.push([...new Set(r.cosmetics.map((c) => c.split(":")[0]))].join(" · "));
  }
  if (r.xp) parts.push(`${r.xp} XP`);
  return parts.join(" · ") || "—";
}

export function PassRail({
  levels,
  currentLevel,
  open,
  tint,
  busy,
  onClaim,
}: {
  levels: PassTrackLevelView[];
  /** Nivel alcanzado por el jugador. Marca hasta dónde se ilumina la vía. */
  currentLevel: number;
  /** ¿Está abierto el carril? Cerrado, los nodos se ven pero no se reclaman. */
  open: boolean;
  /** Tinte del carril, en `r, g, b`. */
  tint: string;
  busy: boolean;
  onClaim: (level: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);

  /**
   * Coloca la vista en el nivel actual al montar. Sin esto, un jugador de nivel 24 abre el
   * pase en el nivel 1 y tiene que buscarse. Es un salto, no una animación: animar el
   * desplazamiento al abrir la pantalla se lee como que algo se ha movido solo.
   */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const node = rail.querySelector<HTMLElement>('[data-current="true"]');
    if (!node) return;
    rail.scrollLeft = Math.max(0, node.offsetLeft - rail.clientWidth / 2 + node.offsetWidth / 2);
  }, [currentLevel]);

  /** Hasta dónde llega la luz de la vía, en porcentaje del recorrido. */
  const reachedIdx = levels.findIndex((l) => l.level > currentLevel);
  const filled = reachedIdx < 0 ? 1 : reachedIdx / Math.max(1, levels.length);

  return (
    <div
      ref={railRef}
      className="relative -mx-1 overflow-x-auto px-1 pb-2 pt-6"
      style={{ scrollbarWidth: "thin" }}
    >
      <div className="relative flex min-w-max items-start gap-0">
        {/*
          LA VÍA. Una línea apagada de extremo a extremo y, encima, la misma línea encendida
          hasta donde has llegado. Es lo que hace que treinta placas se lean como un camino
          y no como treinta objetos sueltos.
        */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 top-[46px] h-[3px] rounded-full bg-white/[0.09]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-[46px] h-[3px] rounded-full transition-[width] duration-slow ease-out"
          style={{
            width: `${filled * 100}%`,
            background: `linear-gradient(90deg, rgb(${tint} / 0.35), rgb(${tint}))`,
            boxShadow: `0 0 14px rgb(${tint} / 0.8)`,
          }}
        />

        {levels.map((l) => {
          const kind = kindOf(l.reward);
          const milestone = MILESTONE.includes(kind);
          const reached = l.level <= currentLevel;
          const current = l.level === currentLevel;
          // El destino: el primer nivel que todavía no has alcanzado en este carril.
          const isNext = !reached && levels.filter((x) => x.level > currentLevel)[0]?.level === l.level;

          const state = l.claimed ? "claimed" : l.claimable ? "claimable" : reached ? "reached" : "locked";
          const size = milestone ? 62 : 46;

          return (
            <div
              key={l.level}
              data-current={current || undefined}
              className="relative flex w-[92px] shrink-0 flex-col items-center"
            >
              {/* Marcador de posición: dónde estás dentro del recorrido. */}
              {current && (
                <span
                  className="absolute -top-5 font-display text-[9px] font-bold uppercase tracking-[0.16em]"
                  style={{ color: `rgb(${tint})` }}
                >
                  Estás aquí
                </span>
              )}
              {isNext && (
                <span className="nx-label absolute -top-5 !text-[9px]">Siguiente</span>
              )}

              <button
                type="button"
                disabled={!l.claimable || busy}
                onClick={() => onClaim(l.level)}
                aria-label={`Nivel ${l.level}: ${describeReward(l.reward)}`}
                className={cn(
                  "nx-plate nx-clip-sm relative grid shrink-0 place-items-center transition duration-fast",
                  l.claimable && "cursor-pointer hover:brightness-125",
                  !l.claimable && "cursor-default",
                  state === "claimed" && "opacity-45",
                  state === "locked" && "opacity-45",
                )}
                style={{
                  width: size,
                  height: size,
                  marginTop: milestone ? 16 : 24,
                  borderColor:
                    state === "claimable" ? `rgb(${tint})`
                    : reached ? `rgb(${tint} / 0.5)`
                    : "rgba(255,255,255,0.1)",
                  boxShadow:
                    state === "claimable" ? `0 0 26px rgb(${tint} / 0.7), inset 0 1px 0 rgba(255,255,255,0.2)` : undefined,
                  ["--nx-chamfer-sm" as string]: milestone ? "12px" : "8px",
                }}
              >
                {/* El nodo reclamable late. Es el único bucle de la vía. */}
                {state === "claimable" && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -inset-1 motion-safe:animate-pulse-glow"
                    style={{ boxShadow: `0 0 20px 2px rgb(${tint} / 0.55)` }}
                  />
                )}

                {state === "claimed" ? (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : (
                  <RewardGlyph
                    kind={kind}
                    className={milestone ? "h-8 w-8" : "h-6 w-6"}
                  />
                )}
              </button>

              <span
                className={cn(
                  "mt-2 font-display text-[11px] font-bold tabular-nums",
                  current ? "text-white" : reached ? "text-white/60" : "text-white/30",
                )}
              >
                {l.level}
              </span>
              <span className="mt-0.5 px-1 text-center text-[10px] leading-tight text-white/40">
                {describeReward(l.reward)}
              </span>

              {/*
                El estado, en una palabra, y SOLO cuando hay algo que decir. La primera
                version escribia «+7» bajo los niveles lejanos: una cifra sin unidad que no
                significa nada y que, repetida treinta veces, es ruido. Un nodo apagado con
                su numero encima ya dice que esta lejos.
              */}
              {(l.claimed || l.claimable || !open) && (
                <span
                  className={cn(
                    "mt-1 font-display text-[9px] font-bold uppercase tracking-[0.1em]",
                    l.claimable ? "text-ok" : "text-white/25",
                  )}
                >
                  {l.claimed ? "Reclamado" : l.claimable ? "Reclamar" : "Bloqueado"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * EL PRÓXIMO PREMIO.
 *
 * La pieza que faltaba entera. Un pase funciona porque siempre hay algo a un paso; si eso
 * está mezclado con otros veintinueve niveles idénticos, no existe. Aquí se saca fuera:
 * qué es, en qué nivel y cuánto falta.
 */
export function NextReward({
  level, tint, currentLevel,
}: {
  level: PassTrackLevelView | null;
  tint: string;
  currentLevel: number;
}) {
  if (!level) return null;
  const kind = kindOf(level.reward);
  const away = Math.max(0, level.level - currentLevel);

  return (
    <div
      className="nx-clip-sm flex items-center gap-3.5 border px-4 py-3"
      style={{ borderColor: `rgb(${tint} / 0.35)`, background: `rgb(${tint} / 0.07)` }}
    >
      <span
        className="nx-plate nx-clip-sm grid h-12 w-12 shrink-0 place-items-center"
        style={{ borderColor: `rgb(${tint} / 0.6)`, color: `rgb(${tint})` }}
      >
        <RewardGlyph kind={kind} className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <span className="nx-label block">
          {away === 0 ? "Listo para reclamar" : away === 1 ? "A un nivel" : `A ${away} niveles`}
        </span>
        <b className="mt-0.5 block truncate font-display text-[15px] font-bold text-white">
          {describeReward(level.reward)}
        </b>
        <span className="text-[11px] text-white/40">Nivel {level.level}</span>
      </div>
    </div>
  );
}
