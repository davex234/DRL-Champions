"use client";

/**
 * ÁLBUM — LA HERRAMIENTA.
 *
 * ────────────────────────── QUÉ RESUELVE ──────────────────────────
 *
 * Buscar, ordenar y acotar. En ese orden, porque es el orden en que se usan.
 *
 * Antes: un `<input>` de formulario, un `<select>` nativo y un botón que desplegaba **catorce
 * píldoras seguidas** sin una sola etiqueta que dijera de qué eran. Al abrirlo, la rejilla se
 * iba 120 px hacia abajo y la pantalla pasaba a leerse como una tabla con filtros.
 *
 * Ahora es un raíl de una sola línea:
 *
 *   [ buscar ]  [ Todas · Tengo · Faltan ]  [ Rareza · OVR · Nombre ]  [ Filtros ▾ ]
 *
 * La PROPIEDAD sale del cajón y se queda siempre a la vista: es el filtro que contesta «qué
 * tengo» y «qué me falta», que son dos de las cinco preguntas del álbum. Lo que sí se pliega
 * —región y serie— aparece agrupado y con su rótulo, no como una tira de píldoras anónimas.
 *
 * Y cuando hay algo acotado, se dice qué y se ofrece deshacerlo: un filtro que no se ve es un
 * filtro que se olvida y hace pensar que faltan cartas.
 */
import { Plate, Recessed } from "@/components/ui/Surface";
import { Segmented } from "@/components/ui/Segmented";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Chip } from "@/components/ui/Chip";
import { cn } from "@/lib/format";

export type AlbumOwnership = "todas" | "owned" | "missing";
/** Fase 25 · equipo, serial y reciente se ordenan con datos reales del motor/instancias. */
export type AlbumSort = "rarity" | "ovr" | "name" | "team" | "serial" | "recent";

export interface AlbumFacet<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

export function AlbumToolbar({
  query, onQuery,
  ownership, onOwnership,
  sort, onSort,
  facets,
  open, onToggle,
  activeCount, onClear,
  shown, matched,
}: {
  query: string;
  onQuery: (v: string) => void;
  ownership: AlbumOwnership;
  onOwnership: (v: AlbumOwnership) => void;
  sort: AlbumSort;
  onSort: (v: AlbumSort) => void;
  /** Facetas plegables (región, serie…). Salen del dominio; esta pieza no las inventa. */
  facets: AlbumFacet<string>[];
  open: boolean;
  onToggle: () => void;
  /** Cuántas facetas se apartan de «todo», para decirlo en el botón plegado. */
  activeCount: number;
  onClear: () => void;
  shown: number;
  matched: number;
}) {
  const filtrando = activeCount > 0 || query !== "" || ownership !== "todas";

  return (
    <Plate className="mb-5 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Buscar: un hueco excavado en la placa, no un campo de formulario. */}
        <Recessed className="min-w-[200px] flex-1">
          <label className="flex items-center gap-2 px-3">
            <span aria-hidden className="text-ink-faint">⌕</span>
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Buscar jugador o equipo…"
              aria-label="Buscar en el álbum"
              className="nx-focus min-h-[44px] w-full bg-transparent text-body text-white placeholder:text-ink-faint focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQuery("")}
                aria-label="Borrar la búsqueda"
                className="nx-focus shrink-0 px-1 text-ink-muted transition-colors hover:text-white"
              >
                ✕
              </button>
            )}
          </label>
        </Recessed>

        <Segmented
          label="Estado de la carta"
          value={ownership}
          onChange={onOwnership}
          options={[
            { value: "todas", label: "Todas" },
            { value: "owned", label: "Tengo" },
            { value: "missing", label: "Faltan" },
          ]}
        />

        <Segmented
          label="Orden"
          value={sort}
          onChange={onSort}
          options={[
            { value: "rarity", label: "Rareza" },
            { value: "ovr", label: "OVR" },
            { value: "name", label: "A-Z" },
            { value: "team", label: "Equipo" },
            { value: "serial", label: "Serial" },
            { value: "recent", label: "Reciente" },
          ]}
        />

        <NxButton
          variant={open || activeCount > 0 ? "primary" : "secondary"}
          size="md"
          onClick={onToggle}
          aria-expanded={open}
        >
          Filtros
          {activeCount > 0 && <span className="nx-readout text-caption">{activeCount}</span>}
          <span aria-hidden className={cn("transition-transform duration-fast", open && "rotate-180")}>▾</span>
        </NxButton>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-edge pt-3">
          {facets.map((f) => (
            <div key={f.label} className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="w-[68px] shrink-0 font-display text-label uppercase tracking-wide2 text-ink-faint">
                {f.label}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {f.options.map((o) => (
                  <Chip key={o.value} active={f.value === o.value} onClick={() => f.onChange(o.value)}>
                    {o.label}
                  </Chip>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/*
        Lo que se está viendo, SOLO cuando hay algo que decir. Es la línea que evita el «me
        faltan cartas» cuando en realidad hay un filtro puesto desde hace tres pantallas —pero
        sin filtros no dice nada que la cabecera no diga ya, y una barra vacía es ruido.
      */}
      {filtrando && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-edge pt-2.5">
          <span className="text-caption text-ink-faint">
            <span className="nx-readout text-ink-secondary">{shown}</span> de{" "}
            <span className="nx-readout text-ink-secondary">{matched}</span> cartas
          </span>
          <span aria-hidden className="h-3 w-px bg-edge" />
          <span className="flex flex-wrap items-center gap-1.5">
            {query && <Badge tone="info">Buscando «{query}»</Badge>}
            {ownership !== "todas" && (
              <Badge tone="key">{ownership === "owned" ? "Solo las que tengo" : "Solo las que faltan"}</Badge>
            )}
            {facets.filter((f) => f.value !== f.options[0]?.value).map((f) => (
              <Badge key={f.label} tone="muted">
                {f.options.find((o) => o.value === f.value)?.label ?? f.value}
              </Badge>
            ))}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="nx-focus ml-auto font-display text-label uppercase tracking-wide2 text-ink-muted transition-colors hover:text-white"
          >
            Limpiar
          </button>
        </div>
      )}
    </Plate>
  );
}
