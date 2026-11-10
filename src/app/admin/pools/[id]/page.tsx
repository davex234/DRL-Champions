"use client";

/**
 * /admin/pools/[id] — LA FICHA DE UN POOL (Bloque 8.4.3).
 *
 * Todo lo que se hace con un pool se hace aquí: mirar qué contiene, cambiar pesos, añadir y
 * quitar cartas, ver a qué sobres afecta, publicarlo y simular. No hay una pantalla aparte
 * para editar porque editar un pool ES mirarlo: se cambia un peso y hay que ver enseguida qué
 * cuota queda.
 *
 * ────────────────────────── EL PESO ES RELATIVO ──────────────────────────
 *
 * El administrador escribe PESOS, no porcentajes. Con A=10, B=20 y C=5 el total es 35 y las
 * cuotas salen solas: 28,571 %, 57,143 % y 14,286 %. Pedir porcentajes que sumen 100 obligaría
 * a recalcular todos los demás cada vez que se toca uno, que es justo el trabajo que la
 * máquina debe hacer.
 *
 * ────────────────────────── DOS NÚMEROS DISTINTOS, Y NO SE MEZCLAN ──────────────────────────
 *
 *   CUOTA EN EL POOL    weight ÷ peso total del pool. Es lo que se controla aquí.
 *   P EN EL SOBRE       P(bucket) × P(carta|bucket). Depende del sobre, de qué buckets tienen
 *                       stock y de los pesos por rareza del `PackDef`.
 *
 * Enseñar la cuota del pool como si fuera la probabilidad del sobre sería el error más fácil
 * de cometer y el más difícil de detectar: una carta con el 50 % del peso de un pool de
 * legendarias sale en menos de una de cada mil aperturas. Por eso la probabilidad real se
 * pregunta carta a carta, contra un sobre concreto, y se enseña descompuesta.
 *
 * ────────────────────────── POR QUÉ SE EDITA ENTRADA A ENTRADA ──────────────────────────
 *
 * La tabla pagina —un pool real tiene 772 entradas— así que guardar «todas» desde aquí
 * enviaría solo las 25 cargadas y borraría el resto. Cada cambio va por su propia operación
 * atómica (`entryUpsert` / `entryRemove`), que sube la revisión y deja línea en el diario.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Stage, Plate, Recessed, Rail } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Loading, ErrorState } from "@/components/ui/States";
import {
  adminApi, adminPoolApi, useAsync, ErrorBar, ConfirmDialog, PoolBadge, BucketBadge,
  LifecycleBadge, Field, FieldGrid, fmtDate, fmtCuota, Select, SheetHeading,
} from "@/components/admin/cards/shared";
import { CardPreview } from "@/components/admin/cards/CardPreview";
import { getVariant } from "@/domain/cards/variants";
import type { CombatStats } from "@/domain/cards/combat";
import type { Player, VariantId } from "@/domain/cards/types";
import { PACKS } from "@/data/packs";
import { ns, td as i18nTd, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const i18nT = ns("admin");

interface EntryRow {
  cardId: string; playerId: string; nick: string; team: string;
  variantId: string; variantLabel: string; rarityBucket: string; rarityRank: number;
  ovr: number; cardLifecycle: string; definitionVersion: number;
  weight: number; mode: string; note: string | null; cuota: number; elegible: boolean;
}

interface Sheet {
  pool: Record<string, unknown>;
  revision: number;
  packs: { packId: string; priority: number; enabled: boolean; existe: boolean; nombre: string }[];
  entries: EntryRow[];
  entriesTotal: number; page: number; pageSize: number;
  resumen: {
    includes: number; excludes: number; pesoTotal: number; pesoActivo: number;
    elegibles: number; draft: number; retiradas: number;
    porBucket: Record<string, { cartas: number; peso: number }>;
  };
  audit: Record<string, unknown>[];
  distributionVersion: number;
}

interface Odds {
  cardId: string; packId: string; packName: string; configurado: boolean;
  enPool: boolean; motivo: string | null; bucket: string | null;
  weight: number; pesoBucket: number; pEnBucket: number; pBucket: number;
  pPorHueco: number; huecos: number; pAlMenosUna: number; cartasEnBucket: number;
  composicion: { poolId: string; priority: number; weight: number | null; manda: boolean }[];
}

interface Sim {
  packId: string; aperturas: number; cartas: number; ms: number;
  configurado: boolean; distributionVersion: number;
  buckets: { bucket: string; esperado: number; observado: number; n: number }[];
  top: { cardId: string; nick: string; variantLabel: string; bucket: string;
         weight: number; esperado: number; observado: number; n: number }[];
}

type Accion = null | "activar" | "retirar" | "borrador" | "quitar";

const num = (n: number): string => n.toLocaleString(getIntlLocale(), { maximumFractionDigits: 4 });

export default function PoolSheetPage() {
  useLocale();
  const params = useParams<{ id: string }>();
  const poolId = decodeURIComponent(String(params.id));
  const { running, error, clear, run } = useAsync<unknown>();

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [accion, setAccion] = useState<Accion>(null);
  const [aQuitar, setAQuitar] = useState<EntryRow | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await run(async () => adminPoolApi<Sheet>("sheet", { poolId, page, q: q || undefined }));
    if (r) { setSheet(r as Sheet); setConflicto(null); }
  }, [poolId, page, q, run]);

  useEffect(() => { void cargar(); }, [cargar]);

  /** Ejecuta y recarga. Si otro se adelantó, lo dice y no pierde nada. */
  const ejecutar = useCallback(async (fn: () => Promise<unknown>, mensaje: string): Promise<boolean> => {
    const r = await run(async () => {
      try { return await fn(); } catch (e) {
        const err = e as Error & { conflict?: boolean; current?: number };
        if (err.conflict) {
          setConflicto(`${err.message}${err.current ? i18nT(" La revisión vigente es r{current}.", { current: err.current }) : ""}`);
        }
        throw err;
      }
    });
    setAccion(null); setAQuitar(null);
    if (r === null) return false;
    setAviso(mensaje);
    await cargar();
    return true;
  }, [run, cargar]);

  const pool = sheet?.pool;
  const estado = pool ? String(pool.lifecycle) : "";
  const editable = estado === "DRAFT" || estado === "ACTIVE";
  const totalPaginas = sheet ? Math.max(1, Math.ceil(sheet.entriesTotal / sheet.pageSize)) : 1;

  if (!sheet && running) return <Stage className="p-6"><Loading label={i18nT("Cargando el pool…")} /></Stage>;
  if (!sheet || !pool) {
    return (
      <Stage className="space-y-4 p-6">
        <ErrorBar error={i18nTd(error)} onClose={clear} />
        <ErrorState message={i18nT("No se pudo cargar el pool {poolId}", { poolId: i18nTd(poolId) })} onRetry={() => void cargar()} />
        <NxButton href="/admin/pools" variant="secondary">{i18nT("Volver al listado")}</NxButton>
      </Stage>
    );
  }

  const r = sheet.resumen;

  return (
    <Stage data-admin-panel="pool" className="space-y-5 p-4 sm:p-6">
      {/* ── Cabecera ── */}
      <SheetHeading
        kicker={sheet.packs.length > 0
          ? i18nT("Pool · reparte en {v}", { v: sheet.packs.map((p) => p.nombre).join(", ") })
          : i18nT("Pool · sin sobre vinculado")}
        title={String(pool.name)}
        badges={
          <>
            <PoolBadge state={estado} />
            <Badge tone="muted">{String(pool.mode)}</Badge>
            <Badge tone="muted">r{sheet.revision}</Badge>
          </>
        }
        meta={
          <>
            {poolId}
            {pool.description ? (
              <span className="mt-1 block max-w-2xl font-sans text-sm text-white/50">
                {String(pool.description)}
              </span>
            ) : null}
          </>
        }
        action={<div className="flex flex-wrap gap-2">
          <NxButton href="/admin/pools" variant="ghost">{i18nT("← Pools")}</NxButton>
          {estado === "DRAFT" && (
            <NxButton variant="primary" onClick={() => setAccion("activar")}>{i18nT("Publicar")}</NxButton>
          )}
          {estado === "ACTIVE" && (
            <>
              <NxButton variant="secondary" onClick={() => setAccion("borrador")}>{i18nT("Volver a borrador")}</NxButton>
              <NxButton variant="danger" onClick={() => setAccion("retirar")}>{i18nT("Retirar")}</NxButton>
            </>
          )}
          {estado === "RETIRED" && (
            <NxButton variant="secondary" onClick={() => setAccion("activar")}>{i18nT("Reactivar")}</NxButton>
          )}
        </div>}
      />

      <ErrorBar error={conflicto ? null : i18nTd(error)} onClose={clear} />

      {conflicto && (
        <Plate className="space-y-2 border border-drl-gold/40 p-4" role="alert">
          <p className="font-display text-sm font-bold uppercase tracking-wider text-drl-gold">
            {i18nT("Otro administrador se ha adelantado")}
          </p>
          <p className="text-sm text-white/70">{i18nTd(conflicto)}</p>
          <p className="text-sm text-white/50">
            {i18nT("No se ha guardado nada. Recarga para ver la configuración que hay ahora y decide sobre esa base.")}
          </p>
          <NxButton variant="secondary" onClick={() => void cargar()}>{i18nT("Recargar el pool")}</NxButton>
        </Plate>
      )}

      {aviso && (
        <Recessed className="flex items-center justify-between gap-3 p-3">
          <p className="text-sm text-white/70">{i18nTd(aviso)}</p>
          <NxButton variant="ghost" onClick={() => setAviso(null)} aria-label={i18nT("Cerrar aviso")}>✕</NxButton>
        </Recessed>
      )}

      {/* ── Resumen ── */}
      <section aria-labelledby="h-resumen">
        <h2 id="h-resumen" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
          {i18nT("Resumen")}
        </h2>
        <Plate className="space-y-4 p-4">
          <FieldGrid cols={4}>
            <Field label={i18nT("Entradas INCLUDE")}>{num(r.includes)}</Field>
            <Field label={i18nT("Entradas EXCLUDE")}>{num(r.excludes)}</Field>
            <Field label={i18nT("Peso total")}>{num(r.pesoTotal)}</Field>
            <Field label={i18nT("Peso que reparte")}>{num(r.pesoActivo)}</Field>
            <Field label={i18nT("Cartas elegibles")}>{num(r.elegibles)}</Field>
            <Field label={i18nT("En borrador")}>{r.draft > 0 ? <span className="text-drl-gold">{r.draft}</span> : 0}</Field>
            <Field label={i18nT("Retiradas")}>{r.retiradas > 0 ? <span className="text-drl-gold">{r.retiradas}</span> : 0}</Field>
            <Field label={i18nT("Versión de distribución")}>{sheet.distributionVersion}</Field>
          </FieldGrid>

          {(r.draft > 0 || r.retiradas > 0) && (
            <Recessed className="p-3">
              <p className="text-[12px] leading-relaxed text-white/60">
                {r.draft > 0 && (
                  <>
                    {fill(i18nT("{n} entrada(s) apuntan a cartas en {estado}: el sorteo no las reparte, y activar este pool con ellas dentro se rechaza.", slots("n", "estado")), { n: <strong className="text-drl-gold">{r.draft}</strong>, estado: <code>DRAFT</code> })}{" "}
                  </>
                )}
                {r.retiradas > 0 && (
                  <>
                    {fill(i18nT("{n} apuntan a cartas {estado}: {conservan}. Retirar una carta la saca de los sobres nuevos, no la borra del histórico del pool ni de las manos de quien la tenga.", slots("n", "estado", "conservan")), { n: <strong className="text-drl-gold">{r.retiradas}</strong>, estado: <code>RETIRED</code>, conservan: <strong>{i18nT("se conservan a propósito")}</strong> })}
                  </>
                )}
              </p>
            </Recessed>
          )}

          <div>
            <p className="mb-2 font-display text-label uppercase tracking-wider text-white/40">
              {i18nT("Reparto por rareza (solo cartas elegibles)")}
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(r.porBucket).map(([b, v]) => (
                <Recessed key={b} className="min-w-[110px] p-2">
                  <BucketBadge bucket={b} />
                  <p className="mt-1 text-sm tabular-nums text-white">{num(v.cartas)} {i18nT("cartas")}</p>
                  <p className="text-[11px] tabular-nums text-white/45">{i18nT("peso")} {num(v.peso)}</p>
                </Recessed>
              ))}
            </div>
          </div>
        </Plate>
      </section>

      {/* ── Sobres ── */}
      <section aria-labelledby="h-sobres">
        <h2 id="h-sobres" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
          {i18nT("Sobres que usan este pool ({n})", { n: sheet.packs.length })}
        </h2>
        <Plate className="space-y-3 p-4">
          {sheet.packs.length === 0 ? (
            <p className="text-sm text-white/50">
              {i18nT("Ningún sobre lo usa todavía, así que no reparte nada aunque esté activo.")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sheet.packs.map((p) => (
                <Recessed key={p.packId} className="p-3">
                  <p className="text-sm text-white">{i18nTd(p.nombre)}</p>
                  <p className="font-mono text-[11px] text-white/40">{p.packId}</p>
                  <p className="mt-1 text-[12px] text-white/50">
                    {i18nT("prioridad")} {p.priority}
                    {!p.existe && <Badge tone="bad" className="ml-2">{i18nT("el sobre no existe en código")}</Badge>}
                  </p>
                  <NxButton
                    variant="tertiary" className="mt-2" disabled={running}
                    aria-label={i18nT("Desvincular {nombre} de este pool", { nombre: i18nTd(p.nombre) })}
                    onClick={() => void ejecutar(
                      () => adminPoolApi("unbind", { packId: p.packId, poolId }),
                      i18nT("«{nombre}» ya no usa este pool.", { nombre: i18nTd(p.nombre) }),
                    )}
                  >
                    {i18nT("Desvincular")}
                  </NxButton>
                </Recessed>
              ))}
            </div>
          )}

          {/*
            VINCULAR, DESDE LA PANTALLA.
            La API tenía `bind`/`unbind` desde 8.3 y el panel no las exponía: un administrador
            podía construir el pool entero y no tenía forma de decir en qué sobre reparte. Sin
            esto, el último paso del recorrido —«y ahora ábrelo»— exigía una llamada a mano.
          */}
          <BindPack
            poolId={poolId}
            vinculados={sheet.packs.map((p) => p.packId)}
            running={running}
            onBind={(packId, nombre) => void ejecutar(
              () => adminPoolApi("bind", { packId, poolId, priority: 10 }),
              i18nT("«{nombre}» reparte ahora este pool.", { nombre: i18nTd(nombre) }),
            )}
          />

          {/*
            LA SEMÁNTICA DE `priority`, dicha en la pantalla y no solo en un informe.
            Es el malentendido más caro posible aquí: un administrador que crea que la
            prioridad hace exclusivo un pool acabará repartiendo cartas que creía haber
            apartado.
          */}
          <Recessed className="p-3">
            <p className="text-[12px] leading-relaxed text-white/60">
              {fill(i18nT("Cuando un sobre tiene {varios}, sus cartas se {unen}. La prioridad {no} hace exclusivo a un pool: solo decide {peso} cuando la misma carta aparece en dos de ellos —gana el de prioridad más baja—. Para que una carta NO salga, hay que excluirla ({exclude}), que gana siempre.", slots("varios", "unen", "no", "peso", "exclude")), {
                varios: <strong>{i18nT("varios pools")}</strong>,
                unen: <strong className="text-white">{i18nT("UNEN")}</strong>,
                no: <strong>{i18nT("no")}</strong>,
                peso: <strong>{i18nT("qué peso manda")}</strong>,
                exclude: <code>EXCLUDE</code>,
              })}
            </p>
          </Recessed>
        </Plate>
      </section>

      {/* ── Entradas ── */}
      <section aria-labelledby="h-entradas">
        <h2 id="h-entradas" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
          {i18nT("Cartas del pool ({n})", { n: num(sheet.entriesTotal) })}
        </h2>
        <Plate className="p-4">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="block min-w-0 flex-1" htmlFor="buscar-entrada">
              <span className="font-display text-label uppercase tracking-wider text-white/50">
                {i18nT("Buscar en el pool")}
              </span>
              <input
                id="buscar-entrada" value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder={i18nT("card id…")} aria-label={i18nT("Buscar carta dentro del pool")}
                className="mt-1 min-h-[44px] w-full border border-white/15 bg-base-800 px-3 text-sm text-white outline-none focus-visible:border-drl"
              />
            </label>
          </div>

          <EntriesTable
            entries={sheet.entries}
            editable={editable}
            running={running}
            onWeight={(entry, weight) => void ejecutar(
              () => adminPoolApi("entryUpsert", {
                poolId, cardId: entry.cardId, weight, mode: entry.mode,
                reason: i18nT("Peso de {cardId}: {weight} → {weight2}", { cardId: entry.cardId, weight: entry.weight, weight2: weight }),
                expectedRevision: sheet.revision,
              }),
              i18nT("Peso de {cardId} actualizado a {weight}.", { cardId: entry.cardId, weight }),
            )}
            onQuitar={(entry) => { setAQuitar(entry); setAccion("quitar"); }}
          />

          {totalPaginas > 1 && (
            <nav className="mt-3 flex flex-wrap items-center gap-2" aria-label={i18nT("Paginación de entradas")}>
              <NxButton variant="secondary" disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}>{i18nT("← Anterior")}</NxButton>
              <span className="text-sm tabular-nums text-white/50">
                {page} / {totalPaginas}
              </span>
              <NxButton variant="secondary" disabled={page >= totalPaginas}
                onClick={() => setPage((p) => p + 1)}>{i18nT("Siguiente →")}</NxButton>
            </nav>
          )}
        </Plate>
      </section>

      {/* ── Añadir ── */}
      {editable && (
        <AddCard
          poolId={poolId}
          revision={sheet.revision}
          pesoTotal={r.pesoTotal}
          onHecho={(msg) => { setAviso(msg); void cargar(); }}
          onConflicto={setConflicto}
        />
      )}

      {/* ── Probabilidad y simulación ── */}
      <Probabilidad packs={sheet.packs.map((p) => p.packId)} entries={sheet.entries} />

      {/* ── Diario ── */}
      <section aria-labelledby="h-diario">
        <h2 id="h-diario" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
          {i18nT("Diario ({n})", { n: sheet.audit.length })}
        </h2>
        <Plate className="overflow-hidden">
          {sheet.audit.length === 0 ? (
            <p className="p-4 text-sm text-white/40">{i18nT("Sin movimientos registrados.")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <caption className="sr-only">{i18nT("Cambios registrados sobre este pool")}</caption>
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    {[i18nT("Cuándo"), i18nT("Qué"), i18nT("Detalle")].map((h) => (
                      <th key={h} scope="col"
                        className="px-3 py-2 font-display text-label uppercase tracking-wider text-white/40">{i18nTd(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.audit.map((a, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="px-3 py-2 text-[12px] text-white/45">{fmtDate(a.at as string)}</td>
                      <td className="px-3 py-2 font-mono text-[12px] text-drl-cyan">{String(a.action)}</td>
                      <td className="px-3 py-2 text-[12px] text-white/55">
                        <DetalleDiario detail={a.detail as Record<string, unknown>} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Plate>
      </section>

      <Rail label={i18nT("Pool {poolId} · revisión {revision} · distribución v{distributionVersion}", { poolId: i18nTd(poolId), revision: sheet.revision, distributionVersion: sheet.distributionVersion })} />

      {/* ── Confirmaciones ── */}
      <ConfirmDialog
        open={accion === "activar"}
        title={estado === "RETIRED" ? i18nT("Reactivar el pool") : i18nT("Publicar el pool")}
        confirmLabel={i18nT("Publicar")} running={running}
        onCancel={() => setAccion(null)}
        onConfirm={(motivo) => void ejecutar(
          () => adminPoolApi("publish", { poolId, state: "ACTIVE", reason: motivo, expectedRevision: sheet.revision }),
          i18nT("Pool activo. La distribución se ha invalidado sin reiniciar el servidor."),
        )}
        body={
          <div className="space-y-2 text-sm text-white/70">
            <p>
              {fill(i18nT("Pasará a {estado}. Sus {n} cartas elegibles podrán salir en los {sobres} sobre(s) vinculado(s).", { ...slots("estado", "n"), sobres: sheet.packs.length }), { estado: <strong>{i18nT("ACTIVE")}</strong>, n: <strong className="text-white">{num(r.elegibles)}</strong> })}
            </p>
            {r.draft > 0 && (
              <p className="text-drl-gold">
                {i18nT("Hay {n} entrada(s) con cartas en DRAFT: la activación se rechazará hasta que se publiquen o se quiten.", { n: r.draft })}
              </p>
            )}
          </div>
        }
      />
      <ConfirmDialog
        open={accion === "retirar"}
        title={i18nT("Retirar el pool")} confirmLabel={i18nT("Retirar")} tone="danger" running={running}
        onCancel={() => setAccion(null)}
        onConfirm={(motivo) => void ejecutar(
          () => adminPoolApi("publish", { poolId, state: "RETIRED", reason: motivo, expectedRevision: sheet.revision }),
          i18nT("Pool retirado. Deja de repartir; no se ha borrado nada."),
        )}
        body={
          <>
            {fill(i18nT("Dejará de aportar cartas a los sobres. {nada}: sus entradas siguen, y los ejemplares que ya salieron de él siguen en manos de sus dueños, en sus mazos y en el mercado.", slots("nada")), { nada: <strong>{i18nT("No se destruye nada")}</strong> })}
          </>
        }
      />
      <ConfirmDialog
        open={accion === "borrador"}
        title={i18nT("Volver a borrador")} confirmLabel={i18nT("A borrador")} running={running}
        onCancel={() => setAccion(null)}
        onConfirm={(motivo) => void ejecutar(
          () => adminPoolApi("publish", { poolId, state: "DRAFT", reason: motivo, expectedRevision: sheet.revision }),
          i18nT("Pool en borrador. Deja de repartir mientras se trabaja en él."),
        )}
        body={<>{i18nT("Deja de repartir mientras se edita. Los sobres vinculados se quedan sin este pool hasta que vuelva a publicarse.")}</>}
      />
      <ConfirmDialog
        open={accion === "quitar" && !!aQuitar}
        title={i18nT("Quitar {v} del pool", { v: aQuitar?.cardId ?? "" })}
        confirmLabel={i18nT("Quitar")} tone="danger" running={running}
        onCancel={() => { setAccion(null); setAQuitar(null); }}
        onConfirm={(motivo) => void ejecutar(
          () => adminPoolApi("entryRemove", {
            poolId, cardId: aQuitar!.cardId, reason: motivo, expectedRevision: sheet.revision,
          }),
          i18nT("{cardId} fuera del pool.", { cardId: aQuitar!.cardId }),
        )}
        body={
          <>
            {fill(i18nT("Deja de poder salir por este pool. Los ejemplares ya repartidos {intactos}: siguen existiendo con su serie y su versión.", slots("intactos")), { intactos: <strong>{i18nT("no se tocan")}</strong> })}
          </>
        }
      />
    </Stage>
  );
}

// ───────────────────────────── Vincular a un sobre ─────────────────────────────

/**
 * Elegir el sobre en el que este pool reparte.
 *
 * Solo se ofrecen los sobres que todavía NO lo usan: vincular dos veces el mismo no significa
 * nada y ofrecerlo sería invitar a un error que la RPC tendría que rechazar después.
 */
function BindPack({
  poolId, vinculados, running, onBind,
}: {
  poolId: string; vinculados: string[]; running: boolean;
  onBind: (packId: string, nombre: string) => void;
}) {
  useLocale();
  const libres = useMemo(
    () => PACKS.filter((p) => !vinculados.includes(p.id)),
    [vinculados],
  );
  const [sel, setSel] = useState("");
  useEffect(() => { if (!sel && libres[0]) setSel(libres[0].id); }, [libres, sel]);

  if (libres.length === 0) {
    return (
      <Recessed className="p-3">
        <p className="text-[12px] text-white/50">
          {i18nT("Este pool ya está vinculado a todos los sobres del catálogo.")}
        </p>
      </Recessed>
    );
  }

  const nombre = libres.find((p) => p.id === sel)?.name ?? sel;
  return (
    <Recessed className="space-y-2 p-3">
      <p className="font-display text-label uppercase tracking-wider text-white/50">
        {i18nT("Vincular a un sobre")}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Select
            label={i18nT("Sobre")} value={sel} onChange={setSel} noEmpty
            options={libres.map((p) => ({ value: p.id, label: `${p.name} · ${p.id}` }))}
          />
        </div>
        <NxButton
          variant="secondary" disabled={running || !sel}
          onClick={() => onBind(sel, nombre)}
        >
          {i18nT("Vincular")}
        </NxButton>
      </div>
      <p className="text-[12px] leading-relaxed text-white/45">
        {fill(i18nT("El sobre empezará a repartir estas cartas en cuanto el pool esté {activo}. Si el sobre ya usa otro pool, los dos se {unen}.", slots("activo", "unen")), { activo: <strong>{i18nT("activo")}</strong>, unen: <strong>{i18nT("unen")}</strong> })}
      </p>
      <span className="sr-only">{i18nT("Pool")} {poolId}</span>
    </Recessed>
  );
}

// ───────────────────────────── Tabla de entradas ─────────────────────────────

function EntriesTable({
  entries, editable, running, onWeight, onQuitar,
}: {
  entries: EntryRow[]; editable: boolean; running: boolean;
  onWeight: (e: EntryRow, weight: number) => void;
  onQuitar: (e: EntryRow) => void;
}) {
  useLocale();
  if (entries.length === 0) {
    return <p className="py-6 text-sm text-white/40">{i18nT("Ninguna carta con ese filtro.")}</p>;
  }
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <caption className="sr-only">{i18nT("Cartas del pool con su peso y su cuota")}</caption>
          <thead>
            <tr className="border-b border-white/10 text-left">
              {[i18nT("Carta"), i18nT("Variante"), i18nT("Rareza"), "OVR", i18nT("Estado"), i18nT("Modo"), i18nT("Peso"), i18nT("Cuota"), ""].map((h, i) => (
                <th key={h || i} scope="col"
                  className="px-3 py-2 font-display text-label uppercase tracking-wider text-white/40">{i18nTd(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.cardId} className="border-b border-white/5">
                <td className="px-3">
                  <Link href={`/admin/cartas/${encodeURIComponent(e.cardId)}`}
                    className="flex min-h-[44px] flex-col justify-center text-drl-cyan underline-offset-2 hover:underline focus-visible:underline">
                    <span className="text-sm">{e.nick}</span>
                    <span className="font-mono text-[11px] text-white/40">{e.cardId}</span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-white/70">{i18nTd(e.variantLabel)}</td>
                <td className="px-3 py-2"><BucketBadge bucket={e.rarityBucket} rank={e.rarityRank} /></td>
                <td className="px-3 py-2 font-display font-bold tabular-nums text-white">{e.ovr}</td>
                <td className="px-3 py-2">
                  <LifecycleBadge state={e.cardLifecycle} />
                  {!e.elegible && <Badge tone="warn" className="ml-1">{i18nT("no reparte")}</Badge>}
                </td>
                <td className="px-3 py-2 text-white/60">{i18nTd(e.mode)}</td>
                <td className="px-3 py-2">
                  <WeightInput entry={e} editable={editable} running={running} onWeight={onWeight} />
                </td>
                <td className="px-3 py-2 tabular-nums text-white/70">
                  {e.mode === "INCLUDE" ? fmtCuota(e.cuota) : "—"}
                </td>
                <td className="px-3 py-2">
                  {editable && (
                    <NxButton variant="tertiary" onClick={() => onQuitar(e)}
                      aria-label={i18nT("Quitar {cardId} del pool", { cardId: e.cardId })}>{i18nT("Quitar")}</NxButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 md:hidden">
        {entries.map((e) => (
          <div key={e.cardId} className="border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/admin/cartas/${encodeURIComponent(e.cardId)}`}
                className="flex min-h-[44px] min-w-0 flex-col justify-center">
                <span className="truncate text-sm text-white">{e.nick} · {i18nTd(e.variantLabel)}</span>
                <span className="truncate font-mono text-[11px] text-drl-cyan">{e.cardId}</span>
              </Link>
              <BucketBadge bucket={e.rarityBucket} rank={e.rarityRank} />
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <WeightInput entry={e} editable={editable} running={running} onWeight={onWeight} />
              <p className="text-[12px] text-white/50">
                {i18nT("cuota")} <span className="tabular-nums text-white/80">{e.mode === "INCLUDE" ? fmtCuota(e.cuota) : "—"}</span>
              </p>
              <LifecycleBadge state={e.cardLifecycle} />
              {editable && (
                <NxButton variant="tertiary" onClick={() => onQuitar(e)}
                  aria-label={i18nT("Quitar {cardId} del pool", { cardId: e.cardId })}>{i18nT("Quitar")}</NxButton>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Peso editable. Se guarda al salir del campo o con Enter, no en cada tecla. */
function WeightInput({
  entry, editable, running, onWeight,
}: {
  entry: EntryRow; editable: boolean; running: boolean;
  onWeight: (e: EntryRow, weight: number) => void;
}) {
  useLocale();
  const [v, setV] = useState(String(entry.weight));
  useEffect(() => { setV(String(entry.weight)); }, [entry.weight]);

  const guardar = (): void => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n === entry.weight) { setV(String(entry.weight)); return; }
    onWeight(entry, n);
  };

  return (
    <label className="block">
      <span className="sr-only">{i18nT("Peso de {carta}", { carta: entry.cardId })}</span>
      <input
        type="number" inputMode="decimal" min={0.0001} step="any"
        value={v} disabled={!editable || running}
        onChange={(e) => setV(e.target.value)}
        onBlur={guardar}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); guardar(); } }}
        aria-label={i18nT("Peso de {cardId}", { cardId: entry.cardId })}
        className="min-h-[44px] w-[92px] border border-white/15 bg-base-800 px-2 text-sm tabular-nums text-white outline-none focus-visible:border-drl disabled:opacity-40"
      />
    </label>
  );
}

// ───────────────────────────── Añadir carta ─────────────────────────────

interface CandidataCarta {
  cardId: string; nick: string; variantId: string; variantLabel: string;
  rarityBucket: string; rarityRank: number; ovr: number; lifecycle: string;
}

function AddCard({
  poolId, revision, pesoTotal, onHecho, onConflicto,
}: {
  poolId: string; revision: number; pesoTotal: number;
  onHecho: (msg: string) => void; onConflicto: (m: string) => void;
}) {
  useLocale();
  const { running, error, clear, run } = useAsync<unknown>();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CandidataCarta[]>([]);
  const [sel, setSel] = useState<CandidataCarta | null>(null);
  const [preview, setPreview] = useState<{ player: Player; ovr: number; combat: CombatStats } | null>(null);
  const [weight, setWeight] = useState("1");
  const [mode, setMode] = useState("INCLUDE");
  const [motivo, setMotivo] = useState("");

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setRows([]); return; }
    timer.current = setTimeout(() => {
      void run(async () => {
        const r = await adminApi<{ rows: CandidataCarta[] }>("list", { q, pageSize: 12, lifecycle: "PUBLISHED" });
        setRows(r.rows);
        return r;
      });
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, run]);

  /*
   * La preview necesita el jugador entero Y el trío guardado, y las dos cosas las sirve la
   * ficha de la carta. No se derivan aquí: la carta que se va a añadir al pool es la que
   * existe, con su OVR y su trío, no una recomposición.
   */
  const elegir = async (c: CandidataCarta): Promise<void> => {
    setSel(c); setPreview(null);
    const r = await run(async () =>
      adminApi<{ player: Player; definition: Record<string, unknown> }>("sheet", { cardId: c.cardId }));
    if (r) {
      const d = r as { player: Player; definition: Record<string, unknown> };
      if (d.player) {
        setPreview({
          player: d.player,
          ovr: Number(d.definition.ovr),
          combat: d.definition.combat as CombatStats,
        });
      }
    }
  };

  const puede = !!sel && Number(weight) > 0 && motivo.trim().length > 0 && !running;

  const anadir = async (): Promise<void> => {
    const r = await run(async () => {
      try {
        return await adminPoolApi("entryUpsert", {
          poolId, cardId: sel!.cardId, weight: Number(weight), mode,
          reason: motivo.trim(), expectedRevision: revision,
        });
      } catch (e) {
        const err = e as Error & { conflict?: boolean; current?: number };
        if (err.conflict) onConflicto(`${err.message}${err.current ? i18nT(" La revisión vigente es r{current}.", { current: err.current }) : ""}`);
        throw err;
      }
    });
    if (r === null) return;
    onHecho(i18nT("{cardId} añadida con peso {weight}.", { cardId: sel!.cardId, weight: i18nTd(weight) }));
    setSel(null); setPreview(null); setQ(""); setRows([]); setWeight("1"); setMotivo("");
  };

  // Qué cuota tendría la carta si se añade con ese peso. Es la pregunta que uno se hace.
  const cuotaPrevista = useMemo(() => {
    const w = Number(weight);
    if (!Number.isFinite(w) || w <= 0 || mode !== "INCLUDE") return null;
    return w / (pesoTotal + w);
  }, [weight, pesoTotal, mode]);

  return (
    <section aria-labelledby="h-anadir">
      <h2 id="h-anadir" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
        {i18nT("Añadir una carta")}
      </h2>
      <Plate className="space-y-4 p-4">
        <ErrorBar error={i18nTd(error)} onClose={clear} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <label className="block" htmlFor="buscar-carta">
              <span className="font-display text-label uppercase tracking-wider text-white/50">
                {i18nT("Buscar carta publicada")}
              </span>
              <input
                id="buscar-carta" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={i18nT("jugador o card id…")} aria-label={i18nT("Buscar carta para añadir al pool")}
                className="mt-1 min-h-[44px] w-full border border-white/15 bg-base-800 px-3 text-sm text-white outline-none focus-visible:border-drl"
              />
            </label>

            <div className="max-h-64 space-y-1 overflow-y-auto" role="listbox" aria-label={i18nT("Cartas encontradas")}>
              {rows.map((c) => (
                <button
                  key={c.cardId} type="button" role="option" aria-selected={sel?.cardId === c.cardId}
                  onClick={() => void elegir(c)}
                  className={`flex min-h-[44px] w-full items-center justify-between gap-2 border px-3 py-2 text-left transition
                    ${sel?.cardId === c.cardId ? "border-drl bg-drl/10" : "border-white/10 hover:bg-white/5"}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-white/90">{c.nick} · {i18nTd(c.variantLabel)}</span>
                    <span className="block truncate font-mono text-[11px] text-white/40">{c.cardId}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <BucketBadge bucket={c.rarityBucket} rank={c.rarityRank} />
                    <span className="font-display text-sm font-bold tabular-nums text-white">{c.ovr}</span>
                  </span>
                </button>
              ))}
              {q.trim() && rows.length === 0 && !running && (
                <p className="px-1 py-3 text-sm text-white/40">{i18nT("Ninguna carta publicada con ese texto.")}</p>
              )}
            </div>

            {sel && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block" htmlFor="peso-nuevo">
                  <span className="font-display text-label uppercase tracking-wider text-white/50">{i18nT("Peso")}</span>
                  <input
                    id="peso-nuevo" type="number" inputMode="decimal" min={0.0001} step="any"
                    value={weight} onChange={(e) => setWeight(e.target.value)}
                    aria-describedby="peso-nuevo-h"
                    className="mt-1 min-h-[44px] w-full border border-white/15 bg-base-800 px-3 text-sm tabular-nums text-white outline-none focus-visible:border-drl"
                  />
                  <span id="peso-nuevo-h" className="mt-1 block text-[11px] text-white/35">
                    {i18nT("Relativo al resto.")} {cuotaPrevista !== null
                      ? i18nT("Quedaría en {cuotaPrevista} del pool.", { cuotaPrevista: fmtCuota(cuotaPrevista) })
                      : i18nT("Las entradas EXCLUDE no llevan cuota.")}
                  </span>
                </label>
                <Select label={i18nT("Modo")} value={mode} onChange={setMode} noEmpty
                  options={[
                    { value: "INCLUDE", label: i18nT("INCLUDE — puede salir") },
                    { value: "EXCLUDE", label: i18nT("EXCLUDE — nunca sale") },
                  ]} />
                <label className="block sm:col-span-2" htmlFor="motivo-anadir">
                  <span className="font-display text-label uppercase tracking-wider text-white/50">
                    {i18nT("Motivo (queda registrado)")}
                  </span>
                  <textarea
                    id="motivo-anadir" rows={2} value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder={i18nT("Por qué entra esta carta en el pool")}
                    className="mt-1 w-full resize-y border border-white/15 bg-base-800 px-3 py-2 text-sm text-white outline-none focus-visible:border-drl"
                  />
                </label>
                <div className="sm:col-span-2">
                  <NxButton variant="primary" disabled={!puede} onClick={() => void anadir()}>
                    {running ? i18nT("Añadiendo…") : i18nT("Añadir al pool")}
                  </NxButton>
                </div>
              </div>
            )}
          </div>

          {/* La carta de verdad, con el mismo motor del juego. */}
          <div className="min-w-0">
            {sel && preview ? (
              <PreviewCarta player={preview.player} variantId={sel.variantId}
                ovr={preview.ovr} combat={preview.combat} />
            ) : (
              <Recessed className="grid min-h-[220px] place-items-center p-4">
                <p className="text-sm text-white/35">
                  {sel ? i18nT("Cargando la carta…") : i18nT("Elige una carta para verla.")}
                </p>
              </Recessed>
            )}
          </div>
        </div>
      </Plate>
    </section>
  );
}

/**
 * La preview reutiliza `CardPreview` (Card3D + CardRenderer), el mismo par que 8.4.2.
 *
 * OVR y trío llegan de la ficha de la carta, es decir, de lo que hay guardado. Aquí no se
 * recompone una carta ni se dibuja un segundo renderizador: se está eligiendo una carta que
 * ya existe, y lo que hay que ver es esa.
 */
function PreviewCarta({
  player, variantId, ovr, combat,
}: { player: Player; variantId: string; ovr: number; combat: CombatStats }) {
  useLocale();
  const variant = useMemo(() => {
    try { return getVariant(variantId as VariantId); } catch { return null; }
  }, [variantId]);
  if (!variant) return null;
  return (
    <CardPreview
      player={player} variant={variant}
      stats={player.stats} ovr={ovr} combat={combat}
      size="md"
      nota={i18nT("Es la definición vigente de la carta.")}
    />
  );
}

// ───────────────────────────── Probabilidad y simulación ─────────────────────────────

function Probabilidad({ packs, entries }: { packs: string[]; entries: EntryRow[] }) {
  useLocale();
  const { running, error, clear, run } = useAsync<unknown>();
  const [packId, setPackId] = useState(packs[0] ?? "");
  const [cardId, setCardId] = useState(entries[0]?.cardId ?? "");
  const [odds, setOdds] = useState<Odds | null>(null);
  const [sim, setSim] = useState<Sim | null>(null);
  const [aperturas, setAperturas] = useState("2000");

  useEffect(() => { if (!packId && packs[0]) setPackId(packs[0]); }, [packs, packId]);
  useEffect(() => { if (!cardId && entries[0]) setCardId(entries[0].cardId); }, [entries, cardId]);

  const calcular = async (): Promise<void> => {
    const r = await run(async () => adminPoolApi<Odds>("cardOdds", { cardId, packId }));
    if (r) setOdds(r as Odds);
  };
  const simular = async (): Promise<void> => {
    const r = await run(async () => adminPoolApi<Sim>("simulate", {
      packId, aperturas: Number(aperturas) || 1000, seed: `admin:${packId}`,
    }));
    if (r) setSim(r as Sim);
  };

  if (packs.length === 0) {
    return (
      <section aria-labelledby="h-prob">
        <h2 id="h-prob" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
          {i18nT("Probabilidad")}
        </h2>
        <Plate className="p-4">
          <p className="text-sm text-white/50">
            {i18nT("Este pool no está vinculado a ningún sobre, así que no hay probabilidad que calcular: no puede salir nada de él.")}
          </p>
        </Plate>
      </section>
    );
  }

  return (
    <section aria-labelledby="h-prob">
      <h2 id="h-prob" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
        {i18nT("Probabilidad y simulación")}
      </h2>
      <Plate className="space-y-4 p-4">
        <ErrorBar error={i18nTd(error)} onClose={clear} />

        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={i18nT("Sobre")} value={packId} onChange={setPackId} noEmpty
            options={packs.map((p) => ({ value: p, label: p }))} />
          <Select label={i18nT("Carta")} value={cardId} onChange={setCardId} noEmpty
            options={entries.map((e) => ({ value: e.cardId, label: `${e.nick} · ${e.variantLabel}` }))} />
          <div className="flex items-end">
            <NxButton variant="secondary" disabled={running || !packId || !cardId}
              onClick={() => void calcular()}>{i18nT("Calcular probabilidad")}</NxButton>
          </div>
        </div>

        {odds && (
          <Recessed className="space-y-3 p-4">
            <p className="font-mono text-[12px] text-drl-cyan">{odds.cardId} · {i18nTd(odds.packName)}</p>
            {!odds.enPool ? (
              <p className="text-sm text-drl-gold">
                {fill(i18nT("No puede salir de este sobre: {motivo}. Probabilidad {cero}.", { motivo: i18nTd(odds.motivo) ?? "", ...slots("cero") }), { cero: <strong>0</strong> })}
              </p>
            ) : (
              <>
                {/* La descomposición, para que el número no sea un oráculo. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[13px]">
                  <Trozo t="P(bucket)" v={fmtCuota(odds.pBucket)}
                    pie={i18nT("{bucket} · renormalizado sobre los buckets con stock", { bucket: i18nTd(odds.bucket) })} />
                  <span className="text-white/30">×</span>
                  <Trozo t={i18nT("P(carta | bucket)")} v={fmtCuota(odds.pEnBucket)}
                    pie={i18nT("peso {weight} de {pesoBucket} · {cartasEnBucket} cartas", { weight: num(odds.weight), pesoBucket: num(odds.pesoBucket), cartasEnBucket: odds.cartasEnBucket })} />
                  <span className="text-white/30">=</span>
                  <Trozo t={i18nT("P en un hueco")} v={fmtCuota(odds.pPorHueco)} destacado />
                </div>

                <FieldGrid cols={3}>
                  <Field label={i18nT("Cartas por sobre")}>{odds.huecos}</Field>
                  <Field label={i18nT("Al menos una en el sobre")}>{fmtCuota(odds.pAlMenosUna)}</Field>
                  <Field label={i18nT("Peso en el pool")}>{num(odds.weight)}</Field>
                </FieldGrid>

                {/*
                  Las tres advertencias sin las que el número mentiría. Van aquí y no en un
                  informe: quien lee el porcentaje es quien las necesita.
                */}
                <p className="text-[11px] leading-relaxed text-white/45">
                  {fill(i18nT("«P en un hueco» vale para un hueco {condicion}: los huecos garantizados sortean con otro mínimo de rareza y el pity fuerza el bucket, así que su probabilidad es distinta. «Al menos una» supone huecos independientes — el anti-duplicado y las garantías los correlacionan, así que es una aproximación, no una promesa.", slots("condicion")), { condicion: <strong>{i18nT("sin garantía ni pity en juego")}</strong> })}
                </p>

                {odds.composicion.length > 1 && (
                  <div>
                    <p className="mb-1 font-display text-label uppercase tracking-wider text-white/40">
                      {i18nT("Composición: {n} pools en este sobre", { n: odds.composicion.length })}
                    </p>
                    <ul className="space-y-1 text-[12px] text-white/60">
                      {odds.composicion.map((c) => (
                        <li key={c.poolId}>
                          <code className="text-drl-cyan">{c.poolId}</code> {i18nT("· prioridad")} {c.priority} ·{" "}
                          {c.weight === null ? i18nT("no la contiene")
                            : c.manda ? <strong className="text-white">{i18nT("peso {weight} (manda)", { weight: num(c.weight) })}</strong>
                            : i18nT("peso {weight} (no manda)", { weight: num(c.weight) })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </Recessed>
        )}

        {/* ── Simulación ── */}
        <div className="flex flex-wrap items-end gap-3 border-t border-white/10 pt-4">
          <label className="block" htmlFor="aperturas">
            <span className="font-display text-label uppercase tracking-wider text-white/50">{i18nT("Aperturas")}</span>
            <input
              id="aperturas" type="number" min={1} max={20000} step={500}
              value={aperturas} onChange={(e) => setAperturas(e.target.value)}
              aria-describedby="aperturas-h"
              className="mt-1 min-h-[44px] w-[120px] border border-white/15 bg-base-800 px-3 text-sm tabular-nums text-white outline-none focus-visible:border-drl"
            />
          </label>
          <NxButton variant="secondary" disabled={running || !packId} onClick={() => void simular()}>
            {running ? i18nT("Simulando…") : i18nT("Simular")}
          </NxButton>
          <p id="aperturas-h" className="max-w-md text-[11px] text-white/40">
            {fill(i18nT("La simulación le pregunta al motor qué decidiría. {nada}: no crea ejemplares, ni movimientos de mercado, ni entradas de economía. Máximo 20.000.", slots("nada")), { nada: <strong>{i18nT("No acuña nada")}</strong> })}
          </p>
        </div>

        {sim && (
          <Recessed className="space-y-3 p-4">
            <p className="text-[12px] text-white/50">
              {i18nT("{aperturas} aperturas · {cartas} cartas · {ms} ms · distribución v{version}", { aperturas: num(sim.aperturas), cartas: num(sim.cartas), ms: sim.ms, version: sim.distributionVersion })}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <caption className="sr-only">{i18nT("Reparto por rareza: esperado frente a observado")}</caption>
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    {[i18nT("Rareza"), i18nT("Esperado"), i18nT("Observado"), "n"].map((h) => (
                      <th key={h} scope="col"
                        className="px-3 py-2 font-display text-label uppercase tracking-wider text-white/40">{i18nTd(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sim.buckets.map((b) => (
                    <tr key={b.bucket} className="border-b border-white/5">
                      <td className="px-3 py-2"><BucketBadge bucket={b.bucket} /></td>
                      <td className="px-3 py-2 tabular-nums text-white/60">{fmtCuota(b.esperado)}</td>
                      <td className="px-3 py-2 tabular-nums text-white">{fmtCuota(b.observado)}</td>
                      <td className="px-3 py-2 tabular-nums text-white/45">{num(b.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary className="min-h-[44px] cursor-pointer py-2 text-sm text-drl-cyan">
                {i18nT("Las {n} cartas más repartidas", { n: sim.top.length })}
              </summary>
              <div className="overflow-x-auto">
                <table className="mt-2 w-full min-w-[560px] border-collapse text-sm">
                  <caption className="sr-only">{i18nT("Cartas más repartidas en la simulación")}</caption>
                  <thead>
                    <tr className="border-b border-white/10 text-left">
                      {[i18nT("Carta"), i18nT("Peso"), i18nT("Esperado"), i18nT("Observado"), "n"].map((h) => (
                        <th key={h} scope="col"
                          className="px-3 py-2 font-display text-label uppercase tracking-wider text-white/40">{i18nTd(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sim.top.map((t) => (
                      <tr key={t.cardId} className="border-b border-white/5">
                        <td className="px-3 py-2">
                          <span className="text-white/80">{t.nick} · {i18nTd(t.variantLabel)}</span>
                          <span className="block font-mono text-[11px] text-white/35">{t.cardId}</span>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-white/60">{num(t.weight)}</td>
                        <td className="px-3 py-2 tabular-nums text-white/60">{fmtCuota(t.esperado)}</td>
                        <td className="px-3 py-2 tabular-nums text-white">{fmtCuota(t.observado)}</td>
                        <td className="px-3 py-2 tabular-nums text-white/45">{num(t.n)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Recessed>
        )}
      </Plate>
    </section>
  );
}

function Trozo({ t, v, pie, destacado }: { t: string; v: string; pie?: string; destacado?: boolean }) {
  return (
    <span className="inline-block">
      <span className="block font-display text-label uppercase tracking-wider text-white/40">{i18nTd(t)}</span>
      <span className={`block tabular-nums ${destacado ? "text-drl-cyan" : "text-white"}`}>{i18nTd(v)}</span>
      {pie && <span className="block font-sans text-[10px] text-white/35">{i18nTd(pie)}</span>}
    </span>
  );
}

function DetalleDiario({ detail }: { detail: Record<string, unknown> }) {
  useLocale();
  if (!detail) return <>—</>;
  const partes: string[] = [];
  if (detail.reason) partes.push(String(detail.reason));
  if (Array.isArray(detail.weight)) partes.push(`peso ${String(detail.weight[0] ?? "—")} → ${String(detail.weight[1])}`);
  if (Array.isArray(detail.altas) && detail.altas.length) partes.push(i18nT("+{length} cartas", { length: detail.altas.length }));
  if (Array.isArray(detail.bajas) && detail.bajas.length) partes.push(i18nT("−{length} cartas", { length: detail.bajas.length }));
  if (detail.from && detail.to) partes.push(`${String(detail.from)} → ${String(detail.to)}`);
  if (detail.packId) partes.push(`sobre ${String(detail.packId)}`);
  return <>{partes.join(" · ") || "—"}</>;
}
