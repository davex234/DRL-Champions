"use client";

/**
 * EVENTOS — la capa de evento en vivo (estilo FUT), auditada en la Fase 10.
 *
 * ────────────────────────── LO QUE LA AUDITORÍA ENCONTRÓ ──────────────────────────
 *
 * Esta pantalla funciona sobre `useEventsStore`: un store de zustand **persistido en
 * `localStorage`** con su propia economía —misiones y pase de evento— que concede
 * recompensas escribiendo en `useGameStore`, que también es local.
 *
 * En la F18.2 desapareció de aquí la segunda moneda: las fichas de evento y la tienda que
 * las gastaba. La única moneda del juego son los DRL Credits, y viven en el servidor.
 *
 * Con sesión iniciada eso NO se sostiene. Desde la Fase B la propiedad de cartas, el saldo
 * viven en el servidor (`user_cards`, `profiles`), y `CloudSync` sobrescribe
 * el store local con el estado del servidor en cada arranque. Es decir: **una recompensa
 * de evento reclamada con la cuenta iniciada desaparece en la siguiente sincronización.**
 *
 * Es exactamente el mismo fallo que la Fase A documentó para el mercado global (BUG-01) y
 * que la Fase B resolvió apagando la venta rápida online en lugar de dejarla
 * desincronizar.
 *
 * ────────────────────────── QUÉ SE HACE EN LA FASE 10 ──────────────────────────
 *
 * **No se borra nada.** El motor de eventos, sus misiones, su pase, su tienda y su
 * catálogo (`data/events.ts`) quedan intactos y siguen funcionando en el modo local sin
 * cuenta, que es un modo legítimo del producto.
 *
 * Lo que se hace es DECIRLO: con sesión, las acciones que conceden se deshabilitan con su
 * motivo escrito y se señala dónde está la progresión que sí es real —el pase de
 * temporada de `/logros`, que es server-authoritative desde la Fase 9E—.
 *
 * Un botón que paga con dinero que se va a borrar es peor que un botón apagado.
 *
 * ────────────────────────── LA RUTA DE SALIDA ──────────────────────────
 *
 * Está escrita en `docs/product/game-loop.md`: portar el evento al servidor es llevar
 * misiones y tienda a la ruta única de recompensa (`server/services/rewards`) y sus
 * métricas a `metricsFor`, igual que se hizo con el pase de temporada. La infraestructura
 * ya existe; lo que falta es el trabajo de migración, no el diseño.
 */
import { useEffect, useState } from "react";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { Toast } from "@/components/ui/Toast";
import { Plate, Stage } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { Chip } from "@/components/ui/Chip";
import { Readout } from "@/components/ui/Readout";
import { useToast } from "@/lib/useToast";
import { Countdown } from "@/components/events/Countdown";
import { RewardChips } from "@/components/events/RewardChip";
import { PackStoreCard } from "@/components/packs/PackStoreCard";
import { useEventsStore } from "@/store/useEventsStore";
import { EVENTS, eventMissions, getEvent, weeklyTasks } from "@/data/events";
import { getPack } from "@/data/packs";
import { eventWindow, weekId, dayDiff } from "@/domain/events/time";
import { passProgress, passRewardForLevel } from "@/domain/events/pass";
import { DAILY_REWARDS } from "@/domain/events/daily";
import type { EventDef } from "@/domain/events/types";
import { formatCredits, cn } from "@/lib/format";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import Link from "next/link";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("eventos");

export default function EventosPage() {
  return (
    <HydrationGate>
      <Events />
    </HydrationGate>
  );
}

/**
 * ¿Hay cuenta iniciada?
 *
 * Un solo sitio lo decide y todos los paneles lo consultan. Con cuenta, este evento —que
 * vive en `localStorage`— no puede conceder nada: el servidor sobrescribiría el resultado.
 */
function useOnline(): boolean {
  const { user } = useAuth();
  return isSupabaseConfigured() && !!user;
}

/** Motivo, escrito una vez, de por qué un botón de reclamar está apagado con cuenta. */
const OFFLINE_ONLY =
  "Con tu cuenta iniciada la economía la lleva el servidor: esta recompensa se borraría al sincronizar. Tu progresión real está en Progreso.";

function Events() {
  useLocale();
  const { toast, notify } = useToast();
  const seasonStart = useEventsStore((s) => s.seasonStart);

  useEffect(() => {
    useEventsStore.getState().refresh();
  }, []);

  const now = Date.now();
  const active = EVENTS.filter((e) => eventWindow(e, seasonStart, now).status === "active");
  const [selId, setSelId] = useState<string | null>(null);
  const selected = getEvent(selId ?? active[0]?.id ?? EVENTS[0].id)!;

  /*
   * ¿Hay cuenta? Con sesión, la economía la manda el servidor y este evento es local: sus
   * recompensas se borrarían en la siguiente sincronización. Se apagan las acciones que
   * conceden y se dice por qué. Sin sesión, el evento funciona entero.
   */
  const online = useOnline();

  return (
    <section className="animate-rise space-y-8">
      <header>
        <span className="nx-label">{tr("Tienda")}</span>
        <h1 className="mt-1 font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white">
          {fill(tr("Centro de {word}", slots("word")), { word: <span className="text-drl">{tr("Eventos")}</span> })}
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] text-white/55">
          {tr("Misiones, recompensas y sobres exclusivos. Vuelve cada día.")}
        </p>
      </header>

      {/*
        AVISO DE AUTORIDAD (Fase 10). Con sesión iniciada, la economía la manda el
        servidor y este evento vive en el navegador: reclamar aquí daría créditos que la
        siguiente sincronización borraría. Se dice, y se señala dónde está la
        progresión que sí cuenta.
      */}
      {online && (
        <div
          className="nx-clip-sm flex flex-wrap items-center gap-x-4 gap-y-2 border border-warn/35 bg-warn/[0.07] px-4 py-3"
          role="status"
        >
          <span className="nx-label !text-warn">{tr("Solo lectura con tu cuenta")}</span>
          <p className="min-w-0 flex-1 text-[13px] leading-snug text-white/65">
            {tr("Este evento se guarda en este dispositivo, así que sus recompensas no se pueden conceder mientras juegas con cuenta: el saldo y las cartas los lleva el servidor y las sobrescribiría. Tu progresión real —pase de temporada, misiones y logros— está en Progreso.")}
          </p>
          <Link
            href="/logros"
            className="nx-clip-sm shrink-0 border border-white/18 px-4 py-2 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/75 transition hover:border-white/40 hover:text-white"
          >
            {tr("Ir a Progreso")}
          </Link>
        </div>
      )}

      <DailyStrip notify={notify} />

      {/* Selector de eventos activos */}
      {active.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {active.map((e) => (
            <Chip key={e.id} active={selected.id === e.id} onClick={() => setSelId(e.id)}>
              {e.name}
            </Chip>
          ))}
        </div>
      )}

      <EventHero event={selected} notify={notify} />
      <EventTabs event={selected} notify={notify} />
      <WeeklyPanel notify={notify} />
      <OtherEvents seasonStart={seasonStart} now={now} onSelect={setSelId} />
      <NotificationsPanel />

      <Toast toast={toast} />
    </section>
  );
}

/* ----------------------------- Recompensas diarias ----------------------------- */
function DailyStrip({ notify }: { notify: (m: string, ok?: boolean) => void }) {
  useLocale();
  const online = useOnline();
  const daily = useEventsStore((s) => s.daily);
  const claimDaily = useEventsStore((s) => s.claimDaily);
  const now = Date.now();
  const canClaim = daily.lastClaimTs == null || dayDiff(now, daily.lastClaimTs) >= 1;
  const nextDay = canClaim
    ? daily.lastClaimTs && dayDiff(now, daily.lastClaimTs) === 1
      ? daily.streak + 1
      : 1
    : daily.streak;
  const highlightIdx = ((nextDay - 1) % 7 + 7) % 7;

  return (
    <Plate className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold uppercase tracking-wide text-white">
            {tr("Recompensa diaria")}
          </h2>
          <p className="text-xs text-white/45">{tr("Racha actual: {n} día(s)", { n: daily.streak })}</p>
        </div>
        <NxButton
          variant="primary"
          size="md"
          disabled={!canClaim || online}
          title={online ? td(OFFLINE_ONLY) : undefined}
          onClick={() => {
            const res = claimDaily();
            if (res.ok) notify(tr("¡Día {streak} reclamado!", { streak: res.streak }), true);
            else notify(res.error ?? tr("Error"), false);
          }}
        >
          {canClaim ? tr("Reclamar día {nextDay}", { nextDay }) : tr("Vuelve mañana")}
        </NxButton>
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {DAILY_REWARDS.map((r, i) => (
          <div
            key={i}
            className={cn(
              "rounded-lg border p-2 text-center",
              i === highlightIdx && canClaim
                ? "border-drl bg-drl/10 shadow-glow"
                : "border-white/10 bg-base-800/60",
            )}
          >
            <p className="text-[10px] uppercase tracking-widest text-white/40">{tr("Día")} {i + 1}</p>
            <div className="mt-1 flex justify-center">
              <RewardChips reward={r} />
            </div>
          </div>
        ))}
      </div>
    </Plate>
  );
}

/* ----------------------------- Hero del evento ----------------------------- */
function EventHero({ event, notify }: { event: EventDef; notify: (m: string, ok?: boolean) => void }) {
  useLocale();
  const seasonStart = useEventsStore((s) => s.seasonStart);
  const win = eventWindow(event, seasonStart, Date.now());

  return (
    <Stage tone="primary" className="p-6 md:p-8">
      <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-25 blur-3xl" style={{ background: event.accent }} />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="font-display text-xs uppercase tracking-[0.3em]" style={{ color: event.accent }}>
              {win.status === "active" ? tr("Evento en vivo") : win.status === "upcoming" ? tr("Próximamente") : tr("Finalizado")}
            </span>
            <h2 className="mt-1 font-display text-3xl font-bold uppercase text-white md:text-4xl">{td(event.name)}</h2>
            <p className="mt-1 max-w-md text-white/55">{td(event.subtitle)}</p>
          </div>
          <div>
            <p className="mb-1 text-right text-[10px] uppercase tracking-widest text-white/40">
              {win.status === "active" ? tr("Termina en") : win.status === "upcoming" ? tr("Empieza en") : ""}
            </p>
            {win.status !== "ended" && <Countdown target={win.status === "active" ? win.end : win.start} accent={event.accent} />}
          </div>
        </div>

        {/* Sobres exclusivos */}
        <h3 className="mb-3 mt-6 font-display text-sm uppercase tracking-wider text-white/70">{tr("Sobres exclusivos")}</h3>
        {win.status === "active" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {event.packIds.map((pid) => {
              const pack = getPack(pid);
              return pack ? <PackStoreCard key={pid} pack={pack} onNotify={notify} /> : null;
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/45">
            {win.status === "upcoming"
              ? tr("Los sobres estarán disponibles cuando empiece el evento.")
              : tr("El evento ha finalizado. Sus sobres ya no se pueden conseguir (las cartas obtenidas se conservan).")}
          </p>
        )}
      </div>
    </Stage>
  );
}

/*
 * Tabs: misiones / pase.
 *
 * La pestana «Tienda» se retiro en la F18.2 con las fichas de evento: era su unico
 * sumidero, y sin moneda con la que pagar solo podia ensenar precios imposibles. Lo que
 * vendia —sobres, la carta MVP, creditos— no se ha reubicado en DRL Credits: eso seria
 * convertir una moneda en otra, y la retirada se hizo expresamente sin conversion.
 */
function EventTabs({ event, notify }: { event: EventDef; notify: (m: string, ok?: boolean) => void }) {
  useLocale();
  const [tab, setTab] = useState<"misiones" | "pase">("misiones");
  return (
    <div>
      <div className="nx-clip-sm mb-4 flex gap-1 bg-black/40 p-1">
        {([
          ["misiones", tr("Misiones")],
          ["pase", tr("Pase de evento")],
        ] as ["misiones" | "pase", string][]).map(([id, label]) => (
          <NxButton
            key={id}
            variant={tab === id ? "primary" : "ghost"}
            size="md"
            block
            className="flex-1"
            onClick={() => setTab(id)}
          >
            {td(label)}
          </NxButton>
        ))}
      </div>
      {tab === "misiones" && <MissionsPanel event={event} notify={notify} />}
      {tab === "pase" && <PassPanel event={event} notify={notify} />}
    </div>
  );
}

function MissionsPanel({ event, notify }: { event: EventDef; notify: (m: string, ok?: boolean) => void }) {
  useLocale();
  const online = useOnline();
  const progress = useEventsStore((s) => s.progress[event.id]) ?? {};
  const claimed = useEventsStore((s) => s.claimedMissions);
  const claimMission = useEventsStore((s) => s.claimMission);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {eventMissions(event).map((m) => {
        const cur = Math.min(progress[m.metric] ?? 0, m.goal);
        const done = cur >= m.goal;
        const isClaimed = claimed.includes(`${event.id}:${m.id}`);
        return (
          <Plate key={m.id} tone={done && !isClaimed ? "primary" : "neutral"} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-display text-sm font-bold uppercase text-white">{td(m.label)}</p>
              <Readout size="xs" className="shrink-0" value={`${cur}/${m.goal}`} />
            </div>
            <Meter className="my-2" height={6} value={(cur / m.goal) * 100} label={td(m.label)} />
            <div className="flex items-center justify-between gap-2">
              <RewardChips reward={{ ...m.reward, xp: m.passXp ? undefined : m.reward.xp }} />
              {isClaimed ? (
                <Badge tone="ok" className="shrink-0">{tr("✓ Hecho")}</Badge>
              ) : (
                <button
                  disabled={!done || online}
                  title={online ? td(OFFLINE_ONLY) : undefined}
                  onClick={() => {
                    claimMission(event.id, m.id);
                    notify(tr("Recompensa de misión reclamada"), true);
                  }}
                  className="shrink-0"
                >
                  {tr("Reclamar")}
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[10px] uppercase tracking-widest text-white/35">+{m.passXp} {tr("XP de pase")}</p>
          </Plate>
        );
      })}
    </div>
  );
}

function PassPanel({ event, notify }: { event: EventDef; notify: (m: string, ok?: boolean) => void }) {
  useLocale();
  const online = useOnline();
  const xp = useEventsStore((s) => s.passXp[event.id]) ?? 0;
  const claimedLevels = useEventsStore((s) => s.claimedPassLevels[event.id]) ?? [];
  const claimPassLevel = useEventsStore((s) => s.claimPassLevel);
  const pp = passProgress(xp, event);

  return (
    <Plate className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-display text-lg font-bold uppercase text-white">{tr("Nivel")} {pp.level}<span className="text-white/40"> / {event.passLevels}</span></p>
          <p className="text-xs text-white/45">{tr("Completa misiones para subir de nivel y reclamar recompensas.")}</p>
        </div>
        <div className="w-36">
          <div className="mb-1 flex justify-between text-[9px] text-white/40">
            <span>{tr("XP")}</span>
            <span>{pp.xpIntoLevel}/{pp.xpForNext}</span>
          </div>
          <Meter value={pp.progress * 100} label={tr("Progreso del pase de evento")} />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {Array.from({ length: event.passLevels }, (_, i) => i + 1).map((lvl) => {
          const reached = lvl <= pp.level;
          const isClaimed = claimedLevels.includes(lvl);
          const claimable = reached && !isClaimed;
          return (
            <div
              key={lvl}
              className={cn(
                "flex w-28 shrink-0 flex-col gap-2 rounded-xl border p-2.5",
                claimable ? "border-drl/60 bg-drl/10" : reached ? "border-white/10 bg-base-800/60" : "border-white/5 bg-base-800/30 opacity-60",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-bold text-white">{tr("Nv")} {lvl}</span>
                {isClaimed && <span className="text-drl-cyan">✓</span>}
                {!reached && <span className="text-white/40">🔒</span>}
              </div>
              <RewardChips reward={passRewardForLevel(event, lvl)} />
              {claimable && (
                <button
                  disabled={online}
                  title={online ? td(OFFLINE_ONLY) : undefined}
                  onClick={() => {
                    claimPassLevel(event.id, lvl);
                    notify(tr("Nivel {lvl} del pase reclamado", { lvl }), true);
                  }}
                >
                  {tr("Reclamar")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Plate>
  );
}

/* ----------------------------- Tareas semanales ----------------------------- */
function WeeklyPanel({ notify }: { notify: (m: string, ok?: boolean) => void }) {
  useLocale();
  const online = useOnline();
  const seasonStart = useEventsStore((s) => s.seasonStart);
  const weeklyProgress = useEventsStore((s) => s.weeklyProgress);
  const claimedWeekly = useEventsStore((s) => s.claimedWeekly);
  const claimWeekly = useEventsStore((s) => s.claimWeekly);
  const wid = weekId(Date.now(), seasonStart);
  const prog = weeklyProgress[wid] ?? {};

  return (
    <div>
      <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">{tr("Tareas semanales")}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {weeklyTasks().map((t) => {
          const cur = Math.min(prog[t.metric] ?? 0, t.goal);
          const done = cur >= t.goal;
          const isClaimed = claimedWeekly.includes(`${wid}:${t.id}`);
          return (
            <Plate key={t.id} tone={done && !isClaimed ? "gold" : "neutral"} className="p-4">
              <p className="font-display text-sm font-bold uppercase text-white">{td(t.label)}</p>
              <Meter className="my-2" height={6} tone="gold" value={(cur / t.goal) * 100} label={td(t.label)} />
              <div className="flex items-center justify-between gap-2">
                <RewardChips reward={t.reward} />
                {isClaimed ? (
                  <Badge tone="ok" className="shrink-0">✓</Badge>
                ) : (
                  <button
                    disabled={!done || online}
                    title={online ? td(OFFLINE_ONLY) : undefined}
                    onClick={() => {
                      claimWeekly(t.id);
                      notify(tr("Tarea semanal reclamada"), true);
                    }}
                    className="shrink-0"
                  >
                    {tr("Reclamar")}
                  </button>
                )}
              </div>
            </Plate>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------- Otros eventos ----------------------------- */
function OtherEvents({ seasonStart, now, onSelect }: { seasonStart: number; now: number; onSelect: (id: string) => void }) {
  useLocale();
  return (
    <div>
      <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">{tr("Calendario de eventos")}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {EVENTS.map((e) => {
          const w = eventWindow(e, seasonStart, now);
          const label = w.status === "active" ? tr("En vivo") : w.status === "upcoming" ? tr("Próximamente") : tr("Finalizado");
          return (
            <button
              key={e.id}
              onClick={() => onSelect(e.id)}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-base-700/50 p-4 text-left transition hover:-translate-y-1"
            >
              <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl" style={{ background: e.accent }} />
              <span className="font-display text-[10px] uppercase tracking-widest" style={{ color: e.accent }}>{td(label)}</span>
              <h3 className="font-display text-lg font-bold uppercase text-white">{e.name}</h3>
              <p className="text-xs text-white/45">{e.durationDays} {tr("días")}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------- Notificaciones ----------------------------- */
function NotificationsPanel() {
  useLocale();
  const notifications = useEventsStore((s) => s.notifications);
  const markAllRead = useEventsStore((s) => s.markAllRead);
  if (notifications.length === 0) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">{tr("Notificaciones")}</h2>
        <button onClick={markAllRead} className="text-xs text-drl hover:underline">{tr("Marcar todo como leído")}</button>
      </div>
      <div className="space-y-2">
        {notifications.slice(0, 12).map((n) => (
          <div key={n.id} className={cn("rounded-xl border px-4 py-2.5", n.read ? "border-white/10 bg-base-700/30" : "border-drl/30 bg-drl/5")}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-sm font-semibold text-white">{td(n.title)}</p>
              {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-drl" />}
            </div>
            <p className="text-xs text-white/50">{td(n.message)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
