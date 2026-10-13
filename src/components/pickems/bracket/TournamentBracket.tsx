"use client";

/**
 * EL CUADRO (Fase 24.3) — rondas de izquierda a derecha, cuadro bajo debajo, líneas encima.
 *
 * ────────────────────────── ESCRITORIO ──────────────────────────
 *
 *   [ CUARTOS ]  [ SEMIS ]  [ FINAL ]  [ GRAN FINAL ]     ← fila alta (o única) + gran final
 *   [ LOWER R1 ] [ LOWER R2 ] [ LOWER FINAL ]             ← fila baja, si existe
 *
 * Todo dentro de un área desplazable propia, con fundidos laterales y una navegación por
 * rondas que lleva a la columna. La página no se desplaza en horizontal.
 *
 * ────────────────────────── MÓVIL ──────────────────────────
 *
 * No se encoge el cuadro: selector de ronda (botones ≥ 44 px, `aria-pressed`) y las cajas de
 * esa ronda en vertical. Sin líneas: una columna sola no tiene con qué conectarse. Es la
 * MISMA lista de partidos y las MISMAS predicciones; solo cambia el reparto.
 *
 * Presentación pura sobre `BracketModel`: no calcula rondas ni aristas.
 */
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/format";
import { useIsNarrow } from "@/lib/useMediaQuery";
import { BracketRound, roundAnchorId } from "./BracketRound";
import { BracketConnectors } from "./BracketConnector";
import { QualifiedNode } from "./QualifiedNode";
import type { PickFeedback } from "@/lib/usePickem";
import { layoutStage, edgeKey, type BracketModel, type BracketMatch, type BracketRound as Round, type QualificationNode } from "@/domain/pickems/bracket";

export function TournamentBracket({
  model, stageId, saving, feedback, readOnly, onPick, onExpire, className, forceMode, changedIds,
}: {
  model: BracketModel;
  stageId: string | null;
  saving: string | null;
  feedback: PickFeedback | null;
  readOnly?: boolean;
  onPick?: (m: BracketMatch, option: string) => void;
  onExpire?: () => void;
  className?: string;
  /** Solo para QA/pruebas sin `matchMedia`: fuerza el reparto. En la app lo decide el viewport. */
  forceMode?: "desktop" | "mobile";
  /** 24.5 · ids de partido / nodo que acaban de cambiar: brillo breve, sin remontar nada. */
  changedIds?: Set<string>;
}) {
  const layout = useMemo(() => layoutStage(model, stageId), [model, stageId]);
  const rounds = useMemo(() => [...layout.upper, ...layout.lower].map((c) => c.round), [layout]);
  const edges = useMemo(() => {
    const ids = new Set(rounds.flatMap((r) => r.matchIds));
    const quals = new Set([...layout.qualifiedUpper, ...layout.qualifiedLower].map((n) => n.id));
    // Aristas de la fase: partido → partido, o partido → nodo de clasificación (24.4), con su procedencia.
    return model.edges
      .filter((e) => ids.has(e.from) && (ids.has(e.to) || quals.has(e.to)))
      .map((e) => ({ ...e, kind: model.edgeMeta[edgeKey(e)]?.kind ?? "RESULT_VERIFIED" as const }));
  }, [model.edges, model.edgeMeta, rounds, layout]);
  const structural = edges.filter((e) => e.kind === "STRUCTURAL").length;
  const narrowByViewport = useIsNarrow();
  const narrow = forceMode ? forceMode === "mobile" : narrowByViewport;
  const scrollRef = useRef<HTMLDivElement>(null);

  /*
   * Ronda visible en móvil (y resaltada en la navegación): la elegida por el jugador si sigue
   * existiendo; si no, la primera con algo abierto o en juego; si no, la primera. Se DERIVA en
   * cada render en vez de fijarse en un efecto: así el primer pintado (y el render estático)
   * ya enseñan una ronda.
   */
  const [chosen, setSelected] = useState<string | null>(null);
  const selected = useMemo(() => {
    if (chosen && rounds.some((r) => r.id === chosen)) return chosen;
    const active = rounds.find((r) => r.matchIds.some((id) => {
      const m = model.matches[id];
      return m.lockState === "open" || m.status === "live";
    }));
    return (active ?? rounds[0])?.id ?? null;
  }, [chosen, rounds, model.matches]);

  const goTo = (r: Round) => {
    setSelected(r.id);
    if (narrow) return;
    const el = document.getElementById(roundAnchorId(r.id));
    const root = scrollRef.current;
    if (el && root) root.scrollTo({ left: el.offsetLeft - 16, behavior: "smooth" });
  };

  if (rounds.length === 0) return null;

  const version = `${rounds.map((r) => r.matchIds.join(",")).join("|")}:${narrow}`;
  const hasLower = layout.lower.length > 0;

  return (
    <div className={cn("nx-bracket", className)} aria-label="Cuadro de eliminatorias">
      {/* ── Navegación por rondas ── */}
      <nav aria-label="Rondas" className="mb-3 flex flex-wrap gap-1.5">
        {rounds.map((r) => {
          const on = r.id === selected;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => goTo(r)}
              aria-pressed={on}
              className={cn(
                "nx-clip-sm nx-focus min-h-[44px] px-3 font-display text-[11px] font-bold uppercase tracking-[0.14em] transition duration-fast motion-reduce:transition-none",
                on ? "bg-drl-cyan/15 text-white" : "bg-white/[0.04] text-ink-secondary hover:bg-white/[0.08]",
              )}
              style={{ boxShadow: on ? "inset 0 0 0 1.5px var(--nx-cyan)" : "inset 0 0 0 1px rgba(255,255,255,0.12)" }}
            >
              {r.side === "lower" && <span className="text-ink-faint">↓ </span>}
              {r.label}{r.group ? ` · ${r.group}` : ""}
            </button>
          );
        })}
      </nav>

      {narrow ? (
        /* ── MÓVIL: una ronda, en vertical ── */
        <div className="space-y-3" data-bracket-mode="mobile">
          {rounds.filter((r) => r.id === selected).map((r) => {
            const col = [...layout.upper, ...layout.lower].find((c) => c.round.id === r.id)!;
            return (
              <BracketRound key={r.id} column={col} compact saving={saving} feedback={feedback} readOnly={readOnly} onPick={onPick} onExpire={onExpire} changedIds={changedIds} />
            );
          })}
          {[...layout.qualifiedUpper, ...layout.qualifiedLower].filter((n) => rounds.some((r) => r.id === selected && r.matchIds.includes(n.fromMatchId))).map((n) => (
            <QualifiedNode key={n.id} node={n} compact highlight={changedIds?.has(n.id)} />
          ))}
          <p className="nx-label">
            {edges.length > 0
              ? `${edges.length} ${edges.length === 1 ? "conexión" : "conexiones"} (${structural} de estructura, ${edges.length - structural} por resultado) · en escritorio se dibujan sobre el cuadro`
              : "Las conexiones se dibujan a medida que el torneo avanza"}
          </p>
        </div>
      ) : (
        /* ── ESCRITORIO: el cuadro entero, desplazable ── */
        <div className="relative" data-bracket-mode="desktop">
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-base-900 to-transparent" />
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-base-900 to-transparent" />
          <div
            ref={scrollRef}
            className="nx-bracket-scroll relative overflow-x-auto overflow-y-hidden px-4 pb-3 pt-1 [scrollbar-width:thin]"
            role="group"
            aria-label="Cuadro, desplazable en horizontal"
            tabIndex={0}
          >
            <div className="relative min-w-max">
              <BracketConnectors containerRef={scrollRef} edges={edges} version={version} />
              <div className="relative flex items-stretch gap-10">
                {layout.upper.map((c, i) => (
                  <BracketRound key={c.round.id} column={c} saving={saving} feedback={feedback} readOnly={readOnly} onPick={onPick} onExpire={onExpire} changedIds={changedIds}
                    className={cn("nx-bracket-enter", hasLower && c.round.side === "grand" && "self-center")}
                    style={{ ["--nx-enter-i" as string]: i }} />
                ))}
                {layout.qualifiedUpper.length > 0 && <QualifiedColumn nodes={layout.qualifiedUpper} index={layout.upper.length} changedIds={changedIds} />}
              </div>
              {hasLower && (
                <div className="relative mt-8 border-t border-dashed border-white/10 pt-6">
                  <span className="nx-label absolute -top-2.5 left-0 bg-base-900 pr-2">Cuadro bajo</span>
                  <div className="relative flex items-stretch gap-10">
                    {layout.lower.map((c, i) => (
                      <BracketRound key={c.round.id} column={c} saving={saving} feedback={feedback} readOnly={readOnly} onPick={onPick} onExpire={onExpire} changedIds={changedIds}
                        className="nx-bracket-enter"
                        style={{ ["--nx-enter-i" as string]: i + layout.upper.length }} />
                    ))}
                    {layout.qualifiedLower.length > 0 && <QualifiedColumn nodes={layout.qualifiedLower} index={layout.lower.length + layout.upper.length} changedIds={changedIds} />}
                  </div>
                </div>
              )}
            </div>
          </div>
          <p className="mt-1 nx-label" data-structural={structural} data-verified={edges.length - structural}>
            {edges.length > 0
              ? `${edges.length} ${edges.length === 1 ? "conexión" : "conexiones"} · ${structural} de estructura confirmada, ${edges.length - structural} por resultado · desplaza para ver todo el cuadro`
              : "Las conexiones se dibujan cuando la fuente confirma quién avanza · desplaza para ver todo el cuadro"}
            {model.conflicts.length > 0 && ` · ${model.conflicts.length} ${model.conflicts.length === 1 ? "conflicto sin pintar" : "conflictos sin pintar"}`}
          </p>
        </div>
      )}
    </div>
  );
}

/** La columna final «Clasificados»: una caja por nodo de clasificación de la rama. */
function QualifiedColumn({ nodes, index, changedIds }: { nodes: QualificationNode[]; index: number; changedIds?: Set<string> }) {
  return (
    <section aria-label="Clasificados" className="nx-bracket-enter flex w-[220px] shrink-0 flex-col gap-4 sm:w-[240px]" style={{ ["--nx-enter-i" as string]: index }}>
      <h3 className="flex items-baseline gap-2">
        <span className="nx-clip-sm px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: "var(--nx-gold)", background: "rgba(6,8,14,0.85)", boxShadow: "inset 0 0 0 1px rgba(255,211,92,0.4)" }}>
          Clasificados
        </span>
        <span className="nx-label">{nodes.length}</span>
      </h3>
      <div className="flex flex-1 flex-col justify-around gap-4">
        {nodes.map((n) => <QualifiedNode key={n.id} node={n} highlight={changedIds?.has(n.id)} />)}
      </div>
    </section>
  );
}
