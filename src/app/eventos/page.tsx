"use client";

import { useEffect, useState } from "react";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { Countdown } from "@/components/events/Countdown";
import { RewardChips } from "@/components/events/RewardChip";
import { PackStoreCard } from "@/components/packs/PackStoreCard";
import { useEventsStore } from "@/store/useEventsStore";
import { EVENTS, WEEKLY_TASKS, getEvent } from "@/data/events";
import { getPack } from "@/data/packs";
import { eventWindow, weekId, dayDiff } from "@/domain/events/time";
import { passProgress, passRewardForLevel } from "@/domain/events/pass";
import { DAILY_REWARDS } from "@/domain/events/daily";
import type { EventDef } from "@/domain/events/types";
import { formatCredits, cn } from "@/lib/format";

export default function EventosPage() {
  return (
    <HydrationGate>
      <Events />
    </HydrationGate>
  );
}

function Events() {
  const { toast, notify } = useToast();
  const seasonStart = useEventsStore((s) => s.seasonStart);

  useEffect(() => {
    useEventsStore.getState().refresh();
  }, []);

  const now = Date.now();
  const active = EVENTS.filter((e) => eventWindow(e, seasonStart, now).status === "active");
  const [selId, setSelId] = useState<string | null>(null);
  const selected = getEvent(selId ?? active[0]?.id ?? EVENTS[0].id)!;

  return (
    <section className="animate-rise space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
          Centro de <span className="text-drl">Eventos</span>
        </h1>
        <p className="mt-1 text-white/50">Misiones, recompensas y sobres exclusivos. Vuelve cada día.</p>
      </header>

      <DailyStrip notify={notify} />

      {/* Selector de eventos activos */}
      {active.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {active.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelId(e.id)}
              className={cn(
                "rounded-full px-4 py-1.5 font-display text-sm uppercase tracking-wide transition",
                selected.id === e.id ? "text-white" : "border border-white/10 bg-white/5 text-white/55 hover:text-white",
              )}
              style={selected.id === e.id ? { background: e.accent, color: "#0b0d18" } : undefined}
            >
              {e.name}
            </button>
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
    <div className="rounded-2xl border border-white/10 bg-base-700/40 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold uppercase tracking-wide text-white">
            Recompensa diaria
          </h2>
          <p className="text-xs text-white/45">Racha actual: {daily.streak} día(s)</p>
        </div>
        <button
          disabled={!canClaim}
          onClick={() => {
            const res = claimDaily();
            if (res.ok) notify(`¡Día ${res.streak} reclamado!`, true);
            else notify(res.error ?? "Error", false);
          }}
          className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {canClaim ? `Reclamar día ${nextDay}` : "Vuelve mañana"}
        </button>
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
            <p className="text-[10px] uppercase tracking-widest text-white/40">Día {i + 1}</p>
            <div className="mt-1 flex justify-center">
              <RewardChips reward={r} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- Hero del evento ----------------------------- */
function EventHero({ event, notify }: { event: EventDef; notify: (m: string, ok?: boolean) => void }) {
  const seasonStart = useEventsStore((s) => s.seasonStart);
  const win = eventWindow(event, seasonStart, Date.now());

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 p-6 md:p-8" style={{ background: `linear-gradient(135deg, ${event.accent}22, #0b0d18 60%)` }}>
      <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-25 blur-3xl" style={{ background: event.accent }} />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="font-display text-xs uppercase tracking-[0.3em]" style={{ color: event.accent }}>
              {win.status === "active" ? "Evento en vivo" : win.status === "upcoming" ? "Próximamente" : "Finalizado"}
            </span>
            <h2 className="mt-1 font-display text-3xl font-bold uppercase text-white md:text-4xl">{event.name}</h2>
            <p className="mt-1 max-w-md text-white/55">{event.subtitle}</p>
          </div>
          <div>
            <p className="mb-1 text-right text-[10px] uppercase tracking-widest text-white/40">
              {win.status === "active" ? "Termina en" : win.status === "upcoming" ? "Empieza en" : ""}
            </p>
            {win.status !== "ended" && <Countdown target={win.status === "active" ? win.end : win.start} accent={event.accent} />}
          </div>
        </div>

        {/* Sobres exclusivos */}
        <h3 className="mb-3 mt-6 font-display text-sm uppercase tracking-wider text-white/70">Sobres exclusivos</h3>
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
              ? "Los sobres estarán disponibles cuando empiece el evento."
              : "El evento ha finalizado. Sus sobres ya no se pueden conseguir (las cartas obtenidas se conservan)."}
          </p>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- Tabs: misiones / pase / tienda ----------------------------- */
function EventTabs({ event, notify }: { event: EventDef; notify: (m: string, ok?: boolean) => void }) {
  const [tab, setTab] = useState<"misiones" | "pase" | "tienda">("misiones");
  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-xl border border-white/10 bg-base-700/40 p-1">
        {([
          ["misiones", "Misiones"],
          ["pase", "Pase de evento"],
          ["tienda", "Tienda"],
        ] as ["misiones" | "pase" | "tienda", string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex-1 rounded-lg px-4 py-2 font-display text-sm uppercase tracking-wide transition",
              tab === id ? "bg-drl text-white shadow-glow" : "text-white/55 hover:text-white",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "misiones" && <MissionsPanel event={event} notify={notify} />}
      {tab === "pase" && <PassPanel event={event} notify={notify} />}
      {tab === "tienda" && <ShopPanel event={event} notify={notify} />}
    </div>
  );
}

function MissionsPanel({ event, notify }: { event: EventDef; notify: (m: string, ok?: boolean) => void }) {
  const progress = useEventsStore((s) => s.progress[event.id]) ?? {};
  const claimed = useEventsStore((s) => s.claimedMissions);
  const claimMission = useEventsStore((s) => s.claimMission);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {event.missions.map((m) => {
        const cur = Math.min(progress[m.metric] ?? 0, m.goal);
        const done = cur >= m.goal;
        const isClaimed = claimed.includes(`${event.id}:${m.id}`);
        return (
          <div key={m.id} className={cn("rounded-xl border bg-base-700/50 p-4", done && !isClaimed ? "border-drl/50" : "border-white/10")}>
            <div className="flex items-start justify-between gap-2">
              <p className="font-display text-sm font-bold uppercase text-white">{m.label}</p>
              <span className="shrink-0 font-display text-xs tabular-nums text-white/50">{cur}/{m.goal}</span>
            </div>
            <div className="my-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-drl to-drl-glow" style={{ width: `${(cur / m.goal) * 100}%` }} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <RewardChips reward={{ ...m.reward, xp: m.passXp ? undefined : m.reward.xp }} />
              {isClaimed ? (
                <span className="shrink-0 rounded-lg bg-drl-cyan/15 px-3 py-1.5 font-display text-xs uppercase text-drl-cyan">✓ Hecho</span>
              ) : (
                <button
                  disabled={!done}
                  onClick={() => {
                    claimMission(event.id, m.id);
                    notify("Recompensa de misión reclamada", true);
                  }}
                  className="shrink-0 rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-3 py-1.5 font-display text-xs font-bold uppercase text-white shadow-glow transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Reclamar
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[10px] uppercase tracking-widest text-white/35">+{m.passXp} XP de pase</p>
          </div>
        );
      })}
    </div>
  );
}

function PassPanel({ event, notify }: { event: EventDef; notify: (m: string, ok?: boolean) => void }) {
  const xp = useEventsStore((s) => s.passXp[event.id]) ?? 0;
  const claimedLevels = useEventsStore((s) => s.claimedPassLevels[event.id]) ?? [];
  const claimPassLevel = useEventsStore((s) => s.claimPassLevel);
  const pp = passProgress(xp, event);

  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-display text-lg font-bold uppercase text-white">Nivel {pp.level}<span className="text-white/40"> / {event.passLevels}</span></p>
          <p className="text-xs text-white/45">Completa misiones para subir de nivel y reclamar recompensas.</p>
        </div>
        <div className="w-36">
          <div className="mb-1 flex justify-between text-[9px] text-white/40">
            <span>XP</span>
            <span>{pp.xpIntoLevel}/{pp.xpForNext}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full" style={{ width: `${pp.progress * 100}%`, background: event.accent }} />
          </div>
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
                <span className="font-display text-sm font-bold text-white">Nv {lvl}</span>
                {isClaimed && <span className="text-drl-cyan">✓</span>}
                {!reached && <span className="text-white/40">🔒</span>}
              </div>
              <RewardChips reward={passRewardForLevel(event, lvl)} />
              {claimable && (
                <button
                  onClick={() => {
                    claimPassLevel(event.id, lvl);
                    notify(`Nivel ${lvl} del pase reclamado`, true);
                  }}
                  className="rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-2 py-1 font-display text-[11px] font-bold uppercase text-white shadow-glow transition hover:brightness-110"
                >
                  Reclamar
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShopPanel({ event, notify }: { event: EventDef; notify: (m: string, ok?: boolean) => void }) {
  const tokens = useEventsStore((s) => s.tokens);
  const purchases = useEventsStore((s) => s.shopPurchases);
  const buyShopItem = useEventsStore((s) => s.buyShopItem);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-sm text-white/60">
        <span>Tu saldo:</span>
        <span className="font-display text-base font-bold text-drl-cyan">🎟️ {formatCredits(tokens)}</span>
        <span className="text-white/35">· Tokens de evento</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {event.shop.map((item) => {
          const key = `${event.id}:${item.id}`;
          const bought = purchases[key] ?? 0;
          const soldOut = item.stock != null && bought >= item.stock;
          const afford = tokens >= item.cost;
          return (
            <div key={item.id} className="flex flex-col rounded-xl border border-white/10 bg-base-700/50 p-4">
              {item.cosmetic && <span className="mb-1 w-fit rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/60">Cosmético</span>}
              <p className="font-display text-sm font-bold uppercase text-white">{item.label}</p>
              {item.description && <p className="mt-0.5 text-xs text-white/45">{item.description}</p>}
              <div className="mt-2"><RewardChips reward={item.reward} /></div>
              {item.stock != null && <p className="mt-1 text-[10px] uppercase tracking-widest text-white/35">{bought}/{item.stock} comprado</p>}
              <button
                disabled={soldOut || !afford}
                onClick={() => {
                  const res = buyShopItem(event.id, item.id);
                  notify(res.ok ? "¡Comprado!" : res.error ?? "Error", res.ok);
                }}
                className="mt-3 rounded-lg bg-gradient-to-r from-drl-cyan to-[#0f8aa0] px-3 py-2 font-display text-xs font-bold uppercase tracking-wide text-[#021b22] transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {soldOut ? "Agotado" : `🎟️ ${formatCredits(item.cost)}`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------- Tareas semanales ----------------------------- */
function WeeklyPanel({ notify }: { notify: (m: string, ok?: boolean) => void }) {
  const seasonStart = useEventsStore((s) => s.seasonStart);
  const weeklyProgress = useEventsStore((s) => s.weeklyProgress);
  const claimedWeekly = useEventsStore((s) => s.claimedWeekly);
  const claimWeekly = useEventsStore((s) => s.claimWeekly);
  const wid = weekId(Date.now(), seasonStart);
  const prog = weeklyProgress[wid] ?? {};

  return (
    <div>
      <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">Tareas semanales</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {WEEKLY_TASKS.map((t) => {
          const cur = Math.min(prog[t.metric] ?? 0, t.goal);
          const done = cur >= t.goal;
          const isClaimed = claimedWeekly.includes(`${wid}:${t.id}`);
          return (
            <div key={t.id} className={cn("rounded-xl border bg-base-700/50 p-4", done && !isClaimed ? "border-drl-gold/50" : "border-white/10")}>
              <p className="font-display text-sm font-bold uppercase text-white">{t.label}</p>
              <div className="my-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-drl-gold to-[#b8860b]" style={{ width: `${(cur / t.goal) * 100}%` }} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <RewardChips reward={t.reward} />
                {isClaimed ? (
                  <span className="shrink-0 rounded-lg bg-drl-cyan/15 px-3 py-1.5 font-display text-xs uppercase text-drl-cyan">✓</span>
                ) : (
                  <button
                    disabled={!done}
                    onClick={() => {
                      claimWeekly(t.id);
                      notify("Tarea semanal reclamada", true);
                    }}
                    className="shrink-0 rounded-lg bg-gradient-to-r from-drl-gold to-[#b8860b] px-3 py-1.5 font-display text-xs font-bold uppercase text-[#2a2000] transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Reclamar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------- Otros eventos ----------------------------- */
function OtherEvents({ seasonStart, now, onSelect }: { seasonStart: number; now: number; onSelect: (id: string) => void }) {
  return (
    <div>
      <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">Calendario de eventos</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {EVENTS.map((e) => {
          const w = eventWindow(e, seasonStart, now);
          const label = w.status === "active" ? "En vivo" : w.status === "upcoming" ? "Próximamente" : "Finalizado";
          return (
            <button
              key={e.id}
              onClick={() => onSelect(e.id)}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-base-700/50 p-4 text-left transition hover:-translate-y-1"
            >
              <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl" style={{ background: e.accent }} />
              <span className="font-display text-[10px] uppercase tracking-widest" style={{ color: e.accent }}>{label}</span>
              <h3 className="font-display text-lg font-bold uppercase text-white">{e.name}</h3>
              <p className="text-xs text-white/45">{e.durationDays} días</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------- Notificaciones ----------------------------- */
function NotificationsPanel() {
  const notifications = useEventsStore((s) => s.notifications);
  const markAllRead = useEventsStore((s) => s.markAllRead);
  if (notifications.length === 0) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">Notificaciones</h2>
        <button onClick={markAllRead} className="text-xs text-drl hover:underline">Marcar todo como leído</button>
      </div>
      <div className="space-y-2">
        {notifications.slice(0, 12).map((n) => (
          <div key={n.id} className={cn("rounded-xl border px-4 py-2.5", n.read ? "border-white/10 bg-base-700/30" : "border-drl/30 bg-drl/5")}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-sm font-semibold text-white">{n.title}</p>
              {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-drl" />}
            </div>
            <p className="text-xs text-white/50">{n.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
