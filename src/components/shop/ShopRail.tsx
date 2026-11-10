"use client";

/**
 * ARMERÍA — EL CARRIL DE SOBRES.
 *
 * ────────────────────────── QUÉ RESUELVE ──────────────────────────
 *
 * La tienda enseñaba SEIS tarjetas idénticas, cada una con su sobre, su barra, su párrafo de
 * economía y su botón. Seis productos con el mismo peso es un catálogo, no una armería: no
 * había forma de saber cuál estabas mirando porque no estabas mirando ninguno.
 *
 * Aquí los sobres son una LISTA de objetos y solo uno está en la vitrina. Cada fila dice lo
 * único que hace falta para elegir —qué es, cuánto cuesta y si ya tienes alguno— y el resto
 * se cuenta en el escenario, una vez.
 *
 * El sobre se dibuja con la MISMA pieza que se compra y se abre (`SealedPack`), en miniatura.
 * No hay una segunda representación del objeto.
 */
import type { PackDef } from "@/domain/packs/types";
import { SealedPack } from "@/components/packs/SealedPack";
import { packIdentity, type PackCategory } from "@/components/packs/packIdentity";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { formatCredits, cn, plural } from "@/lib/format";

/**
 * EL ORDEN DE LAS FAMILIAS en el carril. Es una decisión de escaparate, no del catálogo: se
 * empieza por donde empieza un jugador nuevo y se termina por el producto de coleccionista.
 *
 * Vive aquí y no en `packIdentity` porque es propio de ESTA pantalla; la identidad de un
 * producto no depende de en qué orden lo enseñe una tienda.
 */
const ORDEN: PackCategory[] = ["inicial", "nexus", "team", "regional", "icono", "event"];

export function ShopRail({
  packs, selectedId, onSelect, owned, credits,
}: {
  packs: PackDef[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Sobres sin abrir por id. Sale del inventario real. */
  owned: Record<string, number>;
  credits: number;
}) {
  /*
   * ── AGRUPADO POR FAMILIA ──
   *
   * El carril nació con seis sobres y era una lista. Con dieciséis —cuatro regionales, cuatro
   * de equipo, el de bienvenida, los de la casa y el de coleccionista— una lista plana obliga a
   * leerla entera para encontrar algo. Agrupar no añade información: la ORDENA, y de paso hace
   * visible que el catálogo tiene familias.
   *
   * La categoría la deriva `packIdentity` de los datos del catálogo; aquí no se decide nada.
   */
  const grupos = ORDEN
    .map((cat) => ({
      cat,
      label: packs.find((p) => packIdentity(p).category === cat) ? categoriaLabel(packs, cat) : "",
      items: packs.filter((p) => packIdentity(p).category === cat),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="grid gap-3">
      {grupos.map((g) => (
        <section key={g.cat} aria-label={g.label}>
          {/*
            El rótulo de familia solo aparece si hay más de un grupo: con un catálogo de un
            solo tipo, un encabezado por grupo sería una etiqueta sin contraste que ordenar.
          */}
          {grupos.length > 1 && (
            <p className="mb-1 px-2.5 font-display text-label font-bold uppercase tracking-wide2 text-ink-faint">
              {g.label}
            </p>
          )}
          <Filas
            packs={g.items}
            selectedId={selectedId}
            onSelect={onSelect}
            owned={owned}
            credits={credits}
          />
        </section>
      ))}
    </div>
  );
}

/** El rótulo de una familia, tomado de la identidad del primer sobre que la representa. */
function categoriaLabel(packs: PackDef[], cat: PackCategory): string {
  const p = packs.find((x) => packIdentity(x).category === cat);
  return p ? packIdentity(p).categoryLabel : cat;
}

/** Las filas de una familia. Es el carril de siempre, ahora reutilizado por grupo. */
function Filas({
  packs, selectedId, onSelect, owned, credits,
}: {
  packs: PackDef[];
  selectedId: string;
  onSelect: (id: string) => void;
  owned: Record<string, number>;
  credits: number;
}) {
  return (
    <ul className="grid gap-2">
      {packs.map((p) => {
        const activo = p.id === selectedId;
        const tengo = owned[p.id] ?? 0;
        const alcanza = p.price === 0 || credits >= p.price;
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(p.id)}
              aria-current={activo ? "true" : undefined}
              className={cn(
                "nx-focus nx-clip-sm relative flex w-full items-center gap-3 p-2.5 text-left transition-colors duration-fast",
                activo ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
              )}
            >
              {/* Filo de selección: la única marca de «estás mirando este». */}
              <span
                aria-hidden
                className="absolute inset-y-1.5 left-0 w-[3px] rounded-full transition-transform duration-fast"
                style={{
                  background: p.accent,
                  transform: `scaleY(${activo ? 1 : 0})`,
                  boxShadow: activo ? `0 0 12px ${p.accent}` : "none",
                }}
              />

              <span className="pointer-events-none shrink-0" aria-hidden>
                <SealedPack pack={p} cutProgress={0} width={40} />
              </span>

              <span className="min-w-0 flex-1">
                <span className={cn("block truncate font-display text-caption font-bold uppercase tracking-wide", activo ? "text-white" : "text-ink-secondary")}>
                  {p.name}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <span className="font-display text-label uppercase tracking-wide2 text-ink-faint">
                    {plural(p.cardCount, "carta", "cartas")}
                  </span>
                  {tengo > 0 && <Badge tone="info">{tengo} sin abrir</Badge>}
                </span>
              </span>

              <Readout
                size="xs"
                align="right"
                value={p.price === 0 ? "Gratis" : formatCredits(p.price)}
                tone={p.price === 0 ? "var(--nx-ok)" : alcanza ? "var(--nx-gold)" : "var(--nx-ink-faint)"}
                className="shrink-0"
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
