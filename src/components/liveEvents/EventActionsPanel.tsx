"use client";

/**
 * ¿QUÉ PUEDO HACER AHORA? (Fase 30). Las acciones ya vienen ordenadas por el dominio
 * (`eventActions`): Pick'em que cierra pronto > objetivo > partido en directo > próximo >
 * colección > sobre ACTIVE > jugar. Solo acciones reales; cada botón es un enlace.
 */
import Link from "next/link";
import { Plate } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import type { EventAction } from "@/domain/liveEvents/eventState";

const GLYPH: Record<EventAction["kind"], string> = { pickem: "◈", objective: "◐", live: "▸", next: "◷", collection: "▣", pack: "⬢", play: "◆" };
const TINT: Record<EventAction["kind"], string> = { pickem: "25,227,255", objective: "255,211,92", live: "255,46,99", next: "150,160,180", collection: "123,92,255", pack: "255,138,61", play: "255,46,99" };

export function EventActionsPanel({ actions, onGo }: { actions: EventAction[]; onGo?: (a: EventAction) => void }) {
  if (actions.length === 0) return null;
  return (
    <section aria-label="Tus acciones" data-testid="event-actions" data-count={actions.length}>
      <SectionTitle>Tus acciones</SectionTitle>
      <ol className="grid gap-2 sm:grid-cols-2">
        {actions.map((a, i) => (
          <li key={`${a.kind}:${i}`}>
            <Link href={a.href} onClick={() => onGo?.(a)} data-action={a.kind} data-urgent={a.urgent ? "yes" : "no"} className="nx-focus block">
              <Plate tone={i === 0 ? "cyan" : "neutral"} className="flex min-h-[64px] items-center gap-3 px-3 py-2 transition hover:bg-white/[0.04]">
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center font-display text-[16px] font-bold" style={{ color: `rgb(${TINT[a.kind]})`, background: `rgb(${TINT[a.kind]} / 0.12)` }}>{GLYPH[a.kind]}</span>
                <span className="min-w-0">
                  <span className="block font-display text-[13px] font-bold uppercase tracking-wide text-white">{a.label}{a.urgent && <span className="ml-2 text-[10px] text-drl-gold">· ahora</span>}</span>
                  <span className="block truncate text-[12px] text-white/55">{a.detail}</span>
                </span>
              </Plate>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
