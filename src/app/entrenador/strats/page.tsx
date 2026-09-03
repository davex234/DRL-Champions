"use client";

/**
 * STRATS — la pizarra del entrenador (Fase 9I).
 *
 * Tres columnas de trabajo: tus estrategias guardadas, la pizarra y el inspector del
 * elemento seleccionado. Es un editor, no un visor: se entra a dibujar.
 *
 * QUÉ ES Y QUÉ NO ES
 *   · SÍ es: mapas propios de NEXUS, cinco fichas de rol, flechas de movimiento, utilidades
 *     con nombre y una secuencia de pasos con su momento.
 *   · NO es: una simulación. No calcula quién gana la ronda, no toca el motor de partido y
 *     no da ninguna ventaja en un duelo. Es la pizarra, y eso es todo lo que promete.
 *
 * Sistema PROPIO: ni el formato, ni el vocabulario, ni los mapas vienen de ninguna
 * herramienta existente. La idea de una pizarra táctica no es de nadie; el contenido sí.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { StrategyBoard } from "@/components/tactics/StrategyBoard";
import {
  TACTICAL_MAPS, getTacticalMap, SIDE_LABEL, ZONE_LABEL, ZONE_COLOR,
  emptyStrat, moveMarker, setMarkerTarget, addMarker, removeMarker,
  addStep, removeStep, validateStrat,
  type Side, type Strat, type StratMarker,
} from "@/domain/tactics";
import { fetchStrats, saveStrat, deleteStrat, type StratRow } from "@/lib/tactics/client";
import { cn } from "@/lib/format";

export default function StratsPage() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Cargando la pizarra…" />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what="la pizarra táctica" />;
  return <Strats />;
}

function Strats() {
  const { toast, notify } = useToast();
  const [rows, setRows] = useState<StratRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** La estrategia que se está editando y, si viene de la lista, su id en servidor. */
  const [strat, setStrat] = useState<Strat>(() => emptyStrat("nueva", "terminal", "attack"));
  const [savedId, setSavedId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await fetchStrats());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las estrategias");
      setRows([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const map = getTacticalMap(strat.mapId) ?? getTacticalMap("terminal")!;
  const selected = strat.markers.find((m) => m.id === selectedId) ?? null;
  const check = useMemo(() => validateStrat(strat), [strat]);

  /** Empieza de cero sobre un mapa y un bando. Descarta lo que hubiera sin guardar. */
  const reset = (mapId: string, side: Side) => {
    setStrat(emptyStrat("nueva", mapId, side, strat.name));
    setSavedId(null);
    setStep(0);
    setSelectedId(null);
  };

  const open = (row: StratRow) => {
    setStrat(row.plan);
    setSavedId(row.id);
    setStep(0);
    setSelectedId(null);
  };

  async function persist() {
    if (saving) return;
    setSaving(true);
    try {
      const { id } = await saveStrat(strat, savedId);
      setSavedId(id);
      notify(savedId ? "Estrategia actualizada" : "Estrategia guardada", true);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo guardar", false);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteStrat(id);
      if (savedId === id) { setSavedId(null); }
      notify("Estrategia borrada", true);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo borrar", false);
    }
  }

  if (error && rows === null) return <ErrorState message={error} onRetry={load} />;
  if (rows === null) return <Loading label="Cargando la pizarra…" />;

  return (
    <div className="space-y-5">
      <header>
        <Link
          href="/entrenador"
          className="-ml-2 inline-flex min-h-[36px] items-center rounded-control px-2 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-white/45 transition duration-fast hover:bg-white/[0.06] hover:text-white"
        >
          ‹ Entrenador
        </Link>
        <h1 className="font-display text-[clamp(26px,4.5vw,42px)] font-bold uppercase leading-none text-white">
          Pizarra
        </h1>
        <p className="mt-1.5 max-w-2xl text-[15px] text-white/55">
          Dibuja la jugada: coloca a los cinco, marca los movimientos y ordena los pasos.
          Los mapas son propios de NEXUS.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_290px]">
        {/* ═══ Guardadas ═══ */}
        <aside className="order-2 xl:order-1">
          <h2 className="nx-label mb-2">Tus estrategias · {rows.length}</h2>
          <div className="flex flex-col gap-1.5">
            {rows.length === 0 && (
              <p className="rounded-card border border-dashed border-white/12 px-3 py-6 text-center text-[13px] text-white/40">
                Todavía no has guardado ninguna.
              </p>
            )}
            {rows.map((r) => (
              <div
                key={r.id}
                className={cn(
                  "flex items-center gap-2 rounded-card border px-3 py-2 transition duration-fast",
                  savedId === r.id ? "border-drl/50 bg-drl/[0.08]" : "border-white/10 hover:border-white/25",
                )}
              >
                <button type="button" onClick={() => open(r)} className="min-w-0 flex-1 text-left">
                  <b className="block truncate font-display text-[14px] text-white">{r.name}</b>
                  <span className="block text-[11px] text-white/40">
                    {getTacticalMap(r.mapId)?.name ?? r.mapId} · {SIDE_LABEL[r.side]}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  aria-label={`Borrar ${r.name}`}
                  className="shrink-0 rounded-chip px-2 py-1 text-white/30 transition duration-fast hover:bg-drl/15 hover:text-drl-glow"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* ═══ La pizarra ═══ */}
        <section className="order-1 min-w-0 xl:order-2">
          {/* Mapa y bando: cambiar cualquiera de los dos empieza una jugada nueva. */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {TACTICAL_MAPS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => reset(m.id, strat.side)}
                aria-pressed={m.id === strat.mapId}
                title={m.identity}
                className={cn(
                  "rounded-control border px-3 py-2 font-display text-[12px] font-bold uppercase tracking-wide transition duration-fast",
                  m.id === strat.mapId
                    ? "border-drl-cyan/60 bg-drl-cyan/10 text-drl-cyan"
                    : "border-white/10 text-white/50 hover:border-white/25 hover:text-white/80",
                )}
              >
                {m.name}
              </button>
            ))}
            <span className="mx-1 w-px self-stretch bg-white/10" aria-hidden />
            {(["attack", "defense"] as Side[]).map((sd) => (
              <button
                key={sd}
                type="button"
                onClick={() => reset(strat.mapId, sd)}
                aria-pressed={sd === strat.side}
                className={cn(
                  "rounded-control border px-3 py-2 font-display text-[12px] font-bold uppercase tracking-wide transition duration-fast",
                  sd === strat.side
                    ? "border-drl/60 bg-drl/10 text-drl-glow"
                    : "border-white/10 text-white/50 hover:border-white/25 hover:text-white/80",
                )}
              >
                {SIDE_LABEL[sd]}
              </button>
            ))}
          </div>

          <p className="mb-3 text-[13px] leading-snug text-white/45">{map.identity}</p>

          {/*
            El mapa es cuadrado, así que acotar el ANCHO acota también el alto. Sin este
            tope, en un monitor ancho la pizarra medía 800 px de alto y las fichas de la
            base quedaban por debajo del pliegue: había que hacer scroll para ver a tu
            propio equipo.
          */}
          <StrategyBoard
            className="mx-auto max-w-[600px]"
            map={map}
            strat={strat}
            step={step}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={(id, x, y) =>
              setStrat((s) =>
                // La pizarra distingue la ficha de la punta de su flecha por el sufijo.
                id.endsWith("::to")
                  ? setMarkerTarget(s, id.slice(0, -4), { x, y })
                  : moveMarker(s, id, x, y),
              )
            }
          />

          {/* Leyenda de zonas: sin ella, los colores del mapa no significan nada. */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {(Object.keys(ZONE_LABEL) as (keyof typeof ZONE_LABEL)[]).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-sm" style={{ background: ZONE_COLOR[k] }} aria-hidden />
                <span className="nx-label">{ZONE_LABEL[k]}</span>
              </span>
            ))}
          </div>

          {/* Pasos: la línea temporal de la jugada. */}
          <div className="mt-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="nx-label">Pasos</h2>
              <button
                type="button"
                onClick={() =>
                  setStrat((s) => addStep(s, `Paso ${s.steps.length + 1}`, (s.steps.at(-1)?.at ?? 0) + 15))
                }
                className="nx-action"
              >
                + Añadir paso
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {strat.steps.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setStep(i)}
                  aria-pressed={i === step}
                  className={cn(
                    "group flex items-center gap-2 rounded-control border px-3 py-2 text-left transition duration-fast",
                    i === step ? "border-drl-cyan/60 bg-drl-cyan/[0.08]" : "border-white/10 hover:border-white/25",
                  )}
                >
                  <span className="font-display text-[11px] font-bold tabular-nums text-white/40">
                    {p.at}s
                  </span>
                  <span className="font-display text-[13px] text-white/85">{p.label}</span>
                  {i > 0 && (
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={`Borrar ${p.label}`}
                      onClick={(e) => { e.stopPropagation(); setStrat((s) => removeStep(s, p.id)); }}
                      className="text-white/25 transition hover:text-drl-glow"
                    >
                      ✕
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ Inspector ═══ */}
        <aside className="order-3 space-y-4">
          <div className="nx-panel p-4">
            <label className="nx-label block" htmlFor="strat-name">Nombre</label>
            <input
              id="strat-name"
              value={strat.name}
              onChange={(e) => setStrat((s) => ({ ...s, name: e.target.value }))}
              maxLength={60}
              className="mt-1 w-full rounded-control border border-white/10 bg-white/[0.05] px-3 py-2 font-display text-base outline-none transition-colors duration-fast focus:border-drl/60"
            />

            <label className="nx-label mt-3 block" htmlFor="strat-notes">Notas</label>
            <textarea
              id="strat-notes"
              value={strat.notes}
              onChange={(e) => setStrat((s) => ({ ...s, notes: e.target.value }))}
              maxLength={1000}
              rows={3}
              placeholder="Qué se busca, qué hacer si sale mal…"
              className="mt-1 w-full resize-y rounded-control border border-white/10 bg-white/[0.05] px-3 py-2 text-[13px] outline-none transition-colors duration-fast placeholder:text-white/25 focus:border-drl/60"
            />

            {!check.ok && (
              <ul className="mt-3 space-y-1">
                {check.issues.map((i) => (
                  <li key={i.code} className="flex gap-1.5 text-[11px] text-drl-glow">
                    <span aria-hidden>✕</span>{i.message}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={persist}
                disabled={saving || !check.ok || strat.name.trim().length === 0}
                className="flex-1 rounded-control bg-drl px-4 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] shadow-glow transition duration-fast hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {saving ? "Guardando…" : savedId ? "Actualizar" : "Guardar"}
              </button>
              {savedId && (
                <button
                  type="button"
                  onClick={() => { setSavedId(null); notify("Se guardará como una copia nueva", true); }}
                  className="rounded-control border border-white/12 px-3 py-2.5 font-display text-xs uppercase tracking-wide text-white/60 transition duration-fast hover:bg-white/5"
                >
                  Duplicar
                </button>
              )}
            </div>
          </div>

          {/* Añadir elementos a la jugada. */}
          <div className="nx-panel p-4">
            <h2 className="nx-label mb-2">Añadir</h2>
            <div className="flex flex-wrap gap-1.5">
              {["Humo", "Destello", "Muro", "Recon", "Nota"].map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() =>
                    setStrat((s) =>
                      addMarker(s, {
                        kind: label === "Nota" ? "note" : "utility",
                        // Aparece en el centro del mapa, a la vista: colocarlo en un borde
                        // obligaría a buscarlo antes de poder arrastrarlo.
                        x: 50, y: 50, label, step,
                      }),
                    )
                  }
                  className="rounded-control border border-white/12 px-3 py-2 font-display text-[12px] uppercase tracking-wide text-white/65 transition duration-fast hover:border-drl-gold/50 hover:text-drl-gold"
                >
                  + {label}
                </button>
              ))}
            </div>
          </div>

          {selected ? (
            <MarkerInspector
              marker={selected}
              stepCount={strat.steps.length}
              onLabel={(label) =>
                setStrat((s) => ({
                  ...s,
                  markers: s.markers.map((m) => (m.id === selected.id ? { ...m, label } : m)),
                }))
              }
              onStep={(v) =>
                setStrat((s) => ({
                  ...s,
                  markers: s.markers.map((m) => (m.id === selected.id ? { ...m, step: v } : m)),
                }))
              }
              onToggleTarget={() =>
                setStrat((s) =>
                  setMarkerTarget(
                    s, selected.id,
                    // Un destino nuevo nace unos pasos por delante para que la flecha se vea
                    // desde el primer momento; luego se arrastra como cualquier ficha.
                    selected.to ? null : { x: selected.x, y: selected.y - 12 },
                  ),
                )
              }
              onRemove={
                selected.kind === "player"
                  ? null
                  : () => { setStrat((s) => removeMarker(s, selected.id)); setSelectedId(null); }
              }
            />
          ) : (
            <p className="rounded-panel border border-dashed border-white/12 px-4 py-6 text-center text-[13px] text-white/40">
              Toca una ficha para editarla. Con el teclado: tabula hasta ella y muévela con las
              flechas.
            </p>
          )}
        </aside>
      </div>

      <Toast toast={toast} />
    </div>
  );
}

/** El panel del elemento seleccionado. Solo lo que se puede cambiar de él. */
function MarkerInspector({
  marker, stepCount, onLabel, onStep, onToggleTarget, onRemove,
}: {
  marker: StratMarker;
  stepCount: number;
  onLabel: (v: string) => void;
  onStep: (v: number) => void;
  onToggleTarget: () => void;
  onRemove: (() => void) | null;
}) {
  return (
    <div className="nx-panel p-4">
      <h2 className="nx-label mb-2">
        {marker.kind === "player" ? `Jugador · ${marker.role}` : marker.kind === "utility" ? "Utilidad" : "Nota"}
      </h2>

      {marker.kind !== "player" && (
        <>
          <label className="nx-label block" htmlFor="marker-label">Etiqueta</label>
          <input
            id="marker-label"
            value={marker.label}
            onChange={(e) => onLabel(e.target.value)}
            maxLength={40}
            className="mt-1 w-full rounded-control border border-white/10 bg-white/[0.05] px-3 py-2 text-[13px] outline-none focus:border-drl/60"
          />
        </>
      )}

      <label className="nx-label mt-3 block" htmlFor="marker-step">Aparece en el paso</label>
      <select
        id="marker-step"
        value={marker.step}
        onChange={(e) => onStep(Number(e.target.value))}
        className="mt-1 w-full rounded-control border border-white/10 bg-surface-base px-3 py-2 text-[13px] outline-none focus:border-drl/60"
      >
        {Array.from({ length: stepCount }, (_, i) => (
          <option key={i} value={i}>Paso {i + 1}</option>
        ))}
      </select>

      <button
        type="button"
        onClick={onToggleTarget}
        className="mt-3 w-full rounded-control border border-white/12 px-3 py-2 font-display text-[12px] uppercase tracking-wide text-white/70 transition duration-fast hover:bg-white/[0.06]"
      >
        {marker.to ? "Quitar movimiento" : "Añadir movimiento"}
      </button>
      {marker.to && (
        <p className="mt-1.5 text-[11px] leading-snug text-white/40">
          Arrastra el círculo punteado del final de la flecha para marcar dónde acaba el
          movimiento.
        </p>
      )}

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="mt-2 w-full rounded-control border border-drl/30 px-3 py-2 font-display text-[12px] uppercase tracking-wide text-drl-glow transition duration-fast hover:bg-drl/10"
        >
          Quitar del mapa
        </button>
      )}
    </div>
  );
}
