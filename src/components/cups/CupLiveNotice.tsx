"use client";

/**
 * F86.1 · AVISO GLOBAL «TU PARTIDA DE TORNEO ESTÁ LISTA» (armazón, cualquier pantalla con menú).
 *
 * Sale del MISMO sondeo ligero compartido que el indicador del menú (sin peticiones propias). No navega nunca por su
 * cuenta: ofrece el botón. Se calla en la ficha de ese torneo (allí está el panel con la espera) y en la arena.
 *   · cruce EN JUEGO (la partida ya existe)      → «Tu partida ha empezado» · ENTRAR → la arena
 *   · cruce jugable y el rival ya está listo      → «Tu rival te espera» · JUGAR → la ficha (allí se pulsa listo)
 *   · cruce jugable                                → «Tu partida está lista» · JUGAR → la ficha
 * «Ahora no» lo oculta para ESE cruce y ese estado (vuelve si cambia). Accesible: región con estado anunciado.
 */
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { useCupStatus, type CupStatusMatch } from "@/lib/cups/client";
import { formatTag } from "@/domain/account/tag";

export function liveNoticeFor(m: CupStatusMatch | null, pathname: string): { key: string; title: string; text: string; cta: string; href: string } | null {
  if (!m) return null;
  if (pathname === `/copas/${m.slug}` || pathname.startsWith("/duelos/pvp")) return null;
  const rival = m.opponent ? `${m.opponent.username}${m.opponent.tag ? ` ${formatTag(m.opponent.tag)}` : ""}` : "tu rival";
  const key = `${m.slug}:${m.round}:${m.slot}:${m.state}:${m.opponentReady}`;
  if (m.state === "ACTIVE" && m.gameMatchId) return { key, title: "Tu partida de torneo ha empezado", text: `${m.name} · ${m.roundName} contra ${rival}`, cta: "Entrar", href: `/duelos/pvp?match=${encodeURIComponent(m.gameMatchId)}` };
  if (m.state === "READY" && m.opponentReady) return { key, title: "Tu rival te espera", text: `${m.name} · ${m.roundName}: ${rival} ya está listo`, cta: "Jugar", href: `/copas/${m.slug}` };
  if (m.state === "READY") return { key, title: "Tu partida de torneo está lista", text: `${m.name} · ${m.roundName} contra ${rival}`, cta: "Jugar", href: `/copas/${m.slug}` };
  return null;
}

export function CupLiveNoticeView({ notice, onDismiss }: { notice: NonNullable<ReturnType<typeof liveNoticeFor>>; onDismiss?: () => void }) {
  return (
    <section role="status" aria-live="polite" aria-label={notice.title} data-testid="cup-live-notice"
      className="nx-clip mb-5 flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      style={{ border: "1px solid rgba(25,227,255,0.6)", background: "radial-gradient(120% 140% at 0% 0%, rgba(25,227,255,0.18), transparent 60%), rgba(8,10,18,0.92)" }}>
      <div className="min-w-0">
        <p className="font-display text-[12px] font-black uppercase tracking-[0.18em] text-[#19e3ff]">♜ {notice.title}</p>
        <p className="truncate text-[13px] text-white/80">{notice.text}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link href={notice.href} className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center bg-[#19e3ff] px-5 font-display text-[13px] font-black uppercase tracking-[0.14em] text-[#02202a]" data-testid="cup-live-cta">{notice.cta}</Link>
        {onDismiss && <button type="button" onClick={onDismiss} className="nx-focus min-h-[44px] px-3 text-[12px] text-white/60 hover:text-white" data-testid="cup-live-dismiss">Ahora no</button>}
      </div>
    </section>
  );
}

export function CupLiveNotice() {
  const { user } = useAuth();
  const pathname = usePathname() ?? "/";
  const status = useCupStatus(!!user);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const notice = user ? liveNoticeFor(status.match, pathname) : null;
  if (!notice || dismissed === notice.key) return null;
  return <CupLiveNoticeView notice={notice} onDismiss={() => setDismissed(notice.key)} />;
}
