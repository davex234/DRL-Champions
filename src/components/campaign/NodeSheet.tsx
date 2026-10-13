"use client";

/**
 * DETALLE DE NODO (Fase 35) — panel lateral en escritorio, hoja inferior en móvil. Diálogo accesible: foco al
 * abrir, Tab atrapado dentro, Escape cierra y el foco vuelve al nodo.
 *
 * Cuenta rival, dificultad, estado, objetivo, tu equipo, recompensa de primera victoria, mejor resultado e
 * intentos. La acción la decide `nodeCta` con lo que dijo el servidor; el servidor vuelve a validar al lanzar.
 */
import { useEffect, useRef } from "react";
import { cn } from "@/lib/format";
import { NxButton } from "@/components/ui/NxButton";
import type { CampaignNodeView, CampaignSnapshot } from "@/domain/campaign/snapshot";
import { OUTCOME_LABEL, STATUS_LABEL, nodeCode, nodeCta, type DeckLite } from "@/lib/campaign/presentation";
import { CHAPTER_THEME, NodeGlyph } from "./CampaignMap";
import { playerMessage } from "@/components/ui/game/GameStates";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("campaign");

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function NodeSheet({
  snapshot, node, deck, decksKnown, signedIn, online, onClose, onAbandon, busy = false, error = null,
}: {
  snapshot: CampaignSnapshot;
  node: CampaignNodeView;
  deck: DeckLite | null;
  decksKnown: boolean;
  signedIn: boolean;
  online: boolean;
  onClose: () => void;
  onAbandon?: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  useLocale();
  const panel = useRef<HTMLDivElement>(null);
  const chapter = snapshot.chapters.find((c) => c.id === node.chapterId);
  const theme = CHAPTER_THEME[chapter?.theme ?? ""] ?? CHAPTER_THEME.clasificatorio;
  const cta = nodeCta({ snapshot, node, signedIn, online, deck, decksKnown });

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); returnTo?.focus?.(); };
  }, [node.id, onClose]);

  const o = node.opponent;
  const showAbandon = !!onAbandon && (cta.kind === "RESUME" || cta.kind === "BUSY_ELSEWHERE");

  return (
    <div className="fixed inset-0 z-[60]" data-testid="node-sheet" data-node={node.id}>
      <button type="button" tabIndex={-1} aria-hidden className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="node-sheet-title"
        className={cn(
          "absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto border-t bg-[#080b13] px-5 pt-4 shadow-[0_-20px_60px_rgba(0,0,0,0.6)]",
          "md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[440px] md:border-l md:border-t-0 md:pt-6",
        )}
        style={{ borderColor: `rgba(${theme.rgb},0.35)`, paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))" }}
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-white/20 md:hidden" />
        <div className="flex items-start justify-between gap-3">
          <p className="nx-label" style={{ color: `rgb(${theme.rgb})` }}>
            {t("Capítulo")} {node.chapterOrder} {t("· Nodo")} {nodeCode(node)} · {td(node.typeLabel)}
          </p>
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            aria-label={t("Cerrar detalle del nodo")}
            className="nx-focus -mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-control text-white/70 hover:bg-white/[0.08] hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mt-1 flex items-center gap-4">
          <NodeGlyph node={node} rgb={theme.rgb} size={node.type === "BOSS" ? 72 : 58} />
          <div className="min-w-0">
            <h2 id="node-sheet-title" className="font-display text-[26px] font-bold uppercase leading-none text-white">{node.name}</h2>
            <p className="mt-1.5 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-white/70" data-testid="node-status">
              {t("Estado:")} {td(STATUS_LABEL[node.status])}{node.isNext ? (" " + t("· Siguiente")) : ""}
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 text-body">
          <Row label={t("Rival")}>
            {o.playable ? (
              <>
                <b className="text-white">{td(o.name)}</b> <span className="text-white/50">({o.tag} · {td(o.region)})</span>
                <span className="mt-0.5 block text-caption text-ink-muted">
                  {t("{n} jugadores del roster actual + {m} refuerzos reales de {region}. {clase}. Fuerza Σ {ovr}.", { n: o.coreCount, m: o.reinforcements, region: td(o.region), clase: td(o.cardTierLabel), ovr: o.sumOvr })}
                </span>
              </>
            ) : (
              <span className="text-drl-gold">{t("No disponible con el catálogo actual.")}</span>
            )}
          </Row>
          <Row label={t("Dificultad")}>
            <b className="text-white">{td(node.tierLabel)}</b> <span className="text-white/60">{t("· bot")} {td(node.botLabel)}</span>
            <span className="mt-0.5 block text-caption text-ink-muted">{t("El bot nunca ve tus cartas sin jugar. Mismas reglas que cualquier duelo.")}</span>
          </Row>
          <Row label={t("Objetivo")}>{td(node.objective)}</Row>
          <Row label={t("Tu equipo")}>
            {!signedIn ? <span className="text-ink-muted">{t("Inicia sesión para usar tu equipo.")}</span>
              : deck ? (
                <>
                  <b className="text-white">{deck.name}</b> <span className="text-white/60">· Σ {deck.sumOvr}</span>{" "}
                  <span className={deck.valid ? "text-[#6fe0a0]" : "text-drl-gold"}>{deck.valid ? t("· Listo") : t("· No válido")}</span>
                </>
              ) : decksKnown ? <span className="text-drl-gold">{t("Sin equipo válido todavía.")}</span> : <span className="text-ink-muted">{t("Leyendo tus equipos…")}</span>}
          </Row>
          <Row label={t("Primera victoria")}>
            {node.firstClearDone
              ? <span className="text-[#6fe0a0]">{t("Conseguida · +{n} créditos ya cobrados", { n: node.firstClearCredits })}</span>
              : <span><b className="text-drl-gold">{t("+{n} créditos", { n: node.firstClearCredits })}</b> <span className="text-ink-muted">{t("una sola vez")}</span></span>}
            <span className="mt-0.5 block text-caption text-ink-muted">{t("Cada partida paga además como un duelo normal (con el tope diario de siempre).")}</span>
          </Row>
          <Row label={t("Tu historial")}>
            {node.attempts === 0 ? <span className="text-ink-muted">{t("Sin intentos todavía.")}</span> : (
              <span>
                {fill(t("Mejor resultado: {resultado} · {n} {n, plural, one {intento} other {intentos}} · {v} {v, plural, one {victoria} other {victorias}}", { ...slots("resultado"), n: node.attempts, v: node.wins }), { resultado: <b className="text-white">{node.bestResult ? td(OUTCOME_LABEL[node.bestResult]) : "—"}</b> })}
              </span>
            )}
          </Row>
        </dl>

        {cta.note && (
          <p role="status" className={cn("mt-4 border-l-2 px-3 py-2 text-caption", cta.enabled ? "border-drl-cyan text-ink-secondary" : "border-drl-gold text-drl-gold")}>
            {td(cta.note)}
          </p>
        )}
        {error && <p role="alert" className="mt-3 border border-drl/40 bg-drl/10 px-3 py-2 text-caption text-drl-glow">{playerMessage(error)}</p>}

        <div className="mt-5 grid gap-2">
          {cta.href && cta.enabled ? (
            <NxButton variant="primary" size="lg" block href={cta.href} data-testid="node-cta" data-cta={cta.kind}>{busy ? t("Preparando…") : td(cta.label)}</NxButton>
          ) : (
            <NxButton variant="primary" size="lg" block disabled aria-disabled data-testid="node-cta" data-cta={cta.kind}>{td(cta.label)}</NxButton>
          )}
          {signedIn && deck && cta.kind !== "EDIT_TEAM" && (
            <NxButton variant="ghost" size="md" block href={`/duelos/mazos?deck=${deck.id}`}>{t("Editar equipo")}</NxButton>
          )}
          {showAbandon && (
            <NxButton variant="ghost" size="md" block onClick={onAbandon} disabled={busy}>{t("Abandonar el nodo en marcha")}</NxButton>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  useLocale();
  return (
    <div className="border-b border-white/[0.07] pb-3">
      <dt className="nx-label">{td(label)}</dt>
      <dd className="mt-0.5 leading-relaxed text-ink-secondary">{children}</dd>
    </div>
  );
}
