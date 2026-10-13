"use client";

/**
 * PIEZAS DEL FINAL DE PARTIDA (Fase 26) — compartidas por el resultado PvE y el PvP.
 *
 *   · `FeaturedCardPanel`  «CARTA DESTACADA»: la carta de la partida. Fase 33: la elige
 *                          `cardOfTheMatch` (algoritmo documentado: solo cartas que GANARON su
 *                          turno; margen, valor, turno, uid). Si ninguna ganó, no se inventa una:
 *                          se dice. No es un cálculo de combate, no da nada y no se llama «MVP».
 *   · `DecisionPanel`      cómo se decidió, SOLO si hizo falta un desempate (`decidedBy`).
 *   · `RoundStrip`         historial en miniatura: turno a turno, tus cartas contra las suyas.
 *   · `LevelProgressPanel` el nivel de cuenta a partir de la XP que devuelve el servidor.
 *
 * Nada de esto decide nada: todo son datos ya resueltos, puestos en su sitio.
 */
import { cn } from "@/lib/format";
import { DuelCard } from "./DuelCard";
import { Recessed } from "@/components/ui/Surface";
import { XpProgress } from "@/components/ui/game/XpProgress";
import { decisionCopy, roundVerdict } from "@/lib/duel/gameplayUx";
import { cardOfTheMatch } from "@/lib/duel/experience";
import type { DuelDeckCardDTO, DuelResultView, DuelTurnView } from "@/lib/duel/types";

const TONO = { win: "#3fc07a", loss: "#ff2e63", draw: "#ffd35c" } as const;

export function FeaturedCardPanel({
  history, cards, className,
}: {
  history: DuelTurnView[];
  /** Dónde buscar la carta por `uid`: tus cartas jugadas (y, por si acaso, tu mano). */
  cards: DuelDeckCardDTO[];
  className?: string;
}) {
  const pick = cardOfTheMatch(history);
  const card = pick ? cards.find((c) => c.uid === pick.uid) ?? null : null;
  if (history.length === 0) return null;
  if (!pick || !card) {
    return (
      <p className={cn("text-caption text-ink-muted", className)} data-featured="none">
        Carta destacada: sin carta de la partida, porque ninguna de tus cartas ganó su turno.
      </p>
    );
  }
  return (
    <section
      aria-label="Carta destacada"
      data-featured={card.uid}
      className={cn("nx-clip-sm flex items-center gap-4 border border-drl-gold/35 bg-drl-gold/[0.06] px-4 py-3", className)}
    >
      <div style={{ filter: "drop-shadow(0 0 18px rgba(255,211,92,0.35))" }}>
        <DuelCard card={card} size="sm" highlightStat={history.find((t) => t.number === pick.turn)?.you.stat ?? null} />
      </div>
      <div className="min-w-0">
        <span className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-drl-gold">Carta destacada</span>
        <b className="mt-1 block truncate font-display text-h3 font-bold uppercase text-white">{card.nick}</b>
        <p className="mt-0.5 text-caption leading-relaxed text-ink-secondary">{pick.why}</p>
      </div>
    </section>
  );
}

export function DecisionPanel({ result, className }: { result: DuelResultView; className?: string }) {
  const d = decisionCopy(result);
  if (!d.tiebreak) return null;
  return (
    <Recessed depth="sm" className={cn("border-l-2 border-l-drl-gold px-4 py-2.5", className)} role="note" aria-label="Cómo se decidió">
      <b className="block font-display text-body font-bold uppercase tracking-wide text-white">{d.title}</b>
      {d.lines.map((l) => (
        <p key={l} className="mt-0.5 text-caption leading-relaxed text-ink-secondary">{l}</p>
      ))}
    </Recessed>
  );
}

/**
 * HISTORIAL EN MINIATURA. Una casilla por turno, en fila desplazable en móvil: número, tus
 * miniaturas y las suyas, y el veredicto por color y letra (G/P/E). Es el resumen visual de la
 * partida; el detalle con cifras sigue en `TurnHistory`.
 */
export function RoundStrip({
  history, yours, theirs, className,
}: {
  history: DuelTurnView[];
  yours: DuelDeckCardDTO[];
  theirs: DuelDeckCardDTO[];
  className?: string;
}) {
  if (history.length === 0) return null;
  const find = (pool: DuelDeckCardDTO[], uid: string) => pool.find((c) => c.uid === uid) ?? null;
  return (
    <ol className={cn("flex gap-1.5 overflow-x-auto pb-1", className)} aria-label="Historial por turnos">
      {history.map((t) => {
        const v = roundVerdict(t);
        const tono = TONO[v.kind];
        const yc = find(yours, t.you.uid);
        const rc = find(theirs, t.rival.uid);
        return (
          <li
            key={t.number}
            className="nx-clip-sm flex w-[64px] shrink-0 flex-col items-center gap-1 border px-1 py-1.5"
            style={{ borderColor: `${tono}55`, background: `${tono}0d` }}
            title={`Turno ${t.number}: ${v.title} · ${v.detail}`}
          >
            <span className="nx-label !text-[9px]">T{t.number}</span>
            {rc ? <DuelCard card={rc} size="xs" className="!w-[40px]" /> : <span className="h-[56px] w-[40px] rounded bg-white/5" />}
            <b className="font-display text-[11px] font-bold" style={{ color: tono }}>
              {v.kind === "win" ? "G" : v.kind === "loss" ? "P" : "E"}
            </b>
            {yc ? <DuelCard card={yc} size="xs" className="!w-[40px]" /> : <span className="h-[56px] w-[40px] rounded bg-white/5" />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * NIVEL DE CUENTA. La XP TOTAL la devuelve el servidor (`/api/game/state`); el nivel se deriva con
 * la curva del dominio de progresión, la misma que usan la cuenta y la home. `gained` es la XP que
 * esta partida ha dado (del `award` del servidor), para enseñar cuánto de la barra es de hoy.
 */
/**
 * Fase 44 · la barra ANIMA del valor anterior real (`xp − gained`) al nuevo real (`xp`), tramo a tramo si se cruzan
 * niveles, y anuncia SUBIDA DE NIVEL solo si de verdad cambió el nivel (`XpProgress` + `xpTimeline`). Antes, al
 * cruzar un nivel, el tramo «ganado» se calculaba en negativo y pintaba la barra entera como ganada.
 */
export function LevelProgressPanel({ xp, gained, className }: { xp: number; gained: number; className?: string }) {
  return <XpProgress xp={xp} gained={gained} className={className} label="Nivel" />;
}
