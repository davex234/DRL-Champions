"use client";

/**
 * /admin/cartas/[id] — LA FICHA (Bloque 8.4.1).
 *
 * Todo lo que hay que saber de una carta antes de tocarla, y las acciones para tocarla.
 *
 * ────────────────────────── LA PREVIEW ES LA DEL JUEGO ──────────────────────────
 *
 * Se renderiza con `CardRenderer`, el MISMO motor por capas que pinta la carta en la
 * colección, en la tienda y en el duelo. No hay una segunda implementación visual, y por eso
 * lo que el administrador ve antes de publicar es literalmente lo que verá el jugador.
 *
 * Se le pasan los datos que devuelve el servidor —no los del catálogo en memoria del
 * navegador—, porque una carta en DRAFT todavía no está en ese catálogo. Y **sin serial**:
 * una definición sin ejemplares no tiene número de serie, e inventarlo para la preview sería
 * enseñar un dato que no existe.
 *
 * ────────────────────────── LAS ACCIONES RESPETAN 8.2 ──────────────────────────
 *
 *   DRAFT      se edita EN SITIO (`updateDraft`). No hay a quién proteger.
 *   PUBLISHED  NO se edita: se publica una VERSIÓN nueva. La anterior queda intacta, que es
 *              la que tienen los ejemplares ya acuñados.
 *   RETIRED    igual que PUBLISHED.
 *
 * La interfaz no decide esto: pregunta al servidor y enseña las acciones que el estado
 * admite. Si alguien forzara otra, la RPC la rechazaría igual.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Stage, Plate, Recessed, Rail, Piece } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Readout } from "@/components/ui/Readout";
import { Badge } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { Loading, ErrorState } from "@/components/ui/States";
import { CardRenderer } from "@/components/cards/CardRenderer";
import { CardArtifacts } from "@/components/admin/cards/CardArtifacts";
import { getVariant } from "@/domain/cards/variants";
import {
  adminApi, useAsync, ErrorBar, ConfirmDialog, LifecycleBadge, BucketBadge,
  Field, FieldGrid, fmtDate, fmtPct, SheetHeading,
} from "@/components/admin/cards/shared";
import type { Player, PlayerStats, VariantId } from "@/domain/cards/types";
import type { CombatStats } from "@/domain/cards/combat";

interface Sheet {
  definition: Record<string, unknown>;
  player: Player | null;
  variant: { id: string; label: string; group: string; rank: number; bucket: string; serialized: boolean; serialLimit?: number; animation: string };
  versions: { version: number; ovr: number; combat: CombatStats; rarity_rank: number; effective_from: string; effective_to: string | null; created_by: string | null; reason: string | null; checksum: string }[];
  instances: { total: number; owners: number; byVersion: Record<string, number>; withSerial: number };
  economy: { marketValue: number; salvageValue: number; instanceValueFirst: number | null; anchorByVersion: { version: number; fairValue: number }[] };
  distribution: { poolId: string; poolName: string; lifecycle: string; weight: number; mode: string; packs: string[]; pEnBucket: number | null }[];
  audit: { at: string; actor: string | null; action: string; detail: Record<string, unknown> }[];
  concurrency: { definitionVersion: number; updatedAt: string | null };
}

type Accion = null | "retire" | "republish" | "draftPublish";

export default function FichaCartaPage() {
  const params = useParams<{ id: string }>();
  const cardId = decodeURIComponent(String(params?.id ?? ""));

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const { running, error, clear, run } = useAsync<unknown>();
  const [accion, setAccion] = useState<Accion>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Edición de borrador: los valores que el administrador puede tocar.

  const cargar = useCallback(async () => {
    const r = await run(async () => adminApi<Sheet>("sheet", { cardId }));
    if (r) {
      const s = r as Sheet;
      setSheet(s);
    }
  }, [run, cardId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const def = sheet?.definition;
  const estado = def?.lifecycle as string | undefined;
  const esBorrador = estado === "DRAFT";
  const enJuego = estado === "PUBLISHED" || estado === "RETIRED";

  const cardParaPreview = useMemo(() => {
    if (!sheet?.player || !def) return null;
    let variant;
    try { variant = getVariant(def.variant_id as VariantId); } catch { return null; }
    return {
      player: sheet.player,
      variant,
      stats: def.stats as PlayerStats,
      ovr: Number(def.ovr),
    };
  }, [sheet, def]);

  /** Ejecuta una acción y recarga la ficha: el estado de la pantalla sale del servidor. */
  const ejecutar = useCallback(async (fn: () => Promise<unknown>, mensaje: string) => {
    const r = await run(fn);
    if (r !== null) { setAviso(mensaje); await cargar(); }
    setAccion(null);
  }, [run, cargar]);

  if (!sheet && running) return <Stage className="p-6"><Loading label="Cargando ficha…" /></Stage>;
  if (!sheet) {
    return (
      <Stage className="p-6 space-y-4">
        <ErrorBar error={error} onClose={clear} />
        <ErrorState message={`No se pudo cargar la carta ${cardId}`} onRetry={() => void cargar()} />
        <NxButton href="/admin/cartas" variant="secondary">Volver al listado</NxButton>
      </Stage>
    );
  }

  return (
    <Stage data-admin-panel="ficha" className="space-y-5 p-4 sm:p-6">
      {/* ── Cabecera ── */}
      <SheetHeading
        kicker={`Carta · ${sheet.variant.label}`}
        title={sheet.player?.nick ?? String(def!.player_id)}
        badges={
          <>
            <LifecycleBadge state={estado ?? "?"} />
            <BucketBadge bucket={sheet.variant.bucket} rank={sheet.variant.rank} />
            <Badge tone="muted">v{sheet.concurrency.definitionVersion}</Badge>
            <Badge tone="muted">{String(def!.origin)}</Badge>
          </>
        }
        meta={cardId}
        action={<NxButton href="/admin/cartas" variant="ghost">← Listado</NxButton>}
      />

      <ErrorBar error={error} onClose={clear} />
      {aviso && (
        <Plate tone="success" className="px-4 py-3">
          <p className="text-sm text-white/85" role="status">{aviso}</p>
        </Plate>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5 min-w-0">
          {/* ── IDENTIDAD ── */}
          <section aria-labelledby="h-identidad">
            <h2 id="h-identidad" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">Identidad</h2>
            <FieldGrid cols={3}>
              <Field label="Card ID" mono>{cardId}</Field>
              <Field label="Player ID" mono>{String(def!.player_id)}</Field>
              <Field label="Jugador">{sheet.player?.nick ?? "—"}</Field>
              <Field label="Equipo">{sheet.player?.team || "—"}</Field>
              <Field label="Rol">{sheet.player?.role ?? "—"}</Field>
              <Field label="Región / País">{sheet.player?.region ?? "—"} · {sheet.player?.country || "—"}</Field>
            </FieldGrid>
          </section>

          {/* ── CARTA ── */}
          <section aria-labelledby="h-carta">
            <h2 id="h-carta" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">Carta</h2>
            <FieldGrid cols={4}>
              <Field label="Variante">{sheet.variant.label}</Field>
              <Field label="Grupo">{sheet.variant.group}</Field>
              <Field label="Rareza">{sheet.variant.bucket} · rank {sheet.variant.rank}</Field>
              <Field label="Serializada">
                {sheet.variant.serialized ? `sí · /${sheet.variant.serialLimit ?? "?"}` : "no"}
              </Field>
            </FieldGrid>
            <Recessed className="mt-2 grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
              <Readout value={String(def!.ovr)} label="OVR" size="lg" />
              <StatMeter label="Stronghold" v={(def!.combat as CombatStats).stronghold} />
              <StatMeter label="Gamesense" v={(def!.combat as CombatStats).gamesense} />
              <StatMeter label="Entryfrag" v={(def!.combat as CombatStats).entryfrag} />
            </Recessed>
          </section>

          {/* ── EDICIÓN ── */}
          <section aria-labelledby="h-edicion">
            <h2 id="h-edicion" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
              Editar
            </h2>
            <Plate className="p-4">
              {/*
                La edición vive en `/editar` desde 8.4.2, y no por gusto de tener otra página.
                Aquí había cuatro casillas —OVR, SH, GS, EF— que enviaban los cuatro números tal
                cual. Ese formulario era la puerta por la que se colaba un OVR escrito a mano
                que no correspondía al trío, y de ahí al ancla del mercado.

                Ahora se escribe el trío BASE y el OVR se deriva. Eso necesita sitio: la carta
                al lado, lo derivado a la vista y el aviso de a cuántos ejemplares NO afecta.
                La ficha se queda con lo que es, un resumen que se lee.
              */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-xl text-sm text-white/60">
                  {esBorrador
                    ? "Es un borrador: se edita en sitio y no afecta a nadie."
                    : enJuego
                      ? "Está en juego. Cambiar lo que afecta al juego publica una VERSIÓN nueva; los ejemplares ya acuñados conservan la suya."
                      : "Este estado no admite edición."}
                </p>
                {(esBorrador || enJuego) && (
                  <NxButton
                    variant="secondary"
                    href={`/admin/cartas/${encodeURIComponent(cardId)}/editar`}
                  >
                    Abrir el editor
                  </NxButton>
                )}
              </div>
              <p className="mt-3 text-[12px] text-white/40">
                Se escribe el trío de combate. El OVR, las estadísticas heredadas, la rareza y la
                huella los deriva el servidor. La identidad —jugador y variante— no se cambia:
                sería otra carta, y los ejemplares existentes apuntarían a algo que nadie obtuvo.
              </p>
            </Plate>
          </section>

          {/* ── HISTORIAL ── */}
          <section aria-labelledby="h-historial">
            <h2 id="h-historial" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
              Historial de versiones ({sheet.versions.length})
            </h2>
            <Plate className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-sm">
                  <caption className="sr-only">Versiones de la definición, de la más antigua a la vigente</caption>
                  <thead>
                    <tr className="border-b border-white/10 text-left">
                      {["Ver.", "OVR", "Rank", "Vigencia", "Ejemplares", "Motivo", "Hash"].map((h) => (
                        <th key={h} scope="col" className="px-3 py-2 font-display text-label uppercase tracking-wider text-white/40">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.versions.map((v) => (
                      <tr key={v.version} className="border-b border-white/5">
                        <td className="px-3 py-2">
                          <Badge tone={v.effective_to === null ? "ok" : "muted"}>v{v.version}</Badge>
                        </td>
                        <td className="px-3 py-2 font-display font-bold text-white">{v.ovr}</td>
                        <td className="px-3 py-2 text-white/60">r{v.rarity_rank}</td>
                        <td className="px-3 py-2 text-[12px] text-white/45">
                          {fmtDate(v.effective_from)} → {v.effective_to ? fmtDate(v.effective_to) : "vigente"}
                        </td>
                        <td className="px-3 py-2 text-white/70">
                          {sheet.instances.byVersion[String(v.version)] ?? 0}
                        </td>
                        <td className="px-3 py-2 text-[12px] text-white/55">{v.reason ?? "—"}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-white/30">{v.checksum.slice(0, 10)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Plate>
            <p className="mt-2 text-[12px] text-white/35">
              Las versiones son inmutables: un trigger de base de datos rechaza reescribirlas
              incluso con la clave de servicio.
            </p>
          </section>

          {/*
            ARTEFACTOS. Va justo detrás del historial porque es su consecuencia: una versión
            es una fila, y lo descargable es esa fila. No se pide nada al servidor para
            pintarlo — las versiones ya están en la ficha.
          */}
          <CardArtifacts
            cardId={cardId}
            versions={sheet.versions}
            instancesByVersion={sheet.instances.byVersion}
          />

          {/* ── DISTRIBUCIÓN ── */}
          <section aria-labelledby="h-dist">
            <h2 id="h-dist" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
              Distribución ({sheet.distribution.length} pools)
            </h2>
            {sheet.distribution.length === 0 ? (
              <Recessed className="p-4 text-sm text-white/50">
                No está en ningún pool: hoy no puede salir en ningún sobre.
              </Recessed>
            ) : (
              <div className="space-y-2">
                {sheet.distribution.map((d) => (
                  <Recessed key={d.poolId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white/85">{d.poolName}</p>
                      <p className="truncate font-mono text-[11px] text-white/35">{d.poolId}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge tone={d.lifecycle === "ACTIVE" ? "ok" : "muted"}>{d.lifecycle}</Badge>
                      <Badge tone={d.mode === "EXCLUDE" ? "warn" : "muted"}>{d.mode}</Badge>
                      <Readout value={d.weight} label="peso" size="sm" />
                      <Readout value={fmtPct(d.pEnBucket)} label="P en bucket" size="sm" />
                      <span className="font-display text-label uppercase tracking-wider text-white/40">
                        {d.packs.join(", ") || "sin sobre"}
                      </span>
                    </div>
                  </Recessed>
                ))}
              </div>
            )}
            <p className="mt-2 text-[12px] text-white/35">
              La probabilidad la calcula el servidor con el mismo pool que usa el sorteo. La
              administración de pools llega en 8.4.3.
            </p>
          </section>

          {/* ── AUDITORÍA ── */}
          {sheet.audit.length > 0 && (
            <section aria-labelledby="h-audit">
              <h2 id="h-audit" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
                Registro ({sheet.audit.length})
              </h2>
              <Recessed className="max-h-64 space-y-1 overflow-y-auto p-3">
                {sheet.audit.map((a, i) => (
                  <div key={i} className="flex flex-wrap items-baseline gap-2 text-[12px]">
                    <span className="text-white/35">{fmtDate(a.at)}</span>
                    <Badge tone="info">{a.action}</Badge>
                    <span className="text-white/55">{String((a.detail as { reason?: string })?.reason ?? "")}</span>
                    <span className="ml-auto font-mono text-[10px] text-white/25">
                      {a.actor ? `${a.actor.slice(0, 8)}…` : "sistema"}
                    </span>
                  </div>
                ))}
              </Recessed>
            </section>
          )}
        </div>

        {/* ── COLUMNA DERECHA ── */}
        <div className="space-y-5">
          {/* PREVIEW */}
          <section aria-labelledby="h-preview">
            <h2 id="h-preview" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">Preview</h2>
            <Piece className="grid place-items-center p-4">
              {cardParaPreview ? (
                <CardRenderer
                  player={cardParaPreview.player}
                  variant={cardParaPreview.variant}
                  stats={cardParaPreview.stats}
                  ovr={cardParaPreview.ovr}
                  size="lg"
                  interactive={false}
                />
              ) : (
                <p className="p-6 text-sm text-white/40">Sin datos suficientes para la preview.</p>
              )}
            </Piece>
            <p className="mt-2 text-[12px] text-white/35">
              El mismo componente que pinta la carta en el juego. Sin número de serie: una
              definición sin ejemplares no tiene ninguno.
            </p>
          </section>

          {/* ACCIONES */}
          <section aria-labelledby="h-acciones">
            <h2 id="h-acciones" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">Acciones</h2>
            <Plate className="space-y-2 p-4">
              {esBorrador && (
                <NxButton variant="primary" className="w-full" disabled={running}
                  onClick={() => setAccion("draftPublish")}>Publicar carta</NxButton>
              )}
              {estado === "PUBLISHED" && (
                <NxButton variant="danger" className="w-full" disabled={running}
                  onClick={() => setAccion("retire")}>Retirar de circulación</NxButton>
              )}
              {estado === "RETIRED" && (
                <NxButton variant="primary" className="w-full" disabled={running}
                  onClick={() => setAccion("republish")}>Volver a publicar</NxButton>
              )}
              <p className="text-[12px] text-white/40">
                Retirar no destruye nada: las colecciones, los mazos, el mercado y las partidas
                siguen funcionando. Lo único que pierde es la posibilidad de salir en sobres nuevos.
              </p>
            </Plate>
          </section>

          {/* ECONOMÍA */}
          <section aria-labelledby="h-eco">
            <h2 id="h-eco" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">Economía</h2>
            <FieldGrid cols={2}>
              <Field label="Valor de mercado">{sheet.economy.marketValue.toLocaleString("es-ES")}</Field>
              <Field label="Desguace">{sheet.economy.salvageValue.toLocaleString("es-ES")}</Field>
              {sheet.economy.instanceValueFirst !== null && (
                <Field label="Valor del #1">{sheet.economy.instanceValueFirst.toLocaleString("es-ES")}</Field>
              )}
              <Field label="Anclas por versión">
                {sheet.economy.anchorByVersion.length
                  ? sheet.economy.anchorByVersion.map((a) => `v${a.version}:${a.fairValue}`).join(" · ")
                  : "—"}
              </Field>
            </FieldGrid>
          </section>

          {/* PROPIEDAD */}
          <section aria-labelledby="h-own">
            <h2 id="h-own" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">Propiedad</h2>
            <FieldGrid cols={2}>
              <Field label="Ejemplares">{sheet.instances.total}</Field>
              <Field label="Propietarios">{sheet.instances.owners}</Field>
              <Field label="Con serie">{sheet.instances.withSerial}</Field>
              <Field label="Por versión">
                {Object.entries(sheet.instances.byVersion).map(([v, n]) => `v${v}:${n}`).join(" · ") || "—"}
              </Field>
            </FieldGrid>
            <p className="mt-2 text-[12px] text-white/35">
              Solo agregados. Quién posee qué no hace falta para administrar contenido.
            </p>
          </section>

          {/* CONTENIDO */}
          <section aria-labelledby="h-cont">
            <h2 id="h-cont" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">Contenido</h2>
            <FieldGrid cols={2}>
              <Field label="Fuente">{String(def!.source)}</Field>
              <Field label="dataVersion">{String(def!.data_version)}</Field>
              <Field label="generatedAt">{fmtDate(def!.generated_at as string)}</Field>
              <Field label="Creada">{fmtDate(def!.created_at as string)}</Field>
              <Field label="Publicada">{fmtDate(def!.published_at as string | null)}</Field>
              <Field label="Retirada">{fmtDate(def!.retired_at as string | null)}</Field>
            </FieldGrid>
          </section>
        </div>
      </div>

      <Rail label={`Definición ${cardId} · versión vigente ${sheet.concurrency.definitionVersion}`} />

      {/* ── Confirmaciones ── */}
      <ConfirmDialog
        open={accion === "draftPublish"}
        title="Publicar carta"
        body={<>Pasará a <strong>PUBLISHED</strong> y entrará en el catálogo jugable. Podrá salir en sobres en cuanto esté en un pool activo.</>}
        confirmLabel="Publicar" running={running}
        onCancel={() => setAccion(null)}
        onConfirm={(reason) => void ejecutar(
          () => adminApi("lifecycle", { cardId, state: "PUBLISHED", reason }),
          "Carta publicada. El catálogo del servidor se ha invalidado.",
        )}
      />
      <ConfirmDialog
        open={accion === "retire"}
        title="Retirar de circulación"
        body={
          <>
            Dejará de salir en sobres nuevos. <strong>No se destruye nada</strong>: los{" "}
            {sheet.instances.total} ejemplares siguen en manos de sus dueños, en sus mazos, en
            el mercado y en las partidas jugadas.
          </>
        }
        confirmLabel="Retirar" tone="danger" running={running}
        onCancel={() => setAccion(null)}
        onConfirm={(reason) => void ejecutar(
          () => adminApi("lifecycle", { cardId, state: "RETIRED", reason }),
          "Carta retirada. Fuera de sobres nuevos; todo lo demás intacto.",
        )}
      />
      <ConfirmDialog
        open={accion === "republish"}
        title="Volver a publicar"
        body={<>Volverá a estar disponible para sobres nuevos, si está en un pool activo.</>}
        confirmLabel="Publicar" running={running}
        onCancel={() => setAccion(null)}
        onConfirm={(reason) => void ejecutar(
          () => adminApi("lifecycle", { cardId, state: "PUBLISHED", reason }),
          "Carta de vuelta en circulación.",
        )}
      />
    </Stage>
  );
}

function StatMeter({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <Readout value={v} label={label} size="md" />
      {/* `Meter` espera 0..100 y el trío ya vive en 1..99: no hace falta escalar nada. */}
      <Meter value={v} className="mt-1" />
    </div>
  );
}
