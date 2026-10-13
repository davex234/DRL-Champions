"use client";

/**
 * BRAIN DEBUG — herramienta para ENTENDER el cerebro de un jugador en vivo.
 * Selecciona un jugador y muestra qué SABE, qué CREE, qué OPCIONES evalúa (con su
 * puntuación), cuál ELIGE y por qué, qué INFO recibió y si CAMBIÓ de idea. TONTO:
 * solo lee `snap.players[x].brain` vía `brainView`.
 */
import type { RoundState } from "@/sim";
import { brainView } from "@/brain";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("sim");

/**
 * El motor compone el motivo en español canónico («opción — factor; creencia») y lo guarda en el estado: no depende
 * del idioma. Aquí se traduce pieza a pieza, igual que las opciones y las creencias de los bloques de arriba.
 */
function reasonText(reason: string): string {
  const m = /^(.*?) — (.*?); (.*)$/.exec(reason);
  return m ? `${td(m[1])} — ${td(m[2])}; ${td(m[3])}` : td(reason);
}

export function BrainDebugPanel({ snap, selectedId, onSelect, onClose }: {
  snap: RoundState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  useLocale();
  const players = snap.players;
  const sel = players.find((p) => p.id === selectedId) ?? players.find((p) => p.alive) ?? players[0];
  const view = sel ? brainView(sel) : null;

  return (
    <div className="pointer-events-auto absolute right-2 top-16 z-30 w-72 rounded-xl border border-drl/40 bg-black/85 p-3 backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-display text-[11px] uppercase tracking-[0.25em] text-drl">{t("🧠 Brain Debug")}</p>
        <button onClick={onClose} className="text-white/40 hover:text-white">✕</button>
      </div>

      {/* Selector de jugador */}
      <div className="mb-2 grid grid-cols-5 gap-1">
        {players.map((p) => (
          <button key={p.id} onClick={() => onSelect(p.id)}
            className={cn("rounded px-1 py-0.5 text-[9px] font-bold uppercase transition",
              p.id === sel?.id ? "bg-drl text-white" : "bg-white/5 text-white/50 hover:bg-white/10",
              !p.alive && "opacity-40 line-through")}
            style={{ color: p.id === sel?.id ? undefined : p.side === "ATK" ? "#ff8a9c" : "#7fe3ff" }}>
            {p.name.slice(0, 4)}
          </button>
        ))}
      </div>

      {view ? (
        <div className="space-y-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-display font-bold uppercase text-white">{view.name}</span>
            <span className="text-white/45">{td(view.role)} · {td(view.agent) ?? "—"}{view.changed && <span className="ml-1 text-amber-300">{t("●cambió")}</span>}</span>
          </div>

          <Block title={t("Sabe")}>
            {view.knows.length ? view.knows.map((k, i) => <div key={i} className="text-white/65">• {td(k)}</div>) : <span className="text-white/30">{t("nada fiable")}</span>}
          </Block>

          <Block title={t("Cree")}>
            {view.believes.map((b, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="flex-1 truncate text-white/70">{td(b.label)}</span>
                <div className="h-1 w-10 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-drl-cyan" style={{ width: `${Math.round(b.prob * 100)}%` }} /></div>
                <span className="w-7 text-right tabular-nums text-white/40">{Math.round(b.prob * 100)}%</span>
              </div>
            ))}
          </Block>

          <Block title={t("Evalúa (puntuación)")}>
            {view.options.map((o, i) => (
              <div key={i} className={cn("flex items-center justify-between", o.chosen && "text-drl font-bold")}>
                <span>{o.chosen ? "▸ " : ""}{td(o.kind)}</span>
                <span className="tabular-nums">{o.score.toFixed(2)}</span>
              </div>
            ))}
          </Block>

          <div className="rounded border border-white/10 bg-white/5 p-1.5">
            <span className="text-white/40">{t("Elige")} </span><span className="font-bold text-drl">{td(view.chosen)}</span>
            <div className="text-[10px] text-white/55">{reasonText(view.reason)}</div>
          </div>

          <div className="flex justify-between text-[10px] text-white/45">
            <span>{t("Recibió:")} {view.received.length ? view.received.join(",") : "—"}</span>
            <span>{t("conf {conf} · tilt {tilt} · pres {pres}", { conf: view.mind.confidence, tilt: view.mind.tilt, pres: view.mind.pressure })}</span>
          </div>
        </div>
      ) : <p className="text-[11px] text-white/40">{t("Sin datos de cerebro.")}</p>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  useLocale();
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-white/35">{td(title)}</p>
      <div className="mt-0.5 space-y-0.5">{children}</div>
    </div>
  );
}
