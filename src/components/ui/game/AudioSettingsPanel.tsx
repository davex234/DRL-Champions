"use client";

/**
 * FASE 44 · AJUSTES DE SONIDO — general, efectos y silencio. Se guardan en este dispositivo (`lib/sound`), sin cuenta.
 * FASE 44.1 · MÚSICA y EFECTOS por separado: cada uno con su deslizador 0–100 y su propio silencio, además del
 * silencio general. Controles nativos (`input type="range"`, botones con `aria-pressed`) con aspecto de juego:
 * operables con teclado y lector de pantalla, 44 px de zona táctil.
 */
import { useEffect, useId, useState } from "react";
import { DEFAULT_AUDIO, getAudioSettings, playSound, setAudioSettings, type AudioSettings } from "@/lib/sound";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("ui");

type Channel = { key: "music" | "sfx"; muteKey: "musicMuted" | "sfxMuted"; label: string; hint: string };
export const AUDIO_CHANNELS: readonly Channel[] = [
  { key: "music", muteKey: "musicMuted", label: "Música", hint: "Ambiente de cada sala, original y generado en el juego" },
  { key: "sfx", muteKey: "sfxMuted", label: "Efectos", hint: "Botones, sobres, cartas y partida" },
];

function Toggle({ on, onClick, label, testId, small = false }: { on: boolean; onClick: () => void; label: string; testId: string; small?: boolean }) {
  useLocale();
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={td(label)}
      onClick={onClick}
      className={cn("nx-clip-sm min-h-[44px] px-4 font-display text-[13px] font-bold uppercase tracking-[0.12em] transition-colors duration-fast", small ? "min-w-[92px]" : "min-w-[112px]",
        on ? "bg-drl-cyan/15 text-drl-cyan shadow-[inset_0_0_0_1px_rgba(25,227,255,0.5)]" : "bg-white/[0.05] text-white/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]")}
      data-testid={testId}
    >
      {on ? t("Activado") : t("Silenciado")}
    </button>
  );
}

export function AudioSettingsPanel({ className }: { className?: string }) {
  useLocale();
  const [s, setS] = useState<AudioSettings>(DEFAULT_AUDIO);
  const masterId = useId();
  const musicId = useId();
  const sfxId = useId();
  const ids = { music: musicId, sfx: sfxId };
  useEffect(() => { setS(getAudioSettings()); }, []);

  const update = (next: Partial<AudioSettings>) => setS(setAudioSettings(next));

  return (
    <div className={cn("space-y-4", className)} data-testid="audio-settings">
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-[15px] font-bold uppercase tracking-[0.08em] text-white">{t("Sonido")}</span>
        <Toggle on={!s.muted} label={s.muted ? t("Activar todo el sonido") : t("Silenciar todo el sonido")} testId="audio-mute"
          onClick={() => { const next = setAudioSettings({ muted: !s.muted }); setS(next); if (!next.muted) playSound("ui.confirm"); }} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
        <label htmlFor={masterId} className="text-[14px] text-white/75">{t("Volumen general")}</label>
        <span className="nx-readout text-[14px] text-white/70">{Math.round(s.master * 100)} %</span>
        <input id={masterId} type="range" min={0} max={100} step={5} value={Math.round(s.master * 100)} disabled={s.muted}
          onChange={(e) => update({ master: Number(e.target.value) / 100 })} onPointerUp={() => playSound("ui.confirm")}
          className="col-span-2 h-11 w-full cursor-pointer accent-[#19e3ff] disabled:cursor-not-allowed disabled:opacity-40" data-testid="audio-master" />
      </div>

      {AUDIO_CHANNELS.map((c) => {
        const channelOn = !s[c.muteKey];
        const disabled = s.muted || !channelOn;
        return (
          <div key={c.key} className="nx-clip-sm border border-white/10 bg-white/[0.02] px-3 py-2.5" data-channel={c.key}>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={ids[c.key]} className="min-w-0">
                <span className="block font-display text-[14px] font-bold uppercase tracking-[0.1em] text-white">{td(c.label)}</span>
                <span className="block text-[12px] text-white/50">{td(c.hint)}</span>
              </label>
              <Toggle small on={channelOn} label={channelOn ? t("Silenciar {label}", { label: c.label.toLowerCase() }) : t("Activar {label}", { label: c.label.toLowerCase() })} testId={`audio-${c.key}-mute`}
                onClick={() => { const next = setAudioSettings({ [c.muteKey]: channelOn }); setS(next); if (c.key === "sfx" && !next.sfxMuted) playSound("ui.confirm"); }} />
            </div>
            <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
              <input id={ids[c.key]} type="range" min={0} max={100} step={5} value={Math.round(s[c.key] * 100)} disabled={disabled}
                onChange={(e) => update({ [c.key]: Number(e.target.value) / 100 })} onPointerUp={() => playSound("ui.confirm")}
                className="h-11 w-full cursor-pointer accent-[#19e3ff] disabled:cursor-not-allowed disabled:opacity-40" data-testid={`audio-${c.key}`} />
              <span className="nx-readout w-12 text-right text-[14px] text-white/70">{Math.round(s[c.key] * 100)} %</span>
            </div>
          </div>
        );
      })}
      <p className="text-[12px] text-white/45">{t("Se guarda en este dispositivo. Nada suena hasta que interactúas con el juego.")}</p>
    </div>
  );
}
