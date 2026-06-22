"use client";

import { useEffect } from "react";
import { ADMIN_ENABLED } from "@/config/admin";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { useEngineStore } from "@/store/useEngineStore";
import { isVlrConfigured } from "@/engine/sources/vlr";
import { isTelegramConfigured } from "@/engine/notifications";
import type { Match, GeneratedCard, MatchStatus } from "@/engine/types";
import { formatRelative, cn } from "@/lib/format";

export default function DataEnginePage() {
  if (!ADMIN_ENABLED) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-center">
        <p className="font-display text-2xl font-bold uppercase text-white">Acceso restringido</p>
      </div>
    );
  }
  return (
    <HydrationGate>
      <Dashboard />
    </HydrationGate>
  );
}

const STATUS_COLOR: Record<MatchStatus, string> = {
  upcoming: "#8b96a3",
  live: "#ff2e63",
  finished: "#37e6a0",
};

function Dashboard() {
  const s = useEngineStore();

  // Tick del scheduler cada 30s (en producción lo haría un cron/edge function).
  useEffect(() => {
    const t = setInterval(() => useEngineStore.getState().tick(), 30_000);
    return () => clearInterval(t);
  }, []);

  const pending = s.generatedCards.filter((c) => c.status === "pending");
  const scheduled = s.jobs.filter((j) => j.status === "scheduled");

  return (
    <section className="animate-rise space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
            DRL <span className="text-drl">Data Engine</span>
          </h1>
          <p className="mt-1 text-white/50">
            Alimentación automática desde torneos reales de Valorant.
            {s.lastRun ? ` Última ejecución ${formatRelative(s.lastRun)}.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-white/10 bg-base-800 p-0.5">
            {(["mock", "vlr"] as const).map((src) => (
              <button
                key={src}
                onClick={() => s.setSource(src)}
                disabled={src === "vlr" && !isVlrConfigured()}
                className={cn("rounded-md px-3 py-1 font-display text-xs uppercase disabled:opacity-30", s.source === src ? "bg-drl text-white" : "text-white/50")}
              >
                {src === "mock" ? "Mock" : "VLR"}
              </button>
            ))}
          </div>
          <button
            onClick={() => s.run()}
            disabled={s.running}
            className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition enabled:hover:brightness-110 disabled:opacity-50"
          >
            {s.running ? "Ejecutando…" : "▶ Ejecutar engine"}
          </button>
          <button onClick={() => s.resetEngine()} className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 font-display text-sm uppercase text-white/70 transition hover:bg-white/10">
            Reset
          </button>
        </div>
      </header>

      {/* Estado de integraciones */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge ok={isVlrConfigured()} label={`VLR ${isVlrConfigured() ? "conectado" : "no configurado (mock)"}`} />
        <Badge ok={isTelegramConfigured()} label={`Telegram ${isTelegramConfigured() ? "activo" : "no configurado (solo log)"}`} />
        <span className="rounded-full bg-white/5 px-3 py-1 text-white/60">{scheduled.length} trabajos programados</span>
        {pending.length > 0 && (
          <span className="rounded-full bg-drl/20 px-3 py-1 font-semibold text-drl">{pending.length} cartas pendientes de aprobación</span>
        )}
      </div>

      {/* Aprobaciones pendientes (confianza < 90%) */}
      {pending.length > 0 && (
        <Panel title={`Aprobación manual (${pending.length})`}>
          <div className="space-y-2">
            {pending.map((c) => (
              <CardRow key={c.id} card={c} actions={
                <>
                  <button onClick={() => s.approveCard(c.id)} className="rounded-md bg-drl-cyan/20 px-3 py-1 font-display text-[11px] uppercase text-drl-cyan transition hover:bg-drl-cyan/30">Aprobar</button>
                  <button onClick={() => s.rejectCard(c.id)} className="rounded-md border border-drl/40 px-3 py-1 font-display text-[11px] uppercase text-drl transition hover:bg-drl/10">Rechazar</button>
                </>
              } />
            ))}
          </div>
        </Panel>
      )}

      {/* Torneos */}
      <Panel title={`Torneos detectados (${s.tournaments.length})`}>
        {s.tournaments.length === 0 ? (
          <Empty>Pulsa «Ejecutar engine» para detectar torneos.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {s.tournaments.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-base-700/50 px-3 py-2">
                <div>
                  <p className="font-display text-sm font-bold uppercase text-white">{t.name}</p>
                  <p className="text-[11px] text-white/40">{t.type} · {t.region ?? "—"}</p>
                </div>
                <span className="rounded-full px-2 py-0.5 text-[10px] uppercase" style={{ background: `${STATUS_COLOR[t.status]}22`, color: STATUS_COLOR[t.status] }}>
                  {t.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Partidos + Pick'ems */}
      <Panel title={`Partidos (${s.matches.length})`}>
        {s.matches.length === 0 ? (
          <Empty>Sin partidos.</Empty>
        ) : (
          <div className="space-y-2">
            {s.matches.map((m) => (
              <MatchRow key={m.id} match={m} pick={s.pickems[m.id]?.pick} correct={s.pickems[m.id]?.correct}
                onPick={(team) => s.setPick(m.id, team)}
                onSimulate={(team) => s.simulateFinish(m.id, team)} />
            ))}
          </div>
        )}
      </Panel>

      {/* Cartas generadas */}
      <Panel title={`Cartas generadas (${s.generatedCards.length})`}>
        {s.generatedCards.length === 0 ? (
          <Empty>Aún no se han generado cartas.</Empty>
        ) : (
          <div className="space-y-2">
            {s.generatedCards.slice(0, 40).map((c) => (
              <CardRow key={c.id} card={c} />
            ))}
          </div>
        )}
      </Panel>

      {/* Eventos generados */}
      {s.generatedEvents.length > 0 && (
        <Panel title={`Eventos generados (${s.generatedEvents.length})`}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {s.generatedEvents.map((e) => (
              <div key={e.id} className="rounded-lg border border-white/10 bg-base-700/50 px-3 py-2">
                <p className="font-display text-sm font-bold uppercase text-white">{e.name}</p>
                <p className="text-[11px] text-white/40">{e.missions.length} misiones · {e.shop.length} artículos · sobre {e.packIds.join(", ")}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Scheduler */}
      <Panel title={`Scheduler (${scheduled.length} programados)`}>
        {s.jobs.length === 0 ? (
          <Empty>Sin trabajos.</Empty>
        ) : (
          <div className="space-y-1.5">
            {s.jobs.slice(0, 12).map((j) => (
              <div key={j.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-base-700/40 px-3 py-1.5 text-sm">
                <span className="text-white/80">{j.label}</span>
                <span className={cn("text-[11px]", j.status === "done" ? "text-white/30" : "text-drl-cyan")}>
                  {j.status === "done" ? "hecho" : new Date(j.runAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Notificaciones + Logs */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title={`Incidencias / Notificaciones (${s.notifications.length})`}>
          {s.notifications.length === 0 ? (
            <Empty>Sin incidencias.</Empty>
          ) : (
            <div className="space-y-1.5">
              {s.notifications.slice(0, 20).map((n) => (
                <div key={n.id} className="rounded-lg border border-white/10 bg-base-700/40 px-3 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className={cn("text-[10px] uppercase", n.level === "error" ? "text-drl" : n.level === "warn" ? "text-drl-gold" : "text-drl-cyan")}>{n.code}</span>
                    <span className="text-[10px] text-white/30">{n.sentTelegram ? "📨 Telegram" : "log"}</span>
                  </div>
                  <p className="text-sm text-white/70">{n.message}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={`Logs (${s.logs.length})`}>
          {s.logs.length === 0 ? (
            <Empty>Sin logs.</Empty>
          ) : (
            <div className="max-h-[320px] space-y-1 overflow-y-auto font-mono text-[11px]">
              {s.logs.slice(0, 60).map((l) => (
                <div key={l.id} className="text-white/55">
                  <span className={cn(l.level === "error" ? "text-drl" : l.level === "warn" ? "text-drl-gold" : "text-white/35")}>
                    [{l.module}]
                  </span>{" "}
                  {l.message}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </section>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("rounded-full px-3 py-1 font-semibold", ok ? "bg-drl-cyan/15 text-drl-cyan" : "bg-white/5 text-white/45")}>
      {ok ? "●" : "○"} {label}
    </span>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-white">{title}</h2>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-white/15 bg-base-700/30 px-4 py-6 text-center text-sm text-white/40">{children}</p>;
}

const KIND_COLOR: Record<string, string> = {
  series: "#c8d2dc", winner: "#37e6a0", mvp: "#ff2e63", icon: "#f5f0e6", prime: "#7b5cff",
};

function CardRow({ card, actions }: { card: GeneratedCard; actions?: React.ReactNode }) {
  const pct = Math.round(card.confidence * 100);
  return (
    <div className="rounded-xl border border-white/10 bg-base-700/50 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded px-1.5 py-0.5 font-display text-[10px] font-bold uppercase" style={{ background: `${KIND_COLOR[card.kind]}22`, color: KIND_COLOR[card.kind] }}>
            {card.kind}
          </span>
          <span className="font-display text-sm font-bold text-white">{card.playerNick}</span>
          <span className="text-[11px] text-white/40">{card.tournamentName}{card.serialLimit ? ` · /${card.serialLimit}` : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("font-display text-xs font-bold", pct >= 90 ? "text-drl-cyan" : "text-drl-gold")}>{pct}%</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] uppercase",
            card.status === "applied" ? "bg-drl-cyan/15 text-drl-cyan" : card.status === "pending" ? "bg-drl-gold/15 text-drl-gold" : "bg-white/10 text-white/40")}>
            {card.status === "applied" ? "insertada" : card.status === "pending" ? "pendiente" : "rechazada"}
          </span>
          {actions}
        </div>
      </div>
      {card.issues.length > 0 && <p className="mt-1 text-[11px] text-white/35">{card.issues.join(" · ")}</p>}
    </div>
  );
}

function MatchRow({ match, pick, correct, onPick, onSimulate }: {
  match: Match; pick?: string; correct?: boolean;
  onPick: (team: string) => void; onSimulate: (team: string) => void;
}) {
  const finished = match.status === "finished";
  return (
    <div className="rounded-xl border border-white/10 bg-base-700/50 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[10px] uppercase" style={{ background: `${STATUS_COLOR[match.status]}22`, color: STATUS_COLOR[match.status] }}>
            {match.status}
          </span>
          <span className="font-display text-sm font-bold text-white">
            {match.teamA} <span className="text-white/40">{match.scoreA ?? "-"}:{match.scoreB ?? "-"}</span> {match.teamB}
          </span>
          {match.winner && <span className="text-[11px] text-drl-cyan">🏆 {match.winner}</span>}
        </div>
        <span className="text-[10px] text-white/35">{new Date(match.startTime).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
      </div>

      {!finished && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-white/40">Pick&apos;em:</span>
          {[match.teamA, match.teamB].map((team) => (
            <button key={team} onClick={() => onPick(team)}
              className={cn("rounded-md px-2.5 py-1 font-display text-[11px] uppercase transition", pick === team ? "bg-drl text-white" : "border border-white/15 text-white/60 hover:text-white")}>
              {team}
            </button>
          ))}
          {pick && (
            <button onClick={() => onSimulate(pick)} className="ml-auto rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase text-white/40 transition hover:text-white" title="Demo: marca el partido como finalizado">
              Simular: gana {pick}
            </button>
          )}
        </div>
      )}
      {finished && pick && (
        <p className={cn("mt-1 text-[11px]", correct ? "text-drl-cyan" : "text-drl")}>
          Tu pick: {pick} — {correct ? "✓ acertado (+recompensas)" : "✗ fallado"}
        </p>
      )}
    </div>
  );
}
