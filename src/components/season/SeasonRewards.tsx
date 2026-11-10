"use client";

/**
 * FASE 52 · CAMINO DE RECOMPENSAS — el pase de temporada como un recorrido, no como una tabla.
 *
 * Dos carriles REALES alineados por nivel (libre y competitivo, `SeasonPassView.tracks`), el nivel actual en
 * el centro al abrir, los anteriores a la izquierda y lo que viene a la derecha. Cada nodo enseña la
 * recompensa tal cual la define la temporada (`data/season.ts` vía la foto del servidor):
 *
 *   · sobre   → el ARTE REAL del sobre (`packArtwork`), con su número;
 *   · créditos → la moneda DRL (`DrlCoin`, la identidad de DRL Credits) y la cantidad;
 *   · carta    → la carta real con `CardArt` (hoy ningún carril la da, pero el camino está hecho).
 *
 * Estados, solo los que existen: RECLAMADO · RECLAMABLE · CERRADO (carril competitivo antes de Oro) ·
 * BLOQUEADO. Reclamar no ocurre aquí: vive en `/logros` (idempotente en servidor) y el nodo enlaza allí.
 * Nada de esto decide nada: la foto del servidor manda.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { cn } from "@/lib/format";
import { packArtwork } from "@/data/packArtwork";
import { getPack } from "@/data/packs";
import { getCard, getPlayer } from "@/data/catalog";
import { CardArt } from "@/components/cards/CardArt";
import { DrlCoin } from "@/components/credits/CreditsPieces";
import type { Reward } from "@/battlepass";
import type { SeasonPassView } from "@/server/services/season";
import { rewardParts, trackColumns, focusColumnIndex, type NodeState, type TrackNode } from "@/domain/season/hubView";
import { GameGlyph } from "@/components/ui/game/GameGlyph";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill as fillRich, slots } from "@/i18n/rich";

const t = ns("season");

/** Como DRL Credits (`formatAmount`): agrupación SIEMPRE («1.500», no «1500»). */
const fmt = (n: number) => new Intl.NumberFormat(getIntlLocale(), { useGrouping: "always" }).format(n);

/** Nombre legible de una recompensa, hecho de sus partes reales (para aria y fichas). */
export function rewardLabel(r: Reward | null | undefined): string {
  const parts = rewardParts(r).map((p) => {
    if (p.kind === "pack") return `${p.count > 1 ? `${p.count}× ` : ""}${td(getPack(p.packId)?.name) ?? t("sobre {id}", { id: p.packId })}`;
    if (p.kind === "credits") return t("{amount} créditos", { amount: fmt(p.amount) });
    if (p.kind === "card") { const c = getCard(p.cardId); const pl = c ? getPlayer(c.playerId) : null; return t("carta {nick}", { nick: pl?.nick ?? p.cardId }); }
    return t("{amount} XP de cuenta", { amount: fmt(p.amount) });
  });
  return parts.length ? parts.join(" + ") : t("Sin recompensa");
}

/**
 * La recompensa DIBUJADA con sus assets reales. `size` es el alto del arte principal en px (se reservan
 * las dimensiones: sin saltos de maquetación mientras cargan).
 */
export function RewardVisual({ reward, size = 72, dim = false }: { reward: Reward | null | undefined; size?: number; dim?: boolean }) {
  const parts = rewardParts(reward);
  const main = parts.find((p) => p.kind === "card" || p.kind === "pack") ?? null;
  const credits = parts.find((p) => p.kind === "credits");
  return (
    <span className={cn("flex flex-col items-center gap-1", dim && "opacity-45 grayscale")} data-reward-kinds={parts.map((p) => p.kind).join(",")}>
      {main?.kind === "pack" && (
        <span className="relative inline-block" style={{ height: size, width: Math.round((size * 780) / 1140) }}>
          {packArtwork(main.packId)
            ? <img src={packArtwork(main.packId)!} alt="" width={Math.round((size * 780) / 1140)} height={size} loading="lazy" decoding="async" className="h-full w-full object-contain drop-shadow-[0_8px_14px_rgba(0,0,0,0.6)]" data-pack-art={main.packId} />
            : <span className="grid h-full w-full place-items-center rounded-sm border border-white/20 font-display text-[10px] uppercase text-white/70">{getPack(main.packId)?.name ?? main.packId}</span>}
          {main.count > 1 && <b className="absolute -right-2 -top-1 rounded-full bg-[#ffd35c] px-1.5 font-display text-[11px] leading-5 text-[#1a1204]">×{main.count}</b>}
        </span>
      )}
      {main?.kind === "card" && (() => {
        const c = getCard(main.cardId);
        return c?.image ? <span style={{ height: size, width: Math.round((size * 750) / 1048) }} className="inline-block"><CardArt src={c.image} alt="" shadow="rest" /></span> : null;
      })()}
      {credits && (
        <span className={cn("inline-flex items-center gap-1 font-display font-extrabold tabular-nums text-[#ffd35c]", main ? "text-[12px]" : "text-[15px]")}>
          {!main && <span className="text-[#ffd35c]" style={{ lineHeight: 0 }}><DrlCoin size={Math.round(size * 0.55)} /></span>}
          {main && <DrlCoin size={14} />}
          {fmt(credits.amount)}
        </span>
      )}
    </span>
  );
}

const STATE_LABEL: Record<NodeState, string> = {
  CLAIMED: "Reclamado", CLAIMABLE: "Reclamable", LANE_LOCKED: "Carril cerrado", LOCKED: "Bloqueado",
};

function nodeClasses(state: NodeState, lane: "free" | "competitive", selected: boolean): string {
  const tint = lane === "free" ? "47,224,255" : "255,46,140";
  return cn(
    "nx-focus group relative flex h-[128px] w-full flex-col items-center justify-center gap-1 overflow-hidden px-1.5 pb-5 pt-2 transition-[transform,box-shadow,background-color] duration-200 motion-safe:hover:-translate-y-0.5",
    state === "CLAIMABLE" && "bg-[rgba(255,211,92,0.10)] shadow-[inset_0_0_0_1.5px_rgba(255,211,92,0.9),0_0_22px_-6px_rgba(255,211,92,0.9)]",
    state === "CLAIMED" && `bg-[rgba(${tint},0.06)] shadow-[inset_0_0_0_1px_rgba(${tint},0.35)]`,
    (state === "LOCKED" || state === "LANE_LOCKED") && "bg-white/[0.025] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]",
    selected && "!shadow-[inset_0_0_0_2px_rgba(255,255,255,0.95),0_0_24px_-6px_rgba(47,224,255,0.9)]",
  );
}

export function SeasonRewardTrack({ pass }: { pass: SeasonPassView }) {
  useLocale();
  const cols = useMemo(() => trackColumns(pass), [pass]);
  const focusIdx = focusColumnIndex(cols);
  const scroller = useRef<HTMLDivElement>(null);
  const colRefs = useRef<(HTMLLIElement | null)[]>([]);
  const inicial: TrackNode | null = (() => {
    const nr = pass.nextReward;
    if (nr) { const c = cols.find((x) => x.level === nr.level); const n = nr.track === "free" ? c?.free : c?.competitive; if (n) return n; }
    return cols[focusIdx]?.free ?? cols[focusIdx]?.competitive ?? null;
  })();
  const [sel, setSel] = useState<TrackNode | null>(inicial);

  /* Abrir el carril con el nivel actual centrado. Sin `scrollIntoView`: movería la página entera. */
  const centrar = (i: number, smooth: boolean) => {
    const sc = scroller.current; const col = colRefs.current[i];
    if (!sc || !col) return;
    const left = col.offsetLeft - sc.clientWidth / 2 + col.clientWidth / 2;
    sc.scrollTo({ left: Math.max(0, left), behavior: smooth ? "smooth" : "auto" });
  };
  useEffect(() => { centrar(focusIdx, false); }, [focusIdx]);

  /* Teclado: ← → dentro de un carril; ↑ ↓ cambia de carril en el mismo nivel. */
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number, lane: "free" | "competitive") => {
    const move = (ni: number, nl: "free" | "competitive") => {
      const el = scroller.current?.querySelector<HTMLButtonElement>(`[data-node="${nl}-${cols[ni]?.level}"]`);
      if (el) { e.preventDefault(); el.focus(); }
    };
    if (e.key === "ArrowRight") { for (let k = i + 1; k < cols.length; k++) if (cols[k][lane]) return move(k, lane); }
    if (e.key === "ArrowLeft") { for (let k = i - 1; k >= 0; k--) if (cols[k][lane]) return move(k, lane); }
    if (e.key === "ArrowDown" && lane === "free" && cols[i].competitive) move(i, "competitive");
    if (e.key === "ArrowUp" && lane === "competitive" && cols[i].free) move(i, "free");
  };

  const reached = cols.filter((c) => c.level <= pass.level).length;
  const fill = cols.length > 1 ? Math.min(1, (reached - 0.5 + pass.progress * 0.999) / cols.length) : 0;

  return (
    <section aria-labelledby="reward-track-title" data-testid="reward-track" className="nx-clip relative overflow-hidden border border-white/10 bg-[linear-gradient(180deg,rgba(10,14,26,0.96),rgba(5,7,13,0.98))]">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(47,224,255,0.8),rgba(255,211,92,0.8),transparent)]" />
      <header className="flex flex-wrap items-end justify-between gap-3 px-4 pt-5 sm:px-6">
        <div>
          <p className="nx-label !text-[#2fe0ff]">{t("Pase · {nombre}", { nombre: pass.name })}</p>
          <h2 id="reward-track-title" className="mt-1 font-display text-[clamp(22px,2.6vw,32px)] font-extrabold uppercase leading-none text-white">{t("Camino de recompensas")}</h2>
          <p className="mt-1.5 text-[13px] text-white/60">
            {fillRich(t("Nivel {nivel} de {max} · cada nivel del carril libre da recompensa; el competitivo se abre en Oro.", { ...slots("nivel"), max: pass.maxLevel }), { nivel: <b className="text-white">{pass.level}</b> })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/60" aria-label={t("Leyenda")}>
            <li className="flex items-center gap-1"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-[#ffd35c]" />{t("Reclamable")}</li>
            <li className="flex items-center gap-1"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-[#3fd696]" />{t("Reclamado")}</li>
            <li className="flex items-center gap-1"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-white/25" />{t("Bloqueado")}</li>
          </ul>
          <button type="button" onClick={() => centrar(focusIdx, true)} className="nx-focus min-h-[40px] border border-[rgba(47,224,255,0.45)] px-3 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-[#2fe0ff] hover:bg-[rgba(47,224,255,0.08)]" data-testid="track-jump">
            {t("Ir a mi nivel")}
          </button>
        </div>
      </header>

      <div className="relative mt-4">
        {/* Etiquetas de carril, fijas a la izquierda (no se desplazan). */}
        <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 top-[52px] z-10 hidden w-[88px] flex-col gap-2 bg-[linear-gradient(90deg,rgba(5,7,13,0.98)_70%,transparent)] pl-4 sm:flex">
          <span className="flex h-[128px] items-center font-display text-[10px] font-bold uppercase tracking-[0.2em] text-[#2fe0ff]">{t("Libre")}</span>
          <span className="flex h-[128px] items-center font-display text-[10px] font-bold uppercase tracking-[0.2em] text-[#ff5aa8]">{t("Compe­titivo")}</span>
        </div>
        <div ref={scroller} className="overflow-x-auto overscroll-x-contain px-4 pb-4 sm:pl-[96px] sm:pr-6 motion-safe:scroll-smooth [scrollbar-width:thin]" data-testid="track-scroller" role="region" aria-label={t("Niveles del pase, desplazable")}>
          <ol className="relative flex w-max gap-2">
            {/* El raíl de progreso bajo las medallas. */}
            <span aria-hidden className="absolute left-0 right-0 top-[21px] h-[3px] rounded-full bg-white/10" />
            <span aria-hidden className="absolute left-0 top-[21px] h-[3px] rounded-full bg-[linear-gradient(90deg,#2fe0ff,#ffd35c)] shadow-[0_0_10px_rgba(47,224,255,0.8)]" style={{ width: `${fill * 100}%` }} />
            {cols.map((c, i) => (
              <li key={c.level} ref={(el) => { colRefs.current[i] = el; }} className="relative flex w-[108px] shrink-0 flex-col gap-2 sm:w-[118px]" data-level={c.level} data-current={c.current || undefined}>
                <span className="flex h-[44px] items-center justify-center">
                  <span
                    className={cn(
                      "relative grid place-items-center rounded-full font-display font-extrabold tabular-nums",
                      c.current ? "h-11 w-11 bg-[#2fe0ff] text-[17px] text-[#021420] shadow-[0_0_0_4px_rgba(47,224,255,0.25),0_0_24px_rgba(47,224,255,0.9)]"
                        : c.level < pass.level ? "h-8 w-8 bg-[#0e2a36] text-[12px] text-[#2fe0ff] shadow-[inset_0_0_0_1.5px_rgba(47,224,255,0.7)]"
                          : "h-8 w-8 bg-[#0b0f1a] text-[12px] text-white/50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]",
                    )}
                    aria-label={c.current ? t("Nivel {level}, tu nivel actual", { level: c.level }) : t("Nivel {level}", { level: c.level })}
                  >
                    {c.level}
                    {c.current && <span className="absolute -bottom-4 font-display text-[9px] font-bold tracking-[0.2em] text-[#2fe0ff]">{t("TÚ")}</span>}
                  </span>
                </span>
                {(["free", "competitive"] as const).map((lane) => {
                  const n = c[lane];
                  if (!n) return <span key={lane} aria-hidden className="h-[128px]" />;
                  const selected = sel?.level === n.level && sel.track === n.track;
                  return (
                    <button
                      key={lane}
                      type="button"
                      data-node={`${lane}-${n.level}`}
                      data-state={n.state}
                      aria-pressed={selected}
                      aria-label={t("Nivel {level}, carril {v}: {reward}. {v2}.", { level: n.level, v: lane === "free" ? t("libre") : t("competitivo"), reward: rewardLabel(n.reward), v2: td(STATE_LABEL[n.state]) })}
                      onClick={() => setSel(n)}
                      onKeyDown={(e) => onKey(e, i, lane)}
                      className={nodeClasses(n.state, lane, selected)}
                    >
                      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[2px]", lane === "free" ? "bg-[#2fe0ff]/60" : "bg-[#ff2e8c]/60")} />
                      {/* En móvil no hay columna de rótulos: el carril se dice dentro del nodo. */}
                      <span aria-hidden className={cn("absolute left-1.5 top-1 font-display text-[8.5px] font-bold uppercase tracking-[0.14em] sm:hidden", lane === "free" ? "text-[#2fe0ff]/80" : "text-[#ff5aa8]/80")}>{lane === "free" ? t("Libre") : t("Compet.")}</span>
                      <RewardVisual reward={n.reward} size={70} dim={n.state === "LOCKED" || n.state === "LANE_LOCKED"} />
                      <span className={cn(
                        "absolute inset-x-0 bottom-0 py-1 text-center font-display text-[9.5px] font-bold uppercase tracking-[0.14em]",
                        n.state === "CLAIMABLE" ? "bg-[#ffd35c] text-[#1a1204]" : n.state === "CLAIMED" ? "text-[#3fd696]" : "text-white/40",
                      )}>
                        {n.state === "CLAIMED" ? t("✓ Reclamado") : n.state === "CLAIMABLE" ? t("Reclamar") : n.state === "LANE_LOCKED" ? <><GameGlyph name="lock" className="mr-1 align-[-2px]" />{t("Oro")}</> : <GameGlyph name="lock" title={t("Bloqueado")} />}
                      </span>
                    </button>
                  );
                })}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {sel && <RewardDetail node={sel} pass={pass} />}
    </section>
  );
}

/** La ficha de la recompensa seleccionada: el asset grande, lo que es y qué falta. Nada inventado. */
function RewardDetail({ node, pass }: { node: TrackNode; pass: SeasonPassView }) {
  useLocale();
  const lane = node.track === "free" ? t("Carril libre") : t("Carril competitivo");
  const faltaXp = node.level === pass.level + 1 ? Math.max(0, pass.xpForNext - pass.xpIntoLevel) : null;
  const frase =
    node.state === "CLAIMED" ? t("Ya la reclamaste.")
      : node.state === "CLAIMABLE" ? t("La tienes desbloqueada: reclámala en Logros y pase.")
        : node.state === "LANE_LOCKED" ? t("El carril competitivo se abre al llegar a Oro ({competitiveMinPoints} puntos; tienes {points}).", { competitiveMinPoints: fmt(pass.competitiveMinPoints), points: fmt(pass.points) })
          : faltaXp !== null ? t("Te faltan {faltaXp} XP de pase para el nivel {level}.", { faltaXp: fmt(faltaXp), level: node.level })
            : t("Se desbloquea en el nivel {level}.", { level: node.level });
  return (
    <div className="flex flex-wrap items-center gap-5 border-t border-white/10 bg-black/30 px-4 py-4 sm:px-6" data-testid="reward-detail" aria-live="polite">
      <RewardVisual reward={node.reward} size={104} />
      <div className="min-w-0 flex-1">
        <p className="nx-label">{td(lane)} {t("· Nivel")} {node.level}</p>
        <p className="mt-1 font-display text-[18px] font-extrabold uppercase leading-tight text-white">{rewardLabel(node.reward)}</p>
        <p className={cn("mt-1 text-[13.5px]", node.state === "CLAIMABLE" ? "text-[#ffd35c]" : node.state === "CLAIMED" ? "text-[#3fd696]" : "text-white/65")}>{td(frase)}</p>
      </div>
      {node.state === "CLAIMABLE" && (
        <Link href="/logros" className="nx-focus inline-flex min-h-[44px] items-center bg-[#ffd35c] px-5 font-display text-[12px] font-extrabold uppercase tracking-[0.16em] text-[#1a1204] hover:brightness-110" data-testid="claim-link">
          {t("Reclamar en Logros →")}
        </Link>
      )}
    </div>
  );
}
