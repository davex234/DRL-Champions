"use client";

/**
 * MERCADO — LA HERRAMIENTA.
 *
 * Buscar, ordenar y acotar, en ese orden. Es la misma pieza conceptual que la barra del
 * álbum (Fase 5) y por eso se comporta igual: lo que se usa siempre está a la vista y lo que
 * se usa a veces se pliega, agrupado y con su rótulo.
 *
 * Antes eran, a la vez y sin etiquetas: un campo de texto, TRES desplegables nativos y
 * CATORCE píldoras en dos filas. Un desplegable nativo dentro de un juego se lee como un
 * formulario, y catorce píldoras seguidas no se leen en absoluto.
 *
 * Las facetas y el orden son los que ya existían: esta pieza no inventa criterios.
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

const t = ns("market");

export interface MarketFacet {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}

export function MarketToolbar({
  query, onQuery, sort, onSort, facets, open, onToggle, activeCount, onClear, matched,
}: {
  query: string;
  onQuery: (v: string) => void;
  sort: string;
  onSort: (v: string) => void;
  /** Región, rareza, equipo, OVR mínimo… Salen del dominio; aquí solo se pintan. */
  facets: MarketFacet[];
  open: boolean;
  onToggle: () => void;
  activeCount: number;
  onClear: () => void;
  matched: number;
}) {
  useLocale();
  const filtrando = activeCount > 0 || query !== "";

  return (
    <Plate className="mb-5 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <Recessed className="min-w-[200px] flex-1">
          <label className="flex items-center gap-2 px-3">
            <span aria-hidden className="text-ink-faint">⌕</span>
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={t("Buscar jugador o equipo…")}
              aria-label={t("Buscar en el mercado")}
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
          label={t("Orden")}
          value={sort}
          onChange={onSort}
          options={[
            { value: "price-asc", label: t("Precio ↑") },
            { value: "price-desc", label: t("Precio ↓") },
            { value: "ovr", label: "OVR" },
            { value: "rarity", label: t("Rareza") },
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

      {filtrando && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-edge pt-2.5">
          <span className="text-caption text-ink-faint">
            {fill(t("{n} cartas a la venta", slots("n")), { n: <span className="nx-readout text-ink-secondary">{matched}</span> })}
          </span>
          <span aria-hidden className="h-3 w-px bg-edge" />
          <span className="flex flex-wrap items-center gap-1.5">
            {query && <Badge tone="info">{t("Buscando «{query}»", { query })}</Badge>}
            {facets.filter((f) => f.value !== f.options[0]?.value).map((f) => (
              <Badge key={f.label} tone="muted">
                {td(f.options.find((o) => o.value === f.value)?.label) ?? td(f.value)}
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
