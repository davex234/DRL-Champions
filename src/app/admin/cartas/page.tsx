"use client";

/**
 * /admin/cartas — EL LISTADO (Bloque 8.4.1).
 *
 * ────────────────────────── DATOS REALES, PAGINADOS EN LA BASE ──────────────────────────
 *
 * Cada tecla del buscador y cada filtro son una consulta a `/api/admin/cards` con
 * `action: "list"`, que filtra, ordena y pagina **en PostgreSQL**. No se traen las 773
 * cartas para enseñar 25, y el recuento de pools de la página se resuelve con UNA consulta
 * agregada — no con una por fila.
 *
 * Ni `localStorage`, ni estado de cliente como fuente de verdad, ni un solo dato inventado:
 * todo lo que se ve aquí sale de `content_cards`, `content_players` y
 * `content_pool_entries`.
 *
 * ────────────────────────── TABLA EN ESCRITORIO, FICHAS EN MÓVIL ──────────────────────────
 *
 * Una tabla de once columnas a 390 px no es una tabla: es un desplazamiento horizontal.
 * Debajo de `md` se pinta la misma información apilada, con la misma jerarquía. No es una
 * versión reducida — es la misma lista con otra forma.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Stage, Plate, Recessed, Rail } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { NxButton } from "@/components/ui/NxButton";
import { Readout } from "@/components/ui/Readout";
import { Loading, EmptyState } from "@/components/ui/States";
import {
  adminApi, useAsync, ErrorBar, LifecycleBadge, BucketBadge, fmtDate, Select,
} from "@/components/admin/cards/shared";
import { cn } from "@/lib/format";
import { ns, td as i18nTd, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

interface Row {
  cardId: string; playerId: string; nick: string; team: string;
  variantId: string; variantLabel: string;
  rarityRank: number; rarityBucket: string; ovr: number;
  lifecycle: string; definitionVersion: number; origin: string;
  pools: number; createdAt: string; publishedAt: string | null; updatedAt: string | null;
}
interface Facets {
  lifecycles: string[];
  variants: { id: string; label: string; rank: number }[];
  buckets: string[]; origins: string[];
  pools: { id: string; name: string; lifecycle: string }[];
}
type Sort = "player" | "ovr" | "rarity" | "updated" | "lifecycle";

const PAGE_SIZE = 25;

export default function CartasPage() {
  useLocale();
  const [facets, setFacets] = useState<Facets | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [q, setQ] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [variant, setVariant] = useState("");
  const [bucket, setBucket] = useState("");
  const [origin, setOrigin] = useState("");
  const [poolId, setPoolId] = useState("");
  const [sort, setSort] = useState<Sort>("player");
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  const { running, error, clear, run } = useAsync<unknown>();
  const [primerCargaHecha, setPrimerCargaHecha] = useState(false);

  useEffect(() => {
    void run(async () => setFacets(await adminApi<Facets>("facets")));
  }, [run]);

  const cargar = useCallback(async (p: number) => {
    const r = await run(async () => adminApi<{ rows: Row[]; total: number }>("list", {
      q: q || undefined, lifecycle: lifecycle || undefined, variant: variant || undefined,
      bucket: bucket || undefined, origin: origin || undefined, poolId: poolId || undefined,
      sort, dir, page: p, pageSize: PAGE_SIZE,
    }));
    if (r) {
      const d = r as { rows: Row[]; total: number };
      setRows(d.rows); setTotal(d.total); setPage(p);
    }
    setPrimerCargaHecha(true);
  }, [run, q, lifecycle, variant, bucket, origin, poolId, sort, dir]);

  /*
   * El buscador espera 250 ms antes de consultar. Sin eso, escribir «benjy» son cinco
   * consultas de las que cuatro se tiran — y en un panel que se usa a diario, eso se nota.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void cargar(1); }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [cargar]);

  const paginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hayFiltros = !!(q || lifecycle || variant || bucket || origin || poolId);
  const limpiar = () => {
    setQ(""); setLifecycle(""); setVariant(""); setBucket(""); setOrigin(""); setPoolId("");
  };

  const resumen = useMemo(() => {
    const porEstado = rows.reduce<Record<string, number>>((a, r) => {
      a[r.lifecycle] = (a[r.lifecycle] ?? 0) + 1; return a;
    }, {});
    return Object.entries(porEstado).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <Stage data-admin-panel="cartas" className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionTitle>{t("Cartas")}</SectionTitle>
          <p className="mt-1 text-sm text-white/50">
            {hayFiltros
              ? t("Catálogo persistido. {total} definiciones con los filtros actuales.", { total: total.toLocaleString(getIntlLocale()) })
              : t("Catálogo persistido. {total} definiciones.", { total: total.toLocaleString(getIntlLocale()) })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NxButton href="/admin/cartas/nueva" variant="primary">{t("Nueva carta")}</NxButton>
          <NxButton href="/admin" variant="ghost">{t("Volver al panel")}</NxButton>
        </div>
      </header>

      <ErrorBar error={i18nTd(error)} onClose={clear} />

      {/* ── Filtros ── */}
      <Plate className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="lg:col-span-2">
            <span className="font-display text-label uppercase tracking-wider text-white/50">{t("Buscar")}</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("card id o jugador…")}
              aria-label={t("Buscar por card id o jugador")}
              className="mt-1 min-h-[44px] w-full border border-white/15 bg-base-800 px-3 text-sm text-white outline-none focus-visible:border-drl"
            />
          </label>
          <Select label={t("Estado")} value={lifecycle} onChange={setLifecycle}
            options={(facets?.lifecycles ?? []).map((l) => ({ value: l, label: l }))} />
          <Select label={t("Rareza")} value={bucket} onChange={setBucket}
            options={(facets?.buckets ?? []).map((b) => ({ value: b, label: b }))} />
          <Select label={t("Variante")} value={variant} onChange={setVariant}
            options={(facets?.variants ?? []).map((v) => ({ value: v.id, label: `${v.label} (r${v.rank})` }))} />
          <Select label={t("Procedencia")} value={origin} onChange={setOrigin}
            options={(facets?.origins ?? []).map((o) => ({ value: o, label: o }))} />
          <Select label={t("Pool")} value={poolId} onChange={setPoolId}
            options={(facets?.pools ?? []).map((p) => ({ value: p.id, label: `${p.id} · ${p.lifecycle}` }))} />
          <div className="flex items-end gap-2">
            <Select label={t("Orden")} value={sort} onChange={(v) => setSort(v as Sort)} noEmpty
              options={[
                { value: "player", label: t("Jugador") }, { value: "ovr", label: "OVR" },
                { value: "rarity", label: t("Rareza") }, { value: "updated", label: t("Modificación") },
                { value: "lifecycle", label: t("Estado") },
              ]} />
            <NxButton
              variant="secondary" size="md"
              onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
              aria-label={dir === "asc" ? t("Orden ascendente, cambiar a descendente") : t("Orden descendente, cambiar a ascendente")}
            >
              {dir === "asc" ? "↑" : "↓"}
            </NxButton>
          </div>
        </div>
        {hayFiltros && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <NxButton variant="tertiary" onClick={limpiar}>{t("Limpiar filtros")}</NxButton>
            {resumen.map(([estado, n]) => (
              <span key={estado} className="font-display text-label uppercase tracking-wider text-white/40">
                {i18nTd(estado)} {n}
              </span>
            ))}
          </div>
        )}
      </Plate>

      {/* ── Resultado ── */}
      {!primerCargaHecha && running ? (
        <Loading label={t("Cargando catálogo…")} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("Sin resultados")}
          hint={t("Ninguna carta cumple estos filtros. Prueba a limpiarlos.")}
        />
      ) : (
        <>
          {/* Escritorio: tabla densa */}
          <Plate className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <caption className="sr-only">{t("Catálogo de cartas del juego")}</caption>
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    {[t("Card ID"), t("Jugador"), t("Variante"), t("Rareza"), "OVR", t("Estado"), t("Ver."), t("Pools"), t("Publicada"), t("Modificada")]
                      .map((h) => (
                        <th key={h} scope="col"
                          className="px-3 py-2 font-display text-label uppercase tracking-wider text-white/40">
                          {i18nTd(h)}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.cardId} className="border-b border-white/5 transition hover:bg-white/[0.03]">
                      {/* Sin `py`: la altura de la fila la marca el enlace, que reserva sus 44 px de
                          objetivo tactil. A 768 px esta tabla se toca con el dedo, y 84x14 no se acierta. */}
                      <td className="px-3">
                        <Link href={`/admin/cartas/${encodeURIComponent(r.cardId)}`}
                          className="flex min-h-[44px] items-center font-mono text-[12px] text-drl-cyan underline-offset-2 hover:underline focus-visible:underline">
                          {r.cardId}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-white/90">{r.nick}</span>
                        {r.team && <span className="ml-1 text-white/35">{r.team}</span>}
                      </td>
                      <td className="px-3 py-2 text-white/70">{i18nTd(r.variantLabel)}</td>
                      <td className="px-3 py-2"><BucketBadge bucket={r.rarityBucket} rank={r.rarityRank} /></td>
                      <td className="px-3 py-2 font-display font-bold text-white">{r.ovr}</td>
                      <td className="px-3 py-2"><LifecycleBadge state={r.lifecycle} /></td>
                      <td className="px-3 py-2 text-white/60">v{r.definitionVersion}</td>
                      <td className="px-3 py-2 text-white/60">{r.pools}</td>
                      <td className="px-3 py-2 text-[12px] text-white/45">{fmtDate(r.publishedAt)}</td>
                      <td className="px-3 py-2 text-[12px] text-white/45">{fmtDate(r.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Plate>

          {/* Móvil: la misma información, apilada */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <Link key={r.cardId} href={`/admin/cartas/${encodeURIComponent(r.cardId)}`} className="block">
                <Recessed className="p-3 transition active:brightness-110">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-display text-sm font-bold uppercase text-white">
                        {r.nick} <span className="text-white/40">{i18nTd(r.variantLabel)}</span>
                      </p>
                      <p className="truncate font-mono text-[11px] text-drl-cyan">{r.cardId}</p>
                    </div>
                    <Readout value={r.ovr} label={t("OVR")} size="sm" align="right" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <LifecycleBadge state={r.lifecycle} />
                    <BucketBadge bucket={r.rarityBucket} rank={r.rarityRank} />
                    <span className="font-display text-label uppercase tracking-wider text-white/40">
                      {t("v{version} · {n} pools", { version: r.definitionVersion, n: r.pools })}
                    </span>
                  </div>
                </Recessed>
              </Link>
            ))}
          </div>

          {/* ── Paginación ── */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/50">
              {t("Página {page} de {pages} · {total} cartas", { page, pages: paginas, total: total.toLocaleString(getIntlLocale()) })}
            </p>
            <div className="flex gap-2">
              <NxButton variant="secondary" disabled={page <= 1 || running}
                onClick={() => void cargar(page - 1)}>{t("Anterior")}</NxButton>
              <NxButton variant="secondary" disabled={page >= paginas || running}
                onClick={() => void cargar(page + 1)}>{t("Siguiente")}</NxButton>
            </div>
          </div>
        </>
      )}

      <Rail label={t("El catálogo vive en content_cards; esta pantalla solo lo consulta")} />
    </Stage>
  );
}

/** Desplegable con la misma altura táctil que el resto de controles (44 px). */
