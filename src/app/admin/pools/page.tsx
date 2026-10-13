"use client";

/**
 * /admin/pools — QUÉ CARTAS PUEDEN SALIR EN QUÉ SOBRES (Bloque 8.4.3).
 *
 * ────────────────────────── LO QUE UN POOL DECIDE, Y LO QUE NO ──────────────────────────
 *
 * Un pool contesta a una sola pregunta: **qué cartas pueden tocar en un sobre y cuánto pesa
 * cada una**. Cuántas cartas trae el sobre, con qué probabilidad sale cada rareza, cuándo
 * entra el pity y qué garantiza el sobre siguen viviendo en `PackDef`, en código, y este
 * panel no los toca. Es la línea que 8.3 trazó y que este bloque se limita a respetar:
 * cambiar QUIÉN controla el contenido, no cambiar las reglas del juego.
 *
 * ────────────────────────── POR QUÉ «ACTIVO» SON TRES COSAS ──────────────────────────
 *
 * Un pool reparte cartas hoy si —y solo si— se cumplen las tres: está `ACTIVE`, está dentro
 * de su ventana de disponibilidad, y algún sobre lo tiene vinculado. Un pool `ACTIVE` que
 * ningún sobre usa no reparte nada, y enseñarlo como activo sería mentir por omisión. La
 * columna «reparte» dice la verdad de las tres juntas.
 *
 * ────────────────────────── SIN N+1 ──────────────────────────
 *
 * Todo lo que se ve aquí —cartas, peso, sobres, salud— sale de UNA consulta contra
 * `v_pool_admin`. Preguntando pool a pool serían 48.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Stage, Plate, Recessed, Rail } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Loading, EmptyState } from "@/components/ui/States";
import {
  adminPoolApi, useAsync, ErrorBar, PoolBadge, Select, fmtDate,
} from "@/components/admin/cards/shared";

interface PoolRow {
  id: string; name: string; description: string | null;
  mode: string; lifecycle: string; revision: number;
  seasonId: string | null; eventId: string | null;
  includes: number; excludes: number; pesoTotal: number;
  noPublicadas: number; retiradas: number;
  packs: string[]; nPacks: number;
  updatedAt: string | null; publishedAt: string | null; disponible: boolean;
}

interface Respuesta {
  rows: PoolRow[]; total: number;
  facets: { lifecycles: string[]; packs: string[]; seasons: string[]; events: string[] };
}

const num = (n: number): string => n.toLocaleString("es-ES");

export default function PoolsPage() {
  const { running, error, clear, run } = useAsync<unknown>();
  const [data, setData] = useState<Respuesta | null>(null);
  const [q, setQ] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [packId, setPackId] = useState("");
  const [eventId, setEventId] = useState("");
  const [soloActivos, setSoloActivos] = useState(false);
  const [primerCarga, setPrimerCarga] = useState(false);

  const cargar = useCallback(async () => {
    const r = await run(async () => adminPoolApi<Respuesta>("list", {
      q: q || undefined, lifecycle: lifecycle || undefined,
      packId: packId || undefined, eventId: eventId || undefined,
      soloActivos: soloActivos || undefined,
    }));
    if (r) { setData(r as Respuesta); setPrimerCarga(true); }
  }, [q, lifecycle, packId, eventId, soloActivos, run]);

  // 250 ms: escribir en el buscador no puede disparar una consulta por tecla.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void cargar(); }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [cargar]);

  const hayFiltros = !!(q || lifecycle || packId || eventId || soloActivos);
  const limpiar = (): void => {
    setQ(""); setLifecycle(""); setPackId(""); setEventId(""); setSoloActivos(false);
  };

  // `useMemo` y no `data?.rows ?? []`: la lista vacía sería un array nuevo en cada render y
  // el resumen se recalcularía siempre.
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const resumen = useMemo(() => ({
    activos: rows.filter((r) => r.lifecycle === "ACTIVE" && r.disponible && r.nPacks > 0).length,
    entradas: rows.reduce((s, r) => s + r.includes, 0),
    problemas: rows.filter((r) => r.noPublicadas > 0 || (r.lifecycle === "ACTIVE" && r.nPacks === 0)).length,
  }), [rows]);

  return (
    <Stage data-admin-panel="pools" className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionTitle>Pools y distribución</SectionTitle>
          <p className="mt-1 max-w-2xl text-sm text-white/50">
            Qué cartas pueden salir en qué sobres y con qué peso. Las reglas del sobre
            —cuántas cartas, probabilidad por rareza, pity, garantías— viven en código y no se
            tocan desde aquí.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NxButton href="/admin/cartas" variant="ghost">▣ Cartas</NxButton>
          <NxButton href="/admin/pools/nueva" variant="primary">Nuevo pool</NxButton>
        </div>
      </header>

      <ErrorBar error={error} onClose={clear} />

      {/* ── Filtros ── */}
      <Plate className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block min-w-0" htmlFor="buscar-pool">
            <span className="font-display text-label uppercase tracking-wider text-white/50">Buscar</span>
            <input
              id="buscar-pool" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="nombre o id del pool…" aria-label="Buscar pool por nombre o id"
              className="mt-1 min-h-[44px] w-full border border-white/15 bg-base-800 px-3 text-sm text-white outline-none focus-visible:border-drl"
            />
          </label>
          <Select label="Estado" value={lifecycle} onChange={setLifecycle}
            options={(data?.facets.lifecycles ?? []).map((v) => ({ value: v, label: v }))} />
          <Select label="Sobre" value={packId} onChange={setPackId}
            options={(data?.facets.packs ?? []).map((v) => ({ value: v, label: v }))} vacio="Todos" />
          <Select label="Evento" value={eventId} onChange={setEventId}
            options={(data?.facets.events ?? []).map((v) => ({ value: v, label: v }))} vacio="Todos" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/*
            Un interruptor, no una casilla. Una `<input type=checkbox>` mide 20 px por mucho
            que su etiqueta ocupe 44: el objetivo táctil es la casilla, no el texto. Un botón
            con `aria-pressed` es del tamaño que se le diga, se anuncia igual a un lector de
            pantalla y se pulsa entero.
          */}
          <button
            type="button" aria-pressed={soloActivos}
            onClick={() => setSoloActivos((v) => !v)}
            className={`flex min-h-[44px] items-center gap-2 border px-3 text-sm transition
              ${soloActivos ? "border-drl bg-drl/15 text-white" : "border-white/15 text-white/60 hover:bg-white/5"}`}
          >
            <span aria-hidden className="font-display text-base leading-none">
              {soloActivos ? "◉" : "○"}
            </span>
            Solo los que reparten hoy
          </button>
          {hayFiltros && (
            <NxButton variant="tertiary" onClick={limpiar}>Limpiar filtros</NxButton>
          )}
        </div>
      </Plate>

      {/* ── Resumen ── */}
      <Recessed className="flex flex-wrap gap-x-8 gap-y-2 p-4">
        <Dato label="Pools" valor={num(rows.length)} />
        <Dato label="Reparten hoy" valor={num(resumen.activos)} />
        <Dato label="Entradas en total" valor={num(resumen.entradas)} />
        <Dato label="Con avisos" valor={num(resumen.problemas)}
          tono={resumen.problemas > 0 ? "warn" : undefined} />
      </Recessed>

      {/* ── Resultado ── */}
      {!primerCarga && running ? (
        <Loading label="Cargando pools…" />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin pools" hint="Ningún pool cumple estos filtros." />
      ) : (
        <>
          {/* Escritorio: tabla densa */}
          <Plate className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <caption className="sr-only">Pools de distribución de cartas</caption>
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    {["Pool", "Estado", "Modo", "Cartas", "Peso", "Sobres", "Reparte", "Rev.", "Modificado"]
                      .map((h) => (
                        <th key={h} scope="col"
                          className="px-3 py-2 font-display text-label uppercase tracking-wider text-white/40">
                          {h}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-white/5 transition hover:bg-white/[0.03]">
                      {/* Sin `py`: la altura de la fila la marca el enlace, que reserva sus 44 px. */}
                      <td className="px-3">
                        <Link href={`/admin/pools/${encodeURIComponent(r.id)}`}
                          className="flex min-h-[44px] flex-col justify-center text-drl-cyan underline-offset-2 hover:underline focus-visible:underline">
                          <span className="text-sm">{r.name}</span>
                          <span className="font-mono text-[11px] text-white/40">{r.id}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2"><PoolBadge state={r.lifecycle} /></td>
                      <td className="px-3 py-2 text-white/60">{r.mode}</td>
                      <td className="px-3 py-2 tabular-nums text-white">
                        {num(r.includes)}
                        {r.excludes > 0 && <span className="text-white/40"> −{num(r.excludes)}</span>}
                        {r.noPublicadas > 0 && (
                          <Badge tone="warn" className="ml-2">{r.noPublicadas} sin publicar</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-white/70">{num(r.pesoTotal)}</td>
                      <td className="px-3 py-2 text-white/60">
                        {r.packs.length ? r.packs.join(", ") : <span className="text-white/30">ninguno</span>}
                      </td>
                      <td className="px-3 py-2">
                        {r.lifecycle === "ACTIVE" && r.disponible && r.nPacks > 0
                          ? <Badge tone="ok">sí</Badge>
                          : <Badge tone="muted">no</Badge>}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-white/50">r{r.revision}</td>
                      <td className="px-3 py-2 text-[12px] text-white/45">{fmtDate(r.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Plate>

          {/* Móvil: fichas apiladas. No una tabla encogida. */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <Link key={r.id} href={`/admin/pools/${encodeURIComponent(r.id)}`}
                className="block min-h-[44px] border border-white/10 bg-white/[0.02] p-3 transition hover:bg-white/[0.05] focus-visible:border-drl">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{r.name}</p>
                    <p className="truncate font-mono text-[11px] text-drl-cyan">{r.id}</p>
                  </div>
                  <PoolBadge state={r.lifecycle} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/50">
                  <span>{num(r.includes)} cartas</span>
                  <span>peso {num(r.pesoTotal)}</span>
                  <span>{r.packs.length ? r.packs.join(", ") : "sin sobre"}</span>
                  <span>r{r.revision}</span>
                  {r.lifecycle === "ACTIVE" && r.disponible && r.nPacks > 0 && <Badge tone="ok">reparte</Badge>}
                  {r.noPublicadas > 0 && <Badge tone="warn">{r.noPublicadas} sin publicar</Badge>}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <Rail label="Un pool estrecha y repondera lo que el sobre ya permite; nunca lo ensancha" />
    </Stage>
  );
}

function Dato({ label, valor, tono }: { label: string; valor: string; tono?: "warn" }) {
  return (
    <div>
      <p className="font-display text-label uppercase tracking-wider text-white/40">{label}</p>
      <p className={`font-display text-xl font-bold tabular-nums ${tono === "warn" ? "text-drl-gold" : "text-white"}`}>
        {valor}
      </p>
    </div>
  );
}
