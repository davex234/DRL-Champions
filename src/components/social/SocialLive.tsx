"use client";

/**
 * F85 · SOCIAL EN VIVO — montado por el armazón en TODA la app (no solo en `/social`).
 *
 *   · Mantiene el PULSO (latido de presencia + contador + retos en curso): «en línea» = app abierta en alguna pestaña.
 *   · RETO RECIBIDO: aviso con avatar, nombre, rango F84, «te reta a un duelo amistoso», cuenta atrás y ACEPTAR /
 *     RECHAZAR. Aceptar usa tu equipo activo legal (o el único legal que tengas) y entra en la partida; si hay que elegir, abre la hoja.
 *   · RETO ENVIADO: «¡Aceptado! Entrando en la partida…» (y entra), o «rechazado» / «caducado», UNA vez por reto.
 *
 * Nada se decide aquí: todo sale del pulso del servidor (`POST pulse`), y cada botón es la misma acción de `/social`.
 * Sin avisos en mitad de una partida (el servidor dice si tienes una viva) ni en las rutas inmersivas; en la arena PvP,
 * solo la revancha de la partida terminada que está en pantalla (y quien la pidió entra solo si se acepta). Un mismo reto no
 * genera más de un aviso (se recuerda por pestaña en `sessionStorage`). Movimiento reducido: aparece sin animación.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAuth } from "@/lib/supabase/auth";
import { useSocialPulse, socialPulsePoll, acceptChallenge, declineChallenge, announceSocialChange, SocialError, type ChallengeView } from "@/lib/social/client";
import { OUTGOING_POLL_MS } from "@/domain/social/social";
import { fetchDuelDecks } from "@/lib/duel/client";
import { RankInline } from "@/components/competitive/ranked/CompetitiveEmblem";
import { RowButton, remainingText } from "./bits";

const SEEN = "drl:social-seen:";
function seen(key: string): boolean { try { return window.sessionStorage.getItem(SEEN + key) === "1"; } catch { return false; } }
function markSeen(key: string): void { try { window.sessionStorage.setItem(SEEN + key, "1"); } catch { /* sin almacenamiento */ } }

/** `?match=` de la URL actual (la arena PvP). Sin `useSearchParams`: el armazón no está bajo un límite de Suspense. */
function currentMatchParam(): string | null {
  try { return new URLSearchParams(window.location.search).get("match"); } catch { return null; }
}

/**
 * F85 · en la arena PvP solo se avisa de la REVANCHA de la partida que hay en pantalla (y solo cuando ya terminó: con una
 * partida viva `activeMatchId` lo apaga todo). Un reto normal espera a que salgas de la arena.
 */
function isRematchOfScreen(c: ChallengeView): boolean {
  return !!c.previousMatchId && currentMatchParam() === c.previousMatchId;
}

/** Solo mantiene el pulso (rutas inmersivas: apertura de sobres, entrenador): sin avisos, pero la presencia sigue viva. */
export function SocialPresence() {
  const { user } = useAuth();
  useSocialPulse(!!user);
  return null;
}

export function SocialLive({ pathname: forcedPath = null }: { pathname?: string | null } = {}) {
  const { user } = useAuth();
  const pulse = useSocialPulse(!!user);
  const router = useRouter();
  const path = usePathname() ?? forcedPath ?? "";
  const reduced = !!useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ key: string; text: string; tone: "ok" | "muted" } | null>(null);

  // Reloj de pantalla para la cuenta atrás (solo presentación: caduca el servidor).
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);

  const incoming: ChallengeView | null = useMemo(() => {
    const c = pulse?.incoming ?? null;
    if (!c || pulse?.activeMatchId || (path.startsWith("/duelos/pvp") && !isRematchOfScreen(c))) return null;
    if (dismissed.includes(c.id) || c.expiresAt <= now) return null;
    return c;
  }, [pulse, path, dismissed, now]);

  // Reto ENVIADO: aceptado → entrar; rechazado / caducado → avisar UNA vez.
  useEffect(() => {
    const c = pulse?.outgoing;
    if (!c) return;
    const key = `${c.id}:${c.status}`;
    if (seen(key)) return;
    if ((c.status === "MATCHED" || c.status === "ACCEPTED") && c.matchId && pulse?.activeMatchId === c.matchId) {
      markSeen(key);
      if (path.includes(c.matchId) || currentMatchParam() === c.matchId) return;
      setNote({ key, text: `¡${c.challenged.username} ha aceptado! Entrando en la partida…`, tone: "ok" });
      const t = window.setTimeout(() => router.push(`/duelos/pvp?match=${c.matchId}`), reduced ? 300 : 1400);
      return () => window.clearTimeout(t);
    }
    if (c.status === "DECLINED" || c.status === "EXPIRED") {
      markSeen(key);
      setNote({ key, text: c.status === "DECLINED" ? `${c.challenged.username} ha rechazado tu reto` : `Tu reto a ${c.challenged.username} ha caducado`, tone: "muted" });
      const t = window.setTimeout(() => setNote(null), 5000);
      return () => window.clearTimeout(t);
    }
  }, [pulse, path, router, reduced]);

  // Mientras MI reto espera respuesta, el pulso se relee cada 5 s (no cada 45): al aceptar, entro en segundos. Solo
  // lectura extra mientras dura la espera (≤ 5 min); el latido sigue escribiendo como mucho cada 20 s.
  const waiting = pulse?.outgoing?.status === "PENDING" && (pulse.outgoing.expiresAt ?? 0) > now;
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => socialPulsePoll.refresh(true), OUTGOING_POLL_MS);
    return () => window.clearInterval(id);
  }, [waiting]);

  const close = useCallback((id: string) => setDismissed((d) => [...d, id]), []);

  const onAccept = useCallback(async (c: ChallengeView) => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await fetchDuelDecks();
      // Equipo activo legal; si no hay activo y solo existe UN equipo legal, ese (no hay nada que elegir). Con varios y
      // sin activo, se abre la hoja para elegir: nunca se juega con un equipo que el jugador no haya podido escoger.
      const valid = d.decks.filter((x) => x.valid);
      const deck = valid.find((x) => x.id === d.activeDeckId) ?? (valid.length === 1 ? valid[0] : null);
      if (!deck) { close(c.id); router.push(`/social?tab=retos&aceptar=${c.id}`); return; }
      const r = await acceptChallenge(c.id, deck.id);
      close(c.id); announceSocialChange();
      if (r.matchId) router.push(`/duelos/pvp?match=${r.matchId}`);
    } catch (e) {
      close(c.id);
      setNote({ key: c.id, text: e instanceof SocialError ? e.message : "No se pudo aceptar el reto", tone: "muted" });
      announceSocialChange();
    } finally { setBusy(false); }
  }, [busy, close, router]);

  const onDecline = useCallback(async (c: ChallengeView) => {
    if (busy) return;
    setBusy(true);
    try { await declineChallenge(c.id); } catch { /* el pulso dirá el estado real */ }
    finally { close(c.id); announceSocialChange(); setBusy(false); }
  }, [busy, close]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-3 lg:bottom-6" data-testid="social-live">
      <AnimatePresence>
        {incoming && (
          <IncomingChallengeCard key={incoming.id} challenge={incoming} now={now} busy={busy} reduced={reduced}
            onAccept={() => void onAccept(incoming)} onDecline={() => void onDecline(incoming)} onClose={() => close(incoming.id)} />
        )}
        {note && (
          <motion.p
            key={note.key}
            role="status"
            initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`nx-clip-sm pointer-events-auto max-w-md border px-4 py-3 text-[13px] shadow-xl ${note.tone === "ok" ? "border-ok/50 bg-[#0b1710]/95 text-white" : "border-white/15 bg-[#0b0e17]/95 text-white/80"}`}
            data-testid="challenge-note"
          >
            {note.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Tarjeta PURA del reto recibido (también en el arnés). Acciones accesibles por teclado, 44 px, sin modal que atrape. */
export function IncomingChallengeCard({ challenge: incoming, now, busy, reduced, onAccept, onDecline, onClose }: {
  challenge: ChallengeView; now: number; busy: boolean; reduced: boolean; onAccept: () => void; onDecline: () => void; onClose: () => void;
}) {
  return (
          <motion.section
            role="region"
            aria-label={`${incoming.challenger.username} te reta a un duelo amistoso`}
            aria-live="polite"
            initial={reduced ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            transition={{ duration: reduced ? 0 : 0.28 }}
            className="nx-clip pointer-events-auto w-full max-w-md border border-drl-cyan/50 bg-[#0b0e17]/95 p-3 shadow-2xl backdrop-blur"
            data-testid="incoming-challenge" data-challenge={incoming.id}
          >
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/[0.06] text-2xl">{incoming.challenger.avatar}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-bold uppercase tracking-wide text-white">{incoming.challenger.username}</p>
                {incoming.rivalRank && <RankInline rank={incoming.rivalRank.rank} state={incoming.rivalRank.state} className="max-w-full" />}
                <p className="mt-0.5 font-display text-[12px] font-bold uppercase tracking-[0.12em] text-drl-cyan">
                  {incoming.previousMatchId ? "Te pide la revancha" : "Te reta a un duelo amistoso"}
                </p>
                <p className="text-[11px] text-white/50">Sin rating ni colocación · {remainingText(incoming.expiresAt, now)}</p>
              </div>
              <button type="button" onClick={onClose} className="nx-focus grid h-11 w-11 shrink-0 place-items-center text-white/50 hover:text-white" aria-label="Ocultar el aviso (el reto sigue en Social)">×</button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <RowButton tone="primary" onClick={onAccept} disabled={busy} data-action="accept">{busy ? "Entrando…" : "Aceptar"}</RowButton>
              <RowButton onClick={onDecline} disabled={busy} data-action="decline">Rechazar</RowButton>
            </div>
          </motion.section>
  );
}
