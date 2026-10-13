"use client";

/**
 * Colecciones — página PRIVADA ("Mis Colecciones").
 *
 * Lista todas las colecciones (local + Supabase) con MI progreso (%, obtenidas/
 * faltantes), filtros y reclamación de la recompensa exclusiva al completar.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { useGameStore } from "@/store/useGameStore";
import { useRosterStore } from "@/store/useRosterStore";
import { useCollectionsStore } from "@/store/useCollectionsStore";
import { mergedCollections } from "@/lib/collections/repos";
import { collectionProgress, overallProgress } from "@/domain/collections/progress";
import { rewardSummary } from "@/lib/collections/format";
import type { CollectionDef } from "@/domain/collections/types";
import { cn } from "@/lib/format";
import { Plate, Piece, Recessed } from "@/components/ui/Surface";
import { Loading } from "@/components/ui/States";
import { Segmented } from "@/components/ui/Segmented";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { useServerEconomy, SERVER_ECONOMY_ONLY } from "@/lib/game/serverEconomy";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("colecciones");

export default function ColeccionesPage() {
  return (
    <HydrationGate>
      <Colecciones />
    </HydrationGate>
  );
}

type StatusFilter = "todas" | "completas" | "incompletas";
type SourceFilter = "todas" | "tournament" | "local";

function Colecciones() {
  useLocale();
  const { toast, notify } = useToast();
  const ownedCards = useGameStore((s) => s.ownedCards);
  const rosterVersion = useRosterStore((s) => s.version);
  const claimed = useCollectionsStore((s) => s.claimed);
  const claim = useCollectionsStore((s) => s.claim);
  /* F69 · el reclamo es LOCAL (applyReward): con cuenta inventaba saldo en el HUD. Solo sin cuenta. */
  const serverEconomy = useServerEconomy();

  const [defs, setDefs] = useState<CollectionDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("todas");
  const [source, setSource] = useState<SourceFilter>("todas");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    mergedCollections().then((d) => { if (alive) { setDefs(d); setLoading(false); } });
    return () => { alive = false; };
  }, [rosterVersion]);

  const ownedIds = useMemo(() => new Set(ownedCards.map((o) => o.cardId)), [ownedCards]);
  const overall = useMemo(() => overallProgress(defs, ownedIds), [defs, ownedIds]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return defs
      .map((d) => ({ def: d, prog: collectionProgress(d, ownedIds) }))
      .filter(({ def, prog }) => {
        if (q && !def.name.toLowerCase().includes(q)) return false;
        if (source !== "todas" && def.source !== source) return false;
        if (status === "completas" && !prog.complete) return false;
        if (status === "incompletas" && prog.complete) return false;
        return true;
      })
      .sort((a, b) => b.prog.pct - a.prog.pct);
  }, [defs, ownedIds, query, status, source]);
  /** FULL GAME AUDIT · sin ninguna colección no se enseña «0/0 completas · 0/0 cartas · 0 % global» ni filtros vacíos. */
  const none = !loading && defs.length === 0;

  return (
    <section className="animate-rise space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/*
            FASE 12 · MISMA ESCALA QUE LAS DEMÁS. Este H1 usaba `text-3xl` —30 px fijos— y
            se quedaba en 30 a 1440 mientras las pantallas hermanas subían a 44. Medido en
            la pasada global: seis tamaños distintos de H1 para el mismo papel.
          */}
          <h1 className="font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white">
            {fill(t("Mis {palabra}", slots("palabra")), { palabra: <span className="text-drl">{t("Colecciones")}</span> })}
          </h1>
          {!none && (
            <p className="mt-1 text-white/50">
              {t("{hechas}/{colecciones} completas · {tengo}/{total} cartas · {pct}% global.", {
                hechas: overall.completed, colecciones: overall.collections, tengo: overall.owned, total: overall.total, pct: overall.pct,
              })}
            </p>
          )}
        </div>
      </header>

      {/*
        ═══ FASE 12 · LOS DOS ÚLTIMOS DESPLEGABLES NATIVOS DEL PRODUCTO ═══

        `Segmented` existe y su propia documentación dice para qué: «la alternativa honesta
        al `<select>` nativo, que en un juego se lee como un formulario». Estas dos listas
        —tres opciones excluyentes cada una— son exactamente su caso, y eran los dos únicos
        `<select>` que quedaban en una pantalla de jugador.

        Mismos filtros, mismos valores, mismo estado. Lo que cambia es que se ven todos y
        que dejan de abrir una rueda del sistema operativo encima de la pantalla en móvil.
      */}
      {!none && <div className="flex flex-wrap items-center gap-2">
        <Campo
          value={query}
          onChange={setQuery}
          placeholder={t("Buscar colección…")}
          aria-label={t("Buscar colección")}
          className="min-w-[12rem] flex-1"
        />
        <Segmented
          label={t("Fuente")}
          value={source}
          onChange={setSource}
          options={[
            { value: "todas" as SourceFilter, label: t("Todas") },
            { value: "tournament" as SourceFilter, label: t("Torneos") },
            { value: "local" as SourceFilter, label: t("Eventos") },
          ]}
        />
        <Segmented
          label={t("Estado")}
          value={status}
          onChange={setStatus}
          options={[
            { value: "todas" as StatusFilter, label: t("Cualquiera") },
            { value: "completas" as StatusFilter, label: t("Completas") },
            { value: "incompletas" as StatusFilter, label: t("Incompletas") },
          ]}
        />
      </div>}

      {loading ? (
        /* El mismo estado de carga que el resto del producto, no un párrafo suelto. */
        <Loading label={t("Cargando colecciones")} />
      ) : none ? (
        <Plate className="px-6 py-10 text-center" data-testid="collections-none">
          <p className="font-display text-h3 font-bold uppercase tracking-wide text-white">{t("Todavía no hay colecciones")}</p>
          <p className="mx-auto mt-1.5 max-w-[56ch] text-body text-ink-muted">
            {t("Los sets de colección y sus insignias están en la Sala de Trofeos.")}
          </p>
          <Link href="/coleccion/trofeos" className="nx-action mt-3 inline-flex min-h-[44px] items-center">{t("Ir a la Sala de Trofeos →")}</Link>
        </Plate>
      ) : rows.length === 0 ? (
        <Plate className="px-6 py-10 text-center">
          <p className="font-display text-h3 font-bold uppercase tracking-wide text-white">
            {t("Ninguna colección coincide")}
          </p>
          <p className="mx-auto mt-1.5 max-w-[56ch] text-body text-ink-muted">
            {t("Las colecciones de torneo aparecen cuando un torneo se cierra; las de eventos están siempre disponibles.")}
          </p>
        </Plate>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {rows.map(({ def, prog }) => {
            const claimId = `coll:${def.id}`;
            const isClaimed = claimed.includes(claimId);
            return (
              <Piece key={def.id} tone={prog.complete ? "cyan" : "neutral"} className="relative overflow-hidden p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* FASE 12 · 44 px: el nombre era el enlace de la tarjeta y medía 23 de alto. */}
                    <Link href={`/colecciones/${def.slug}`}
                      className="nx-focus inline-flex min-h-[44px] items-center font-display text-lg font-bold uppercase text-white transition-colors duration-fast hover:text-drl">
                      {td(def.name)}
                    </Link>
                    <p className="text-[11px] uppercase tracking-widest text-white/40">
                      {def.source === "tournament" ? t("Torneo") : t("Evento")}{def.tier ? ` · ${def.tier}` : ""}
                    </p>
                  </div>
                  <Readout size="md" value={`${prog.pct}%`} tone="var(--nx-cyan)" className="shrink-0" align="right" />
                </div>

                <div className="mt-3 flex items-center gap-3">
                  {/*
                    FASE 12 · `role="progressbar"`: era un `div` con un ancho en línea, así
                    que el avance de la colección no llegaba a un lector de pantalla.
                  */}
                  <Recessed
                    depth="sm"
                    className="h-2 flex-1 overflow-hidden"
                    role="progressbar"
                    aria-label={t("Progreso de {name}", { name: td(def.name) })}
                    aria-valuenow={prog.pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span
                      className={cn("block h-full origin-left transition-transform duration-normal motion-reduce:transition-none",
                        prog.complete ? "bg-gradient-to-r from-drl-cyan to-drl" : "bg-white/30")}
                      style={{ transform: `scaleX(${prog.pct / 100})` }}
                    />
                  </Recessed>
                  <span className="font-display text-xs tabular-nums text-white/50">{prog.owned}/{prog.total}</span>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  {/*
                    FASE 12 · El regalo iba con un emoji `🎁` y el reclamado con un glifo
                    `✓`. La recompensa se dice con su texto y el estado con la insignia del
                    sistema, que es lo que usan las otras diez pantallas.
                  */}
                  <span className="min-w-0 flex-1 truncate font-display text-xs text-drl-gold">
                    {rewardSummary(def.reward)}
                  </span>
                  {isClaimed ? (
                    <Badge tone="info" dot>{t("Reclamado")}</Badge>
                  ) : (
                    <NxButton
                      variant="primary"
                      size="md"
                      disabled={!prog.complete || serverEconomy}
                      title={serverEconomy ? td(SERVER_ECONOMY_ONLY) : undefined}
                      onClick={() => { if (serverEconomy) return; if (claim(claimId, def.reward)) notify(t("¡Recompensa de {name} reclamada!", { name: td(def.name) }), true); }}
                    >
                      {t("Reclamar")}
                    </NxButton>
                  )}
                </div>
                {prog.missing.length > 0 && (
                  <p className="nx-label mt-2">{t("Faltan {n} cartas.", { n: prog.missing.length })}</p>
                )}
              </Piece>
            );
          })}
        </div>
      )}

      <Toast toast={toast} />
    </section>
  );
}

/**
 * CAMPO DE TEXTO DEL SISTEMA.
 *
 * Sigue siendo un `<input>` nativo —lo que se escribe es texto— pero con la superficie
 * hundida de la casa y 44 px de alto, como el de la pizarra del Entrenador.
 */
function Campo({
  value, onChange, className, ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className">) {
  return (
    <input
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "nx-clip-sm min-h-[44px] bg-black/35 px-3 text-[13px] text-white outline-none",
        "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] placeholder:text-ink-faint",
        "focus:shadow-[inset_0_0_0_1px_rgb(255_46_99_/_0.6)]",
        className,
      )}
    />
  );
}
