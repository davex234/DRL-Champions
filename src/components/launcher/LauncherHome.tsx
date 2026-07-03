"use client";

/**
 * DRL LAUNCHER — pantalla principal (post-arranque, ya actualizado). Estilo Riot/Steam:
 * logo, noticias, eventos, Live Esports, estado, versión y un JUGAR enorme que entra al
 * juego. La comprobación de actualización ya la hizo el BootGate; aquí el updater solo
 * informa. Comparte la MISMA instancia de UpdaterApi (singleton) con el BootGate.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { BrandMark } from "@/branding/Logo";
import { useNewsStore } from "@/store/useNewsStore";
import { CIRCUITS } from "@/data/esports/circuits";
import { buildInfo, isOnline, getLogs, channelInfo, formatBytes, type LogEntry } from "@/platform";
import type { UpdaterApi } from "./useUpdater";
import { UpdatePanel } from "./UpdatePanel";
import { SettingsDrawer } from "./SettingsDrawer";
import { useUpdateWatcher } from "./useUpdateWatcher";

type Server = "checking" | "online" | "offline";

export function LauncherHome({ up }: { up: UpdaterApi }) {
  const router = useRouter();
  // Comprobación periódica también en el launcher (detecta updates aunque lleve horas abierto).
  useUpdateWatcher();
  const news = useNewsStore((s) => s.items).slice(0, 4);
  const [online, setOnline] = useState(true);
  const [server, setServer] = useState<Server>("checking");
  const [info] = useState(() => buildInfo());
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const events = useMemo(() => CIRCUITS.filter((c) => c.scope === "international").slice(0, 4), []);
  const live = useMemo(() => CIRCUITS.filter((c) => c.tier === "vct-international").slice(0, 3), []);

  useEffect(() => {
    setOnline(isOnline());
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    fetch("https://update.drlchampions.com/health", { method: "HEAD", signal: ctrl.signal, mode: "no-cors" })
      .then(() => setServer("online"))
      .catch(() => setServer("offline"))
      .finally(() => clearTimeout(t));
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      ctrl.abort();
    };
  }, []);

  useEffect(() => {
    if (showLogs) setLogs(getLogs().slice(-60).reverse());
  }, [showLogs, up.state.phase]);

  const ch = channelInfo(up.channel);

  return (
    <div className="relative min-h-screen overflow-hidden bg-base-900 text-white">
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-drl/20 blur-3xl" />
      <div className="absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-drl-cyan/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />

      <div className="relative mx-auto flex min-h-screen max-w-[1440px] flex-col p-6 md:p-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandMark size={44} />
            <div className="leading-none">
              <p className="font-display text-xl font-black uppercase tracking-wide">
                DRL <span className="text-drl">CHAMPIONS</span>
                <span className="ml-2 align-middle text-[9px] font-bold uppercase tracking-widest text-white/30">Launcher</span>
              </p>
              <p className="text-[10px] uppercase tracking-[0.3em] text-white/40">
                Esports Manager · {ch.label} · v{info.full}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge ok={server === "online"} warn={server === "checking"}>
              Servidores: {server === "online" ? "Operativos" : server === "checking" ? "Conectando" : "Sin conexión"}
            </Badge>
            <Badge ok={online} warn={false}>{online ? "En línea" : "Offline"}</Badge>
          </div>
        </header>

        <div className="mt-8 grid flex-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
          <UpdatePanel
            state={up.state}
            busy={up.busy}
            onPlay={() => router.push("/")}
            onUpdate={() => up.start()}
            onRetry={up.check}
          />

          <div className="space-y-3 overflow-y-auto pr-1">
            <StatusCard up={up} fullVersion={info.full} />

            <Panel title="Noticias">
              {news.length === 0 ? (
                <p className="text-[12px] text-white/40">Sin novedades todavía.</p>
              ) : (
                news.map((n) => (
                  <p key={n.id} className="truncate text-[12px] text-white/70">📰 {n.title}</p>
                ))
              )}
            </Panel>

            <Panel title="Próximos eventos">
              {events.map((e) => (
                <Row key={e.id} k={e.name} v={e.region ?? "Global"} />
              ))}
            </Panel>

            <Panel title="Live Esports">
              {live.map((e) => (
                <p key={e.id} className="flex items-center gap-2 text-[12px] text-white/70">
                  <span className={`h-1.5 w-1.5 rounded-full ${online ? "animate-pulse bg-rose-400" : "bg-white/20"}`} />
                  {e.name}
                  <span className="ml-auto text-[10px] uppercase text-white/35">{online ? "LIVE" : "—"}</span>
                </p>
              ))}
            </Panel>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <ActionBtn onClick={up.verify} disabled={up.busy}>🔍 Verificar archivos</ActionBtn>
              <ActionBtn onClick={up.repair} disabled={up.busy}>🛠 Reparar</ActionBtn>
              <ActionBtn onClick={() => setShowSettings(true)}>⚙ Configuración</ActionBtn>
              <ActionBtn onClick={() => setShowLogs((v) => !v)}>📜 {showLogs ? "Ocultar" : "Ver"} logs</ActionBtn>
            </div>

            {up.verifyReport && (
              <Panel title="Integridad">
                {up.verifyReport.checked === 0 ? (
                  <p className="text-[12px] text-white/45">Verificación no disponible aquí (solo escritorio con manifiesto).</p>
                ) : up.verifyReport.ok ? (
                  <p className="text-[12px] text-emerald-300">✓ {up.verifyReport.checked} archivos verificados — todo correcto.</p>
                ) : (
                  <p className="text-[12px] text-rose-300">
                    ✗ {up.verifyReport.missing.length} faltan, {up.verifyReport.corrupt.length} corruptos. Pulsa Reparar.
                  </p>
                )}
              </Panel>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Stat label="Versión" value={`v${info.full}`} />
              <Stat label="Canal" value={ch.label} />
              <Stat label="Plataforma" value={info.platform} />
              <Stat label="Updater" value={updaterLabel(up.state.phase)} accent={phaseAccent(up.state.phase)} />
            </div>

            {showLogs && (
              <Panel title="Registro del launcher">
                <div className="max-h-48 space-y-0.5 overflow-y-auto font-mono text-[10px]">
                  {logs.length === 0 ? (
                    <p className="text-white/40">Sin registros.</p>
                  ) : (
                    logs.map((l, i) => (
                      <p key={i} className={logColor(l.level)}>[{l.scope}] {l.msg}</p>
                    ))
                  )}
                </div>
              </Panel>
            )}
          </div>
        </div>

        <footer className="mt-6 text-center text-[10px] uppercase tracking-[0.3em] text-white/25">
          DRL Champions © · {info.platform === "tauri" ? "Cliente de escritorio" : "Vista previa web"} · v{info.full}
        </footer>
      </div>

      <AnimatePresence>
        {showSettings && (
          <SettingsDrawer
            prefs={up.prefs}
            setPrefs={up.setPrefs}
            channel={up.channel}
            changeChannel={up.changeChannel}
            busy={up.busy}
            onClose={() => setShowSettings(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function updaterLabel(p: string): string {
  return p === "available" ? "Actualizar" : p === "up-to-date" || p === "ready" ? "Al día" : p === "error" ? "Error" : "Trabajando";
}
function phaseAccent(p: string): string {
  if (p === "error") return "#ff7a7a";
  if (p === "available") return "#ffd35c";
  if (p === "up-to-date" || p === "ready") return "#37e6a0";
  return "#7cc0ff";
}
function logColor(level: LogEntry["level"]): string {
  return level === "error" ? "text-rose-300" : level === "warn" ? "text-amber-300" : "text-white/55";
}
function StatusCard({ up, fullVersion }: { up: UpdaterApi; fullVersion: string }) {
  const { phase } = up.state;
  const available = phase === "available";
  const inProgress = up.busy && phase !== "checking";
  return (
    <div
      className={`rounded-2xl border p-4 backdrop-blur-sm transition-colors ${
        available ? "border-drl-gold/40 bg-drl-gold/10" : "border-white/10 bg-base-700/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/40">Versión instalada</p>
          <p className="font-display text-lg font-black text-white">v{fullVersion}</p>
        </div>
        {available ? (
          <span className="rounded-full border border-drl-gold/40 bg-drl-gold/10 px-2.5 py-1 text-[11px] font-bold uppercase text-drl-gold">
            ⚠ Disponible
          </span>
        ) : (
          <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold uppercase text-emerald-300">
            ✔ Actualizado
          </span>
        )}
      </div>

      {available && (
        <div className="mt-3">
          <p className="text-[12px] text-white/65">
            Nueva versión <span className="font-bold text-drl-gold">v{up.state.available}</span>
            {up.state.availableSize != null && (
              <span className="text-white/40"> · {formatBytes(up.state.availableSize)}</span>
            )}
          </p>
          <button
            onClick={() => up.start({ autoInstall: up.prefs.autoInstall, autoRestart: up.prefs.autoRestart })}
            disabled={up.busy}
            className="mt-2 w-full rounded-xl bg-gradient-to-r from-drl-gold to-[#c9962a] px-4 py-2.5 font-display text-sm font-black uppercase tracking-wider text-base-900 shadow-glow transition hover:brightness-110 disabled:opacity-60"
          >
            ⤓ ACTUALIZAR
          </button>
        </div>
      )}

      {inProgress && (
        <div className="mt-2">
          <div className="h-2 overflow-hidden rounded-full bg-base-900">
            <div
              className="h-full rounded-full bg-gradient-to-r from-drl to-drl-gold transition-[width]"
              style={{ width: `${phase === "downloading" ? up.state.percent : 100}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-white/55">
            {phase === "downloading"
              ? `${up.state.percent.toFixed(0)}% · ${formatBytes(up.state.bytesDownloaded)} / ${formatBytes(up.state.bytesTotal)}`
              : "Procesando actualización…"}
          </p>
        </div>
      )}
    </div>
  );
}

function Badge({ children, ok, warn }: { children: React.ReactNode; ok: boolean; warn: boolean }) {
  const cls = warn ? "border-sky-400/40 text-sky-300" : ok ? "border-emerald-400/40 text-emerald-300" : "border-amber-400/40 text-amber-300";
  const dot = warn ? "bg-sky-400 animate-pulse" : ok ? "bg-emerald-400" : "bg-amber-400";
  return (
    <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] uppercase tracking-wider ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/40 p-4 backdrop-blur-sm">
      <p className="mb-2 text-[10px] uppercase tracking-widest text-white/40">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Stat({ label, value, accent = "#e8eef5" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-base-800/60 p-3">
      <p className="text-[9px] uppercase tracking-widest text-white/40">{label}</p>
      <p className="mt-0.5 font-display text-sm font-bold capitalize" style={{ color: accent }}>{value}</p>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <p className="flex justify-between text-[12px]">
      <span className="truncate text-white/55">{k}</span>
      <span className="text-white/75">{v}</span>
    </p>
  );
}
function ActionBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border border-white/10 bg-base-800/60 px-3 py-2 font-semibold text-white/75 transition hover:border-white/25 hover:text-white disabled:opacity-40"
    >
      {children}
    </button>
  );
}
