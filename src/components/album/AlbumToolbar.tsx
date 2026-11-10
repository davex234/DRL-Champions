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
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("album");

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
  useLocale();
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
              placeholder={t("Buscar jugador o equipo…")}
              aria-label={t("Buscar en el álbum")}
              className="nx-focus min-h-[44px] w-full bg-transparent text-body text-white placeholder:text-ink-faint focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQuery("")}
                aria-label={t("Borrar la búsqueda")}
                className="nx-focus shrink-0 px-1 text-ink-muted transition-colors hover:text-white"
              >
                ✕
              </button>
            )}
          </label>
        </Recessed>

        <Segmented
          label={t("Estado de la carta")}
          value={ownership}
          onChange={onOwnership}
          options={[
            { value: "todas", label: t("Todas") },
            { value: "owned", label: t("Tengo") },
            { value: "missing", label: t("Faltan") },
          ]}
        />

        <Segmented
          label={t("Orden")}
          value={sort}
          onChange={onSort}
          options={[
            { value: "rarity", label: t("Rareza") },
            { value: "ovr", label: t("OVR") },
            { value: "name", label: t("A-Z") },
            { value: "team", label: t("Equipo") },
            { value: "serial", label: t("Serial") },
            { value: "recent", label: t("Reciente") },
          ]}
        />

        <NxButton
          variant={open || activeCount > 0 ? "primary" : "secondary"}
          size="md"
          onClick={onToggle}
          aria-expanded={open}
        >
          {t("Filtros")}
          {activeCount > 0 && <span className="nx-readout text-caption">{activeCount}</span>}
          <span aria-hidden className={cn("transition-transform duration-fast", open && "rotate-180")}>▾</span>
        </NxButton>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-edge pt-3">
          {facets.map((f) => (
            <div key={f.label} className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="w-[68px] shrink-0 font-display text-label uppercase tracking-wide2 text-ink-faint">
                {td(f.label)}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {f.options.map((o) => (
                  <Chip key={o.value} active={f.value === o.value} onClick={() => f.onChange(o.value)}>
                    {td(o.label)}
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
            {fill(t("{shown} de {matched} cartas", slots("shown", "matched")), {
              shown: <span className="nx-readout text-ink-secondary">{shown}</span>,
              matched: <span className="nx-readout text-ink-secondary">{matched}</span>,
            })}
          </span>
          <span aria-hidden className="h-3 w-px bg-edge" />
          <span className="flex flex-wrap items-center gap-1.5">
            {query && <Badge tone="info">{t("Buscando «{query}»", { query })}</Badge>}
            {ownership !== "todas" && (
              <Badge tone="key">{ownership === "owned" ? t("Solo las que tengo") : t("Solo las que faltan")}</Badge>
            )}
            {facets.filter((f) => f.value !== f.options[0]?.value).map((f) => (
              <Badge key={f.label} tone="muted">
                {td(f.options.find((o) => o.value === f.value)?.label) ?? f.value}
              </Badge>
            ))}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="nx-focus ml-auto font-display text-label uppercase tracking-wide2 text-ink-muted transition-colors hover:text-white"
          >
            {t("Limpiar")}
          </button>
        </div>
      )}
    </Plate>
  );
}
