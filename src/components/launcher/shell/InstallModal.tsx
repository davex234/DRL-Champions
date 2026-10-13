"use client";

/**
 * LAUNCHER — DIÁLOGO DE INSTALACIÓN.
 *
 * Elegir unidad, ver lo que ocupa y lo que queda libre, y confirmar. El botón de instalar se
 * BLOQUEA si no cabe: un cliente que te deja empezar una descarga de 38 GB en una unidad con
 * 18 GB libres para fallar cuarenta minutos después no es un cliente, es una trampa.
 *
 * El requisito se calcula con holgura sobre el tamaño anunciado (`checkSpace`), porque los
 * temporales de descompresión existen.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { formatBytes } from "@/platform";
import { DISKS, checkSpace, jobBytesFor, type DownloadKind, type Game } from "@/launcher";
import { cn } from "@/lib/format";
import { Meter } from "@/components/ui/Meter";
import { NxButton } from "@/components/ui/NxButton";

export function InstallModal({
  game, kind, defaultPath, onConfirm, onClose, motionScale,
}: {
  game: Game | null;
  kind: DownloadKind;
  defaultPath: string;
  onConfirm: (path: string) => void;
  onClose: () => void;
  motionScale: number;
}) {
  const [diskId, setDiskId] = useState(() => DISKS.find((d) => d.path === defaultPath)?.id ?? DISKS[0].id);
  const [folder, setFolder] = useState("");

  useEffect(() => {
    if (game) {
      setDiskId(DISKS.find((d) => d.path === defaultPath)?.id ?? DISKS[0].id);
      setFolder("");
    }
  }, [game, defaultPath]);

  const disk = DISKS.find((d) => d.id === diskId) ?? DISKS[0];
  const bytes = game ? jobBytesFor(game, kind) : 0;
  const space = useMemo(() => checkSpace(disk, bytes), [disk, bytes]);
  const path = `${disk.path}${folder ? `\\${folder.replace(/^[\\/]+/, "")}` : game ? `\\${game.id}` : ""}`;
  const usedPct = ((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100;
  const afterPct = Math.min(100, ((disk.totalBytes - disk.freeBytes + space.requiredBytes) / disk.totalBytes) * 100);

  useEffect(() => {
    if (!game) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [game, onClose]);

  return (
    <AnimatePresence>
      {game && (
        <motion.div
          className="fixed inset-0 z-modal grid place-items-center bg-black/80 p-6 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motionScale > 0 ? 0.2 : 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`Instalar ${game.name}`}
        >
          <motion.div
            initial={{ opacity: 0, y: 22, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: motionScale > 0 ? 0.3 : 0, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="nx-clip w-full max-w-[560px] overflow-hidden border border-white/10 bg-[#0a0c14] shadow-[0_40px_120px_-30px_rgba(0,0,0,1)]"
          >
            <div
              className="flex items-center justify-between border-b border-white/[0.07] px-6 py-4"
              style={{ background: `linear-gradient(90deg, ${game.palette.key}22, transparent 70%)` }}
            >
              <div>
                <p className="font-display text-[9.5px] font-bold uppercase tracking-[0.28em] text-white/40">
                  {kind === "update" ? "Actualizar" : "Instalar"}
                </p>
                <h2 className="font-display text-[22px] font-black uppercase leading-none tracking-wide text-white">
                  {game.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="nx-clip-sm h-8 w-8 text-white/45 transition hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-5 p-6">
              <div>
                <p className="mb-2 font-display text-label font-bold uppercase tracking-[0.24em] text-white/40">
                  Ubicación de instalación
                </p>
                <div className="space-y-1.5">
                  {DISKS.map((d) => {
                    const s = checkSpace(d, bytes);
                    const on = d.id === diskId;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setDiskId(d.id)}
                        className={cn(
                          "nx-clip-sm flex w-full items-center gap-3 px-3 py-2.5 text-left transition",
                          on ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                        )}
                        style={{ boxShadow: on ? "inset 0 0 0 1px rgba(255,46,99,0.5)" : "inset 0 0 0 1px rgba(255,255,255,0.06)" }}
                      >
                        <span
                          aria-hidden
                          className="grid h-4 w-4 shrink-0 place-items-center rounded-full border"
                          style={{ borderColor: on ? "var(--nx-accent)" : "rgba(255,255,255,0.25)" }}
                        >
                          {on && <span className="h-2 w-2 rounded-full bg-drl" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-semibold text-white/85">{d.label}</span>
                          <span className="block truncate font-mono text-[10.5px] text-white/35">{d.path}</span>
                        </span>
                        <span className={cn("shrink-0 nx-readout text-[12px]", s.ok ? "text-white/60" : "text-bad")}>
                          {formatBytes(d.freeBytes)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block font-display text-label font-bold uppercase tracking-[0.24em] text-white/40">
                  Subcarpeta (opcional)
                </label>
                <input
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder={game.id}
                  className="nx-clip-sm w-full bg-black/50 px-3 py-2 font-mono text-[12px] text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-drl/60"
                  style={{ boxShadow: "inset 0 1px 3px rgba(0,0,0,0.8)" }}
                />
                <p className="mt-1.5 truncate font-mono text-caption text-white/35">{path}</p>
              </div>

              {/* Ocupación del disco: barra doble — lo usado y lo que pasará a estar usado. */}
              <div className="nx-clip-sm bg-black/30 p-4" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}>
                <div className="mb-2 grid grid-cols-3 gap-3">
                  <Stat label="Descarga" value={formatBytes(bytes)} />
                  <Stat label="Espacio necesario" value={formatBytes(space.requiredBytes)} tone={space.ok ? undefined : "var(--nx-bad)"} />
                  <Stat label="Disponible" value={formatBytes(space.freeBytes)} tone={space.ok ? "var(--nx-ok)" : "var(--nx-bad)"} />
                </div>
                <div className="relative">
                  <Meter value={afterPct} tone={space.ok ? "info" : "bad"} height={7} />
                  <div className="pointer-events-none absolute inset-0">
                    <Meter value={usedPct} tone="muted" height={7} />
                  </div>
                </div>
                <p className="mt-2 text-caption" style={{ color: space.ok ? "rgba(255,255,255,0.4)" : "var(--nx-bad)" }}>
                  {space.ok
                    ? `Quedarán ${formatBytes(space.freeBytes - space.requiredBytes)} libres en ${disk.label}.`
                    : `Faltan ${formatBytes(space.missingBytes)} en ${disk.label}. Elige otra unidad.`}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-white/[0.07] bg-black/30 px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                className="font-display text-caption font-bold uppercase tracking-[0.2em] text-white/45 transition hover:text-white"
              >
                Cancelar
              </button>
              <NxButton
                variant="primary" accent={kind === "update" ? "gold" : "primary"}
                size="md"
                disabled={!space.ok}
                onClick={() => onConfirm(path)}
              >
                {kind === "update" ? "Actualizar ahora" : "Instalar"}
              </NxButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-display text-[9px] font-bold uppercase tracking-[0.2em] text-white/30">{label}</p>
      <p className="nx-readout truncate text-[14px]" style={{ color: tone ?? "var(--nx-ink)" }}>{value}</p>
    </div>
  );
}
