"use client";

/**
 * F86 · TORNEOS (`/copas`). Un hub de COMPETICIÓN: si tienes una partida lista, es lo primero; después tus torneos,
 * los que tienen inscripción abierta, los próximos, los que están en curso y el archivo de finalizados (paginado).
 * Tu historial de torneos vive aquí (participaciones, títulos, mejor resultado), no en el perfil.
 * Sin torneos no se inventa ninguno: «No hay torneos abiertos ahora».
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { NxButton } from "@/components/ui/NxButton";
import { cn } from "@/lib/format";
import { useAuth } from "@/lib/supabase/auth";
import { fetchCupHub, CUPS_CHANGED, type CupHub, type CupCard } from "@/lib/cups/client";
import { playerMessage } from "@/components/ui/game/GameStates";
import { formatTag } from "@/domain/account/tag";
import { PLACEMENT_LABEL } from "@/domain/cups/bracket";
import { CupPhaseChip, Countdown, fmtDate, fmtDay } from "./CupParts";
import { ns, td } from "@/i18n/runtime";
import { roundText } from "@/lib/bracket/roundText";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("cups");

const POLL_MS = 20_000;

const MINE_LABEL: Record<NonNullable<CupCard["mine"]>, string> = { REGISTERED: "Inscrito", ALIVE: "Sigues vivo", ELIMINATED: "Eliminado", CHAMPION: "Campeón" };

/** Traducido AQUÍ (catálogo de este módulo): «Eliminado» de un torneo no es un registro «eliminado». */
const mineText = (mine: NonNullable<CupCard["mine"]>): string =>
  mine === "REGISTERED" ? t("Inscrito") : mine === "ALIVE" ? t("Sigues vivo") : mine === "ELIMINATED" ? t("Eliminado") : mine === "CHAMPION" ? t("Campeón") : td(MINE_LABEL[mine]);

export function CupCardTile({ c, offset = 0 }: { c: CupCard; offset?: number }) {
  useLocale();
  return (
    <Link href={`/copas/${c.slug}`} data-testid="cup-card" data-phase={c.phase}
      className="nx-focus nx-clip group relative flex min-h-[148px] min-w-0 flex-col justify-between gap-3 px-4 py-4 transition-colors hover:bg-white/[0.06]"
      style={{ border: "1px solid rgba(255,255,255,0.12)", background: "linear-gradient(160deg, rgba(255,46,99,0.10), transparent 45%), rgba(255,255,255,0.03)" }}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <CupPhaseChip phase={c.phase} />
          {c.mine && <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#19e3ff]" data-field="cup-mine">{mineText(c.mine)}{c.placement && c.mine === "ELIMINATED" ? ` · ${PLACEMENT_LABEL[c.placement]}` : ""}</span>}
        </div>
        <h3 className="mt-2 break-words font-display text-[20px] font-black uppercase leading-tight text-white group-hover:text-white">{c.name}</h3>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 text-[12px] text-white/65">
        <span className="tabular-nums"><b className="font-display text-[16px] text-white">{c.participants}</b>/{c.max} {t("jugadores")}</span>
        <span>
          {c.phase === "REGISTRATION_OPEN" ? <Countdown to={c.registrationCloseAt} offset={offset} prefix={t("Cierra en")} />
            : c.phase === "SCHEDULED" ? <Countdown to={c.registrationOpenAt} offset={offset} prefix={t("Abre en")} />
              : c.phase === "COMPLETED" ? (c.champion ? <>♛ {c.champion.username}{c.champion.tag ? ` ${formatTag(c.champion.tag)}` : ""}</> : t("Sin campeón"))
                : c.phase === "CANCELLED" ? t("Cancelado") : t("Empieza {startsAt}", { startsAt: fmtDate(c.startsAt) })}
        </span>
      </div>
    </Link>
  );
}

function Section({ id, title, cards, offset, empty }: { id: string; title: string; cards: CupCard[]; offset: number; empty?: string }) {
  useLocale();
  if (!cards.length && !empty) return null;
  return (
    <section aria-labelledby={id} className="mt-8" data-testid={`cup-section-${id}`}>
      <h2 id={id} className="mb-3 font-display text-[18px] font-black uppercase tracking-[0.08em] text-white">{td(title)}</h2>
      {cards.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{cards.map((c) => <CupCardTile key={c.slug} c={c} offset={offset} />)}</div>
      ) : <p className="text-[13px] text-white/55">{td(empty)}</p>}
    </section>
  );
}

export interface CupsHubViewProps { hub: CupHub; signedIn: boolean; offset?: number; onMore?: () => void; loadingMore?: boolean }

export function CupsHubView({ hub, signedIn, offset = 0, onMore, loadingMore = false }: CupsHubViewProps) {
  useLocale();
  const nothingOpen = !hub.open.length && !hub.upcoming.length && !hub.live.length;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6" data-testid="cups-hub">
      <header>
        <p className="font-display text-[12px] font-bold uppercase tracking-[0.24em] text-[#ff2e63]">{t("Competición")}</p>
        <h1 className="mt-1 font-display text-[40px] font-black uppercase leading-none text-white sm:text-[56px]">{t("Torneos")}</h1>
        <p className="mt-3 max-w-2xl text-[14px] text-white/70">{t("Eliminación directa, 1 contra 1. Inscripción gratuita. El campeón se lleva un trofeo permanente.")}</p>
      </header>

      {hub.ready && (
        <Link href={`/copas/${hub.ready.slug}`} data-testid="cup-ready-banner"
          className="nx-focus nx-clip mt-6 flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ border: "1px solid rgba(25,227,255,0.6)", background: "radial-gradient(120% 140% at 0% 0%, rgba(25,227,255,0.2), transparent 60%), rgba(255,255,255,0.03)" }}>
          <span className="min-w-0">
            <span className="block font-display text-[12px] font-bold uppercase tracking-[0.2em] text-[#19e3ff]">{hub.ready.state === "ACTIVE" ? t("Tu partida está en juego") : t("Tu partida está lista")}</span>
            <span className="block truncate font-display text-[20px] font-black uppercase text-white">{hub.ready.name} · {roundText(hub.ready.roundName)}</span>
            {hub.ready.opponent && <span className="block truncate text-[13px] text-white/70">{t("contra {nombre}", { nombre: hub.ready.opponent.username + (hub.ready.opponent.tag ? ` ${formatTag(hub.ready.opponent.tag)}` : "") })}</span>}
          </span>
          <span className="mt-2 shrink-0 font-display text-[14px] font-black uppercase tracking-[0.14em] text-[#19e3ff] sm:mt-0">{t("Ver mi partida →")}</span>
        </Link>
      )}

      {signedIn && hub.mine && hub.mine.length > 0 && <Section id="mis-torneos" title={t("Mis torneos")} cards={hub.mine} offset={offset} />}

      {nothingOpen && (
        <div className="nx-clip mt-8 px-5 py-8 text-center" style={{ border: "1px dashed rgba(255,255,255,0.18)" }} data-testid="cups-empty">
          <p className="font-display text-[18px] font-black uppercase tracking-wide text-white">{t("No hay torneos abiertos ahora")}</p>
          <p className="mt-1 text-[13px] text-white/60">{t("Cuando la organización publique uno, aparecerá aquí con su fecha de inscripción.")}</p>
        </div>
      )}
      <Section id="inscripcion" title={t("En inscripción")} cards={hub.open} offset={offset} />
      <Section id="proximos" title={t("Próximos")} cards={hub.upcoming} offset={offset} />
      <Section id="en-curso" title={t("En curso")} cards={hub.live} offset={offset} />
      <Section id="finalizados" title={t("Finalizados")} cards={hub.finished} offset={offset} empty={hub.finishedOffset === 0 ? t("Aún no ha terminado ningún torneo.") : undefined} />
      {hub.finishedHasMore && onMore && (
        <div className="mt-4"><NxButton variant="secondary" className="min-h-[44px]" onClick={onMore} disabled={loadingMore} data-testid="cups-more">{loadingMore ? t("Cargando…") : t("Ver más")}</NxButton></div>
      )}

      {signedIn && hub.history && (
        <section aria-labelledby="cup-history" className="mt-10" data-testid="cup-history">
          <h2 id="cup-history" className="mb-3 font-display text-[18px] font-black uppercase tracking-[0.08em] text-white">{t("Tu historial")}</h2>
          <dl className="grid grid-cols-3 gap-3">
            {[[t("Participaciones"), String(hub.history.participations)], [t("Títulos"), String(hub.history.titles)], [t("Mejor resultado"), hub.history.bestLabel ?? "—"]].map(([k, v]) => (
              <div key={k} className="bg-white/[0.04] px-3 py-3"><dt className="text-[11px] uppercase tracking-[0.14em] text-white/50">{td(k)}</dt><dd className="mt-1 font-display text-[18px] font-black text-white">{td(v)}</dd></div>
            ))}
          </dl>
          {hub.history.entries.length > 0 && (
            <ol className="mt-3 space-y-1.5">
              {hub.history.entries.map((e) => (
                <li key={e.slug}><Link href={`/copas/${e.slug}`} className="nx-focus flex min-h-[44px] items-center justify-between gap-3 bg-white/[0.03] px-3 text-[13px] hover:bg-white/[0.06]">
                  <span className="min-w-0 truncate font-bold text-white">{e.name}</span>
                  <span className={cn("shrink-0", e.placement === "CHAMPION" ? "text-[#ffce4f]" : "text-white/65")}>{e.placement === "CHAMPION" ? "♛ " : ""}{td(e.label) ?? "—"}{e.completedAt ? ` · ${fmtDay(e.completedAt)}` : ""}</span>
                </Link></li>
              ))}
            </ol>
          )}
          <p className="mt-2 text-[12px] text-white/50">{fill(t("Puedes destacar tus trofeos de campeón en {perfil}.", slots("perfil")), { perfil: <Link href="/jugador/me?editar=insignias" className="nx-focus text-[#19e3ff] underline-offset-2 hover:underline">{t("tu perfil")}</Link> })}</p>
        </section>
      )}
      {!signedIn && <p className="mt-10 text-[13px] text-white/60">{fill(t("{entrar} para inscribirte y ver tus partidas.", slots("entrar")), { entrar: <Link href="/cuenta" className="nx-focus text-[#19e3ff] underline">{t("Entra")}</Link> })}</p>}
    </div>
  );
}

export function CupsHubScreen() {
  useLocale();
  const { user, loading } = useAuth();
  const viewer = user?.id ?? null;
  const [state, setState] = useState<{ for: string | null; hub: CupHub; offset: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const reqFor = useRef<string | null | undefined>(undefined);

  const load = useCallback(async () => {
    const who = viewer;
    reqFor.current = who;
    try {
      const hub = await fetchCupHub();
      if (reqFor.current !== who) return;
      setState({ for: who, hub, offset: hub.serverNow - Date.now() });
      setError(null);
    } catch (e) { if (reqFor.current === who) setError(playerMessage(e instanceof Error ? e.message : null)); }
  }, [viewer]);

  useEffect(() => {
    if (loading) return;
    setState((s) => (s && s.for === viewer ? s : null));
    void load();
    const tick = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    const onFocus = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener(CUPS_CHANGED, onFocus);
    return () => { window.clearInterval(tick); document.removeEventListener("visibilitychange", onFocus); window.removeEventListener(CUPS_CHANGED, onFocus); };
  }, [load, loading, viewer]);

  const loadMore = useCallback(async () => {
    if (!state) return;
    setMore(true);
    try {
      const next = await fetchCupHub(state.hub.finishedOffset + 10);
      setState((s) => (s && s.for === viewer ? { ...s, hub: { ...s.hub, finished: [...s.hub.finished, ...next.finished], finishedOffset: next.finishedOffset, finishedHasMore: next.finishedHasMore } } : s));
    } catch { /* el botón sigue ahí */ } finally { setMore(false); }
  }, [state, viewer]);

  const view = state && state.for === viewer ? state : null;
  if (!view) return (
    <div className="mx-auto max-w-6xl px-4 py-10" aria-busy="true" data-testid="cups-loading">
      {error ? <p role="alert" className="text-white/75">{td(error)} <button type="button" className="nx-focus ml-2 text-[#19e3ff] underline" onClick={() => void load()}>{t("Reintentar")}</button></p>
        : <p className="text-white/60">{t("Cargando torneos…")}</p>}
    </div>
  );
  return <CupsHubView hub={view.hub} signedIn={!!viewer} offset={view.offset} onMore={() => void loadMore()} loadingMore={more} />;
}
