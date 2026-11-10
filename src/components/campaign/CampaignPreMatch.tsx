"use client";

/**
 * PRE-PARTIDA DE CAMPAÑA (Fase 35) — la PreMatch 3.0 con contexto: ROAD TO CHAMPIONS / CAPÍTULO X / NODO,
 * TU EQUIPO VS RIVAL. No hay selector de dificultad ni de rival: los fija el nodo y los valida el servidor.
 * El versus reutiliza `PreMatchVersus` (el rival sigue oculto: su mazo se descubre jugando).
 */
import Link from "next/link";
import { cn } from "@/lib/format";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Plate, Recessed } from "@/components/ui/Surface";
import { PreMatchVersus } from "@/components/duel/experience/PreMatchVersus";
import { deckReadiness } from "@/lib/duel/gameplayUx";
import type { DuelDeckDTO } from "@/lib/duel/types";
import type { CampaignNodeView, CampaignSnapshot } from "@/domain/campaign/snapshot";
import { STATUS_LABEL, campaignNodeHref, lockReason, nodeCode } from "@/lib/campaign/presentation";
import { CHAPTER_THEME, NodeGlyph } from "./CampaignMap";
import { PreMatchStrategy } from "@/components/duel/strategy/PreMatchStrategy";
import { playerMessage } from "@/components/ui/game/GameStates";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("campaign");

export function CampaignPreMatch({
  snapshot, node, decks, deckId, onDeck, onStart, busy, error, onHelp, activeDeckId = null,
}: {
  snapshot: CampaignSnapshot;
  node: CampaignNodeView;
  decks: DuelDeckDTO[];
  deckId: string | null;
  onDeck: (id: string) => void;
  onStart: () => void;
  busy: boolean;
  error: string | null;
  onHelp?: () => void;
  activeDeckId?: string | null;
}) {
  useLocale();
  const chapter = snapshot.chapters.find((c) => c.id === node.chapterId);
  const theme = CHAPTER_THEME[chapter?.theme ?? ""] ?? CHAPTER_THEME.clasificatorio;
  const chosen = decks.find((d) => d.id === deckId) ?? null;
  const readiness = chosen ? deckReadiness(chosen) : null;
  const locked = node.status === "LOCKED" || !snapshot.available;
  const canStart = Boolean(chosen && readiness?.ready) && !busy && !locked && node.opponent.playable;
  const replay = node.status === "COMPLETED";

  return (
    <div data-scene="campaign-prematch" data-node={node.id}>
      <header className="mb-5">
        <div className="flex items-center justify-between gap-2">
          <Link href={campaignNodeHref(node.id)} className="nx-focus -ml-2 inline-flex min-h-[44px] items-center rounded-control px-2 font-display text-label uppercase tracking-wide2 text-ink-muted transition duration-fast hover:bg-white/[0.06] hover:text-white">
            {t("‹ Road to Champions")}
          </Link>
          {onHelp && (
            <button type="button" onClick={onHelp} aria-label={t("Cómo se juega")} className="nx-focus grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/[0.04] font-display text-[15px] font-bold text-white/75 transition hover:bg-white/[0.1] hover:text-white">
              ?
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center gap-4">
          <NodeGlyph node={node} rgb={theme.rgb} size={node.type === "BOSS" ? 76 : 60} />
          <div className="min-w-0">
            <p className="nx-label" style={{ color: `rgb(${theme.rgb})` }}>
              {t("Road to Champions · Capítulo")} {node.chapterOrder} {t("· Nodo")} {nodeCode(node)} · {td(node.typeLabel)}
            </p>
            <h1 className="font-display text-[clamp(28px,4.6vw,44px)] font-bold uppercase leading-none text-white">{node.name}</h1>
            <p className="mt-1 text-caption text-ink-muted">{t("Estado:")} {td(STATUS_LABEL[node.status])} · {td(node.objective)}</p>
          </div>
        </div>
      </header>

      {chosen && (
        <PreMatchVersus deck={chosen} rival={{ kind: "BOT", label: `${node.opponent.name} · ${node.botLabel}` }} className="mb-4" />
      )}
      {/* Fase 43 · perfil del PROPIO equipo antes del nodo; el mazo del rival no se analiza (se descubre jugando). */}
      {chosen?.valid && <PreMatchStrategy cards={chosen.cards} className="mb-4" />}

      <div className="grid gap-3 md:grid-cols-2">
        <Plate className="px-4 py-3" data-testid="campaign-rival">
          <span className="nx-label">{t("Rival")}</span>
          <p className="font-display text-[20px] font-bold uppercase leading-tight text-white">{node.opponent.playable ? node.opponent.name : t("No disponible")}</p>
          {node.opponent.playable && (
            <p className="mt-1 text-caption leading-relaxed text-ink-secondary">
              {t("{n} del roster actual + {m} refuerzos de {region} · {clase} · Σ {ovr}", { n: node.opponent.coreCount, m: node.opponent.reinforcements, region: td(node.opponent.region), clase: td(node.opponent.cardTierLabel), ovr: node.opponent.sumOvr })}
            </p>
          )}
          <p className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="info">{t("Dificultad")} {td(node.tierLabel)}</Badge>
            <Badge tone="muted">{t("Bot")} {td(node.botLabel)}</Badge>
            {node.type === "BOSS" && <Badge tone="gold">{t("Jefe de capítulo")}</Badge>}
          </p>
        </Plate>
        <Plate className="px-4 py-3">
          <span className="nx-label">{t("Recompensa")}</span>
          {node.firstClearDone
            ? <p className="mt-0.5 text-body text-[#6fe0a0]">{t("Primera victoria conseguida. Rejugar no la repite.")}</p>
            : <p className="mt-0.5 text-body text-white">{fill(t("{premio} la primera vez que ganes este nodo.", slots("premio")), { premio: <b className="text-drl-gold">{t("+{n} créditos", { n: node.firstClearCredits })}</b> })}</p>}
          <p className="mt-1 text-caption text-ink-muted">{t("La partida paga además como cualquier duelo, con el tope diario de siempre. No afecta a tu rating.")}</p>
        </Plate>
      </div>

      <section aria-label={t("Elegir equipo")} className="mt-5">
        <h2 className="nx-label mb-2">{t("Tu equipo")}</h2>
        {decks.length === 0 ? (
          <Recessed className="flex flex-col gap-3 border-l-2 border-l-drl-gold px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="status">
            <p className="text-caption text-ink-secondary">{t("No tienes ningún equipo. Necesitas diez cartas, dos por rol.")}</p>
            <NxButton variant="secondary" size="md" href="/duelos/mazos?nuevo=1">{t("Crear equipo")}</NxButton>
          </Recessed>
        ) : (
          <div className="flex flex-wrap gap-2">
            {decks.map((d) => {
              const r = deckReadiness(d);
              const on = d.id === deckId;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onDeck(d.id)}
                  aria-pressed={on}
                  className={cn("nx-focus nx-clip-sm min-h-[44px] border px-3 py-2 text-left transition duration-fast", on ? (r.ready ? "border-drl bg-drl/10" : "border-drl-gold/70 bg-drl-gold/10") : "border-edge bg-white/[0.03] hover:border-white/25")}
                >
                  <b className="block font-display text-[14px] font-bold uppercase text-white">{d.name}</b>
                  <span className="text-caption text-ink-muted">
                    Σ {d.sumOvr} · {r.ready ? t("Listo") : t("Incompleto")}{d.id === activeDeckId ? (" " + t("· Activo")) : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {chosen && readiness && !readiness.ready && (
          <Recessed className="mt-3 flex flex-col gap-3 border-l-2 border-l-drl-gold px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="status">
            <p className="text-caption text-ink-secondary">{t("«{nombre}» no es un equipo válido: {motivo}.", { nombre: chosen.name, motivo: td(readiness.summary) })}</p>
            <NxButton variant="secondary" size="md" href={`/duelos/mazos?deck=${chosen.id}`}>{t("Editar equipo")}</NxButton>
          </Recessed>
        )}
      </section>

      {locked && (
        <p role="status" className="mt-4 border-l-2 border-drl-gold px-3 py-2 text-caption text-drl-gold">{lockReason(snapshot, node) ?? t("Este nodo no se puede jugar ahora.")}</p>
      )}
      {error && <p role="alert" className="nx-clip-sm mt-4 border border-drl/40 bg-drl/10 px-3 py-2 text-body text-drl-glow">{playerMessage(error)}</p>}

      <NxButton variant="primary" size="lg" block className="mt-5" onClick={onStart} disabled={!canStart} aria-disabled={!canStart} data-testid="campaign-start">
        {busy ? t("Preparando…") : replay ? t("Rejugar nodo") : t("Jugar nodo")}
      </NxButton>
    </div>
  );
}
