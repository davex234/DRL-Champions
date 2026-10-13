"use client";

/**
 * F86 · FICHA DE UN TORNEO (`/copas/[slug]`). Cabecera de EVENTO (nombre grande, estado, cuenta atrás, participantes,
 * formato, acción), mi partida, campeón, cuadro, horario, reglas y participantes.
 *
 * Datos: `GET /api/game/cups?slug=` (todo en una petición). Se relee cada 20 s con la pestaña visible, al volver a ella
 * y tras una acción propia (`nexus:cups-changed`, también desde otra pestaña vía foco). F81.2/F85: la foto va ATADA a
 * la cuenta que la pidió; si cambia la sesión (A sale, entra B) se descarta y no se pinta nada de A.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NxButton } from "@/components/ui/NxButton";
import { cn } from "@/lib/format";
import { useAuth } from "@/lib/supabase/auth";
import { fetchCup, registerCup, withdrawCup, announceCupsChange, useCupStatus, CUPS_CHANGED, type CupDetail, type CupStatusMatch } from "@/lib/cups/client";
import { fetchDuelDecks } from "@/lib/duel/client";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { playerMessage } from "@/components/ui/game/GameStates";
import { CupPhaseChip, Countdown, ChampionMoment, fmtDate } from "./CupParts";
import { CupBracket } from "./CupBracket";
import { CupMyMatchPanel } from "./CupMyMatchPanel";
import { formatTag } from "@/domain/account/tag";

const POLL_MS = 20_000;

/* ───────────── vista (pura) ───────────── */

export interface CupDetailViewProps {
  detail: CupDetail;
  signedIn: boolean;
  decks: DuelDeckDTO[] | null;
  activeDeckId?: string | null;
  offset?: number;
  busy?: boolean;
  actionError?: string | null;
  onRegister?: () => void;
  onWithdraw?: () => void;
  onStarted?: (gameMatchId: string) => void;
  onRefresh?: () => void;
  /** F86.1 · mi cruce según el sondeo ligero compartido (más fresco que la ficha). */
  status?: CupStatusMatch | null;
  viewerId?: string | null;
  harness?: boolean;
}

export function CupDetailView({ detail: d, signedIn, decks, activeDeckId = null, offset = 0, busy = false, actionError = null, onRegister, onWithdraw, onStarted, onRefresh, status = null, viewerId = null, harness = false }: CupDetailViewProps) {
  const c = d.card;
  const me = d.me;
  const full = c.participants >= c.max;
  const cta = (() => {
    if (c.phase === "REGISTRATION_OPEN") {
      if (!signedIn) return <NxButton href="/cuenta" variant="primary" size="lg" className="min-h-[48px]" data-testid="cup-signin">Entra para inscribirte</NxButton>;
      if (me?.status === "REGISTERED") return (
        <div className="flex flex-wrap items-center gap-3">
          <span className="nx-clip-sm inline-flex min-h-[48px] items-center px-5 font-display text-[15px] font-black uppercase tracking-[0.14em] text-[#19e3ff] shadow-[inset_0_0_0_1.5px_rgba(25,227,255,0.6)]" data-testid="cup-registered">Inscrito ✓</span>
          {me.canWithdraw && <NxButton variant="ghost" size="md" className="min-h-[44px]" onClick={onWithdraw} disabled={busy} data-testid="cup-withdraw">Retirarme</NxButton>}
        </div>
      );
      if (full) return <span className="nx-clip-sm inline-flex min-h-[48px] items-center px-5 font-display text-[15px] font-black uppercase tracking-[0.14em] text-white/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]" data-testid="cup-full">Completo</span>;
      return <NxButton variant="primary" size="lg" className="min-h-[48px] sm:min-w-[220px]" onClick={onRegister} disabled={busy} data-testid="cup-register">{busy ? "Inscribiendo…" : "Inscribirme"}</NxButton>;
    }
    if (c.phase === "SCHEDULED") return <p className="font-display text-[15px] font-bold uppercase tracking-wide text-white/80"><Countdown to={c.registrationOpenAt} offset={offset} prefix="Inscripciones abren en" /></p>;
    if (c.phase === "REGISTRATION_CLOSED") return <p className="text-[14px] text-white/70">Inscripción cerrada · preparando el cuadro…</p>;
    return null;
  })();

  const youWon = !!c.champion?.you;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-5 sm:px-6" data-testid="cup-detail" data-phase={c.phase}>
      <Link href="/copas" className="nx-focus inline-flex min-h-[44px] items-center text-[13px] text-white/60 hover:text-white">← Torneos</Link>

      {/* ── Cabecera de evento ── */}
      <header className="nx-clip relative isolate mt-1 overflow-hidden px-5 py-6 sm:px-8 sm:py-8"
        style={{ border: "1px solid rgba(255,46,99,0.3)", background: "radial-gradient(90% 140% at 0% 0%, rgba(255,46,99,0.22), transparent 55%), radial-gradient(80% 120% at 100% 100%, rgba(25,227,255,0.12), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.35))" }}>
        <div className="flex flex-wrap items-center gap-2">
          <CupPhaseChip phase={c.phase} />
          <span className="text-[12px] uppercase tracking-[0.16em] text-white/55">Eliminación directa · 1 contra 1</span>
          {d.unlisted && <span className="text-[11px] uppercase tracking-[0.16em] text-white/40">· No listado</span>}
        </div>
        <h1 className="mt-3 break-words font-display text-[34px] font-black uppercase leading-[0.95] text-white sm:text-[52px]" data-testid="cup-name">{c.name}</h1>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-10">
          <div><dt className="text-[11px] uppercase tracking-[0.16em] text-white/45">Participantes</dt><dd className="font-display text-[22px] font-black text-white tabular-nums" data-testid="cup-count">{c.participants}<span className="text-white/40">/{c.max}</span></dd></div>
          <div><dt className="text-[11px] uppercase tracking-[0.16em] text-white/45">Empieza</dt><dd className="text-[14px] font-bold text-white">{fmtDate(c.startsAt)}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-[0.16em] text-white/45">Cada ronda</dt><dd className="text-[14px] font-bold text-white">{windowText(d.roundWindowMinutes)}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-[0.16em] text-white/45">Premio</dt><dd className="text-[14px] font-bold text-[#ffce4f]">Trofeo de campeón</dd></div>
        </dl>
        {c.phase === "REGISTRATION_OPEN" && <p className="mt-4 text-[13px] text-white/65"><Countdown to={c.registrationCloseAt} offset={offset} prefix="La inscripción cierra en" /> · gratuita · mínimo {c.min}</p>}
        {cta && <div className="mt-5">{cta}</div>}
        {actionError && <p role="alert" className="mt-3 text-[13px] text-[#ff6b8a]" data-testid="cup-action-error">{actionError}</p>}
      </header>

      {d.cancelled && (
        <p className="nx-clip mt-4 bg-white/[0.04] px-4 py-3 text-[14px] text-white/75" role="status" data-testid="cup-cancelled">Torneo cancelado. {d.cancelled.reason} Lo jugado se conserva; no hay campeón.</p>
      )}

      {c.phase === "COMPLETED" && c.champion && <div className="mt-5"><ChampionMoment champion={c.champion} cupName={c.name} completedAt={c.completedAt} youWon={youWon} /></div>}
      {c.phase === "COMPLETED" && !c.champion && <p className="mt-4 text-[14px] text-white/70" data-testid="cup-no-champion">El torneo terminó sin campeón (la final no se disputó).</p>}

      {me?.match && c.phase === "IN_PROGRESS" && me.status === "ALIVE" && (
        <CupMyMatchPanel className="mt-5" slug={c.slug} me={me} decks={decks} activeDeckId={activeDeckId} offset={offset}
          status={status} viewerId={viewerId} harness={harness}
          onStarted={(g) => onStarted?.(g)} onRefresh={() => onRefresh?.()} />
      )}
      {me && (me.status === "ELIMINATED" || (me.status === "CHAMPION" && c.phase !== "COMPLETED")) && (
        <p className="nx-clip mt-5 bg-white/[0.04] px-4 py-3 text-[14px] text-white/80" data-testid="cup-my-result">
          {me.status === "ELIMINATED" ? <>Has quedado fuera en <b className="text-white">{me.placementLabel ?? "el torneo"}</b>. Tu resultado queda en el historial.</> : "¡Campeón!"}
        </p>
      )}
      {/* F86.2 · al acabar TU torneo (eliminado, o terminado con campeón), una invitación discreta a dar tu opinión. */}
      {me && !me.withdrawn && me.status !== null && (me.status === "ELIMINATED" || c.phase === "COMPLETED") && (
        <p className="mt-3 text-[13px] text-white/60" data-testid="cup-feedback-invite">
          ¿Qué te ha parecido el torneo?{" "}
          <Link href="/cuenta?seccion=feedback&desde=cup" className="nx-focus font-bold text-drl-cyan underline underline-offset-2">Cuéntanoslo</Link>
        </p>
      )}

      {d.bracket && d.bracket.length > 0 && <CupBracket rounds={d.bracket} className="mt-8" />}
      {!d.bracket && (c.phase === "REGISTRATION_OPEN" || c.phase === "SCHEDULED") && (
        <p className="mt-8 text-[13px] text-white/55">El cuadro se genera al cerrar la inscripción, sembrado por rating ranked en ese momento: los mejores no se cruzan pronto.</p>
      )}

      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="cup-about-title" className="min-w-0">
          <h2 id="cup-about-title" className="font-display text-[20px] font-black uppercase tracking-wide text-white">Sobre el torneo</h2>
          {d.description && <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-white/75">{d.description}</p>}
          <h3 className="mt-5 font-display text-[15px] font-bold uppercase tracking-wide text-white">Reglas</h3>
          <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-white/75" data-testid="cup-rules">{d.rules || "—"}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-white/60">
            <li>Partida 1 contra 1 con el motor de siempre; no cuenta para ranked, temporada ni misiones.</li>
            <li>Inscripción gratuita. El campeón se lleva un trofeo permanente; no hay premios en créditos ni sobres.</li>
            <li>Un empate o un plazo vencido lo resuelve la organización; nunca un sorteo.</li>
          </ul>
        </section>
        <section aria-labelledby="cup-schedule-title" className="min-w-0">
          <h2 id="cup-schedule-title" className="font-display text-[20px] font-black uppercase tracking-wide text-white">Horario</h2>
          <ol className="mt-2 space-y-1.5 text-[13px]">
            <li className="flex justify-between gap-3 text-white/70"><span>Inscripción</span><span className="text-right">{fmtDate(c.registrationOpenAt)} – {fmtDate(c.registrationCloseAt)}</span></li>
            {d.schedule.length ? d.schedule.map((r) => (
              <li key={r.round} className="flex justify-between gap-3 text-white/70"><span className="font-bold text-white/85">{r.name}</span><span className="text-right">{fmtDate(r.availableAt)} – {fmtDate(r.deadlineAt)}</span></li>
            )) : <li className="flex justify-between gap-3 text-white/70"><span>Primera ronda</span><span className="text-right">{fmtDate(c.startsAt)}</span></li>}
          </ol>
        </section>
      </div>

      <section aria-labelledby="cup-players-title" className="mt-10">
        <h2 id="cup-players-title" className="font-display text-[20px] font-black uppercase tracking-wide text-white">Participantes <span className="text-white/45">({d.participantsTotal})</span></h2>
        {d.participants.length === 0 ? (
          <p className="mt-2 text-[13px] text-white/55">Todavía no hay inscritos.</p>
        ) : (
          <ol className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="cup-participants">
            {d.participants.map((p, i) => (
              <li key={`${p.seed ?? i}-${p.username}`} className={cn("flex min-w-0 items-center gap-2 bg-white/[0.03] px-3 py-2", p.you && "shadow-[inset_0_0_0_1px_rgba(25,227,255,0.6)]")}>
                {p.seed !== null && <span className="w-6 shrink-0 text-right font-mono text-[11px] text-white/45">#{p.seed}</span>}
                <span aria-hidden>{p.avatar}</span>
                <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold uppercase text-white">{p.username}{p.you ? " (tú)" : ""}</span>
                {p.tag && <span className="shrink-0 font-mono text-[11px] text-white/45">{formatTag(p.tag)}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export function windowText(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} ${min === 1440 ? "día" : "días"}`;
  if (min % 60 === 0) return `${min / 60} h`;
  return `${min} min`;
}

/* ───────────── pantalla (datos) ───────────── */

export function CupDetailScreen({ slug }: { slug: string }) {
  const { user, loading } = useAuth();
  const viewer = user?.id ?? null;
  const router = useRouter();
  const [state, setState] = useState<{ for: string | null; detail: CupDetail; offset: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [decks, setDecks] = useState<{ for: string; list: DuelDeckDTO[]; active: string | null } | null>(null);
  const reqFor = useRef<string | null | undefined>(undefined);
  // F86.1 · estado LIGERO compartido (3 s esperando al rival, 5 s con cruce relevante…): la ficha completa solo se relee
  // cuando cambia algo de MI cruce en este torneo (no cada 3 s con 64 jugadores).
  const live = useCupStatus(!!viewer);
  const mine = live.match && live.match.slug === slug ? live.match : null;
  const sig = mine ? `${mine.round}:${mine.slot}:${mine.state}:${mine.youReady}:${mine.opponentReady}:${mine.gameMatchId ?? ""}:${mine.opponent?.tag ?? ""}` : "";
  const lastSig = useRef<string | null>(null);

  const load = useCallback(async () => {
    const who = viewer;
    reqFor.current = who;
    try {
      const d = await fetchCup(slug);
      if (reqFor.current !== who) return; // la cuenta cambió mientras se leía: esta foto no es de nadie
      setState({ for: who, detail: d, offset: d.serverNow - Date.now() });
      setError(null);
    } catch (e) {
      if (reqFor.current !== who) return;
      const status = (e as { status?: number }).status;
      if (status === 404) setNotFound(true);
      else setError(playerMessage(e instanceof Error ? e.message : null));
    }
  }, [slug, viewer]);

  useEffect(() => {
    if (loading) return;
    setState((s) => (s && s.for === viewer ? s : null)); // nunca enseñar la foto de otra cuenta
    void load();
    const tick = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    const onFocus = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    window.addEventListener(CUPS_CHANGED, onFocus);
    return () => { window.clearInterval(tick); document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); window.removeEventListener(CUPS_CHANGED, onFocus); };
  }, [load, loading, viewer]);

  useEffect(() => {
    if (lastSig.current !== null && lastSig.current !== sig) void load();
    lastSig.current = sig;
  }, [sig, load]);

  // Equipos: solo si tengo una partida que jugar (y de MI cuenta).
  const needDecks = !!state?.detail.me?.match && state.for === viewer && state.detail.me.match.state === "READY";
  useEffect(() => {
    if (!needDecks || !viewer || decks?.for === viewer) return;
    let alive = true;
    fetchDuelDecks().then((d) => { if (alive) setDecks({ for: viewer, list: d.decks, active: d.activeDeckId }); }).catch(() => { if (alive) setDecks({ for: viewer, list: [], active: null }); });
    return () => { alive = false; };
  }, [needDecks, viewer, decks?.for]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true); setActionError(null);
    try { await fn(); announceCupsChange(); await load(); }
    catch (e) { setActionError(playerMessage(e instanceof Error ? e.message : null)); await load(); }
    finally { setBusy(false); }
  }, [load]);

  const view = useMemo(() => (state && state.for === viewer ? state : null), [state, viewer]);
  if (notFound) return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="cup-not-found">
      <h1 className="font-display text-[26px] font-black uppercase text-white">Torneo no encontrado</h1>
      <p className="mt-2 text-white/65">Puede que el enlace esté mal o que el torneo aún no se haya publicado.</p>
      <NxButton href="/copas" variant="secondary" className="mt-6 min-h-[44px]">Ver torneos</NxButton>
    </div>
  );
  if (!view) return (
    <div className="mx-auto max-w-6xl px-4 py-10" data-testid="cup-loading" aria-busy="true">
      {error ? <p role="alert" className="text-white/75">{error} <button type="button" className="nx-focus ml-2 text-[#19e3ff] underline" onClick={() => void load()}>Reintentar</button></p>
        : <p className="text-white/60">Cargando el torneo…</p>}
    </div>
  );
  return (
    <CupDetailView detail={view.detail} signedIn={!!viewer} decks={decks && decks.for === viewer ? decks.list : null} activeDeckId={decks?.active ?? null}
      offset={view.offset} busy={busy} actionError={actionError}
      onRegister={() => void act(() => registerCup(slug))} onWithdraw={() => void act(() => withdrawCup(slug))}
      status={mine} viewerId={viewer}
      onStarted={(g) => router.push(`/duelos/pvp?match=${encodeURIComponent(g)}`)} onRefresh={() => void load()} />
  );
}
