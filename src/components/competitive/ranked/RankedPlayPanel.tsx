"use client";

/**
 * FASE 55 · JUGAR COMPETITIVO. El CTA dominante del centro competitivo, con la puerta REAL delante:
 *
 *   partida PvP viva      → CONTINUAR PARTIDA (lo dice `play-status`, del servidor)
 *   sin mazos             → CREAR MAZO
 *   mazo ilegal           → qué le falta (mensajes del validador del SERVIDOR) + EDITAR MAZO (ese mazo)
 *   mazo legal            → JUGAR COMPETITIVO → `/duelos/pvp?buscar=<id>`: la arena entra en cola al llegar
 *
 * Honestidad del emparejamiento: la cola ranked solo empareja PERSONAS (`duel_pvp_claim_pair`); no hay bots
 * ni relleno. Se dice aquí, antes de jugar. La legalidad final la vuelve a decidir el servidor al encolar.
 */
import Link from "next/link";
import { cn } from "@/lib/format";
import { PlayButton } from "@/components/ui/game/PlayButton";
import { NxButton } from "@/components/ui/NxButton";
import { editDeckHref, rankedPlayHref, type RankedGate, type ReadinessDeck } from "@/domain/pvpLadder/ranked";
import { playerMessage } from "@/components/ui/game/GameStates";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("competitive");

export interface RankedPlayPanelProps {
  gate: RankedGate | null;
  /** Mazos legales entre los que elegir (si hay más de uno). */
  legalDecks: ReadinessDeck[];
  onChoose?: (deckId: string) => void;
  resumeHref?: string | null;
  loadingDecks?: boolean;
  deckError?: string | null;
  onRetryDecks?: () => void;
  className?: string;
}

export function RankedPlayPanel({ gate, legalDecks, onChoose, resumeHref = null, loadingDecks = false, deckError = null, onRetryDecks, className }: RankedPlayPanelProps) {
  useLocale();
  return (
    <section
      aria-label={t("Jugar competitivo")}
      className={cn("nx-clip relative flex flex-col gap-4 border border-white/12 p-5", className)}
      style={{ background: "linear-gradient(160deg, rgba(255,46,99,0.14), rgba(0,0,0,0.35) 55%), rgba(10,12,18,0.6)" }}
      data-testid="ranked-play" data-gate={gate?.kind ?? (loadingDecks ? "loading" : "unknown")}
    >
      <div>
        <p className="nx-label !text-drl">{t("Ranked · duelo de cartas")}</p>
        <p className="mt-1 font-display text-[22px] font-bold uppercase leading-tight text-white">{t("Jugar competitivo")}</p>
      </div>

      {loadingDecks && !gate && <p className="text-caption text-ink-muted" role="status">{t("Comprobando tus equipos…")}</p>}
      {deckError && !gate && (
        <div className="text-caption text-drl-glow">
          <p>{playerMessage(deckError)}</p>
          {onRetryDecks && <button type="button" className="nx-action mt-1" onClick={onRetryDecks}>{t("Reintentar")}</button>}
        </div>
      )}

      {gate?.kind === "RESUME" && (
        <>
          <p className="text-body text-ink-secondary">{t("Tienes una partida PvP en curso. Termínala antes de buscar otra.")}</p>
          <PlayButton size="hero" testId="ranked-resume" cta={{ kind: "resume", label: t("Continuar partida"), href: resumeHref ?? `/duelos/pvp?match=${gate.matchId}`, ariaLabel: t("Continuar tu partida PvP en curso"), hint: t("Duelo PvP") }} />
        </>
      )}

      {gate?.kind === "NO_DECKS" && (
        <>
          <p className="text-body text-ink-secondary" data-field="gate-reason">{fill(t("Necesitas un equipo de duelo: {cartas} con la composición de roles exigida.", slots("cartas")), { cartas: <b className="text-white">{t("10 cartas")}</b> })}</p>
          <NxButton variant="primary" size="lg" href={editDeckHref(null)} data-testid="ranked-create-deck">{t("Crear equipo")}</NxButton>
        </>
      )}

      {gate?.kind === "INVALID_DECK" && (
        <>
          <div className="nx-clip-sm border border-l-2 border-drl-gold/40 border-l-drl-gold bg-drl-gold/[0.07] px-3 py-2.5" data-field="gate-reason">
            <p className="font-display text-[13px] font-bold uppercase tracking-[0.06em] text-drl-gold">{t("Tu equipo «{nombre}» no es legal", { nombre: gate.deck.name })}</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12.5px] text-white/80" data-testid="deck-issues">
              {gate.issues.map((i) => <li key={i}>{td(i)}</li>)}
            </ul>
          </div>
          <NxButton variant="primary" size="lg" href={editDeckHref(gate.deck.id)} data-testid="ranked-edit-deck">{t("Editar equipo")}</NxButton>
        </>
      )}

      {gate?.kind === "READY" && (
        <>
          <div className="nx-clip-sm flex items-center justify-between gap-3 border border-ok/30 bg-ok/[0.06] px-3 py-2.5" data-field="deck">
            <span className="min-w-0">
              <span className="nx-label block !text-[9.5px] !text-white/50">{t("Tu equipo")}</span>
              <span className="block truncate text-[14px] font-semibold text-white">{gate.deck.name}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-display text-[11px] font-bold uppercase tracking-[0.08em] text-ok">{t("✓ Legal")}</span>
              <Link href={editDeckHref(gate.deck.id)} className="nx-focus text-[11px] text-white/55 underline-offset-2 hover:underline">{t("Editar")}</Link>
            </span>
          </div>
          {legalDecks.length > 1 && onChoose && (
            <label className="block text-[11.5px] text-white/55">
              <span className="nx-label mb-1 block !text-[9.5px]">{t("Cambiar equipo")}</span>
              <select
                className="nx-focus nx-clip-sm min-h-[44px] w-full border border-white/15 bg-black/40 px-2 text-[13px] text-white"
                value={gate.deck.id} onChange={(e) => onChoose(e.target.value)} data-testid="ranked-deck-select"
              >
                {legalDecks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
          <PlayButton size="hero" testId="ranked-play-cta" cta={{ kind: "play", label: t("Jugar competitivo"), href: rankedPlayHref(gate.deck.id), ariaLabel: t("Buscar rival ranked con el equipo {name}", { name: gate.deck.name }), hint: t("Rival real · por rating") }} />
        </>
      )}

      <ul className="space-y-1 border-t border-white/10 pt-3 text-[11.5px] leading-snug text-white/55" data-testid="ranked-honesty">
        <li><b className="text-white/80">{t("Rival humano.")}</b> {t("La cola ranked solo empareja personas: no hay bots.")}</li>
        <li><b className="text-white/80">{t("Por rating.")}</b> {t("El servidor busca a alguien parecido y abre la búsqueda con la espera.")}</li>
        <li><b className="text-white/80">{t("Resultado del servidor.")}</b> {t("El rating lo liquida el servidor al acabar; nadie lo envía.")}</li>
      </ul>
    </section>
  );
}
