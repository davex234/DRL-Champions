"use client";

/**
 * /admin/cartas/[id]/editar — EL CARD BUILDER (Bloque 8.4.2).
 *
 * ────────────────────────── UN SOLO CAMPO ──────────────────────────
 *
 * Esta pantalla escribe **tres números**: el trío base de combate. Nada más.
 *
 * Todo lo que se ve a la derecha —OVR, las seis estadísticas heredadas, rareza, rank, bucket,
 * valor de mercado, desguace— aparece porque se ha derivado de esos tres, del jugador y de la
 * variante. No hay un campo para escribir «OVR 95», y no es una omisión: el bloque 8.4.1
 * dejaba enviarlo y la auditoría de 8.4.2 comprobó que un 99 escrito a mano llegaba hasta el
 * ancla del mercado. El OVR es una consecuencia, no una opinión.
 *
 * ────────────────────────── LA CUENTA SE HACE DOS VECES, A PROPÓSITO ──────────────────────────
 *
 * Mientras se teclea, esta página llama a `deriveCard()` para enseñar el resultado. Es la
 * MISMA función pura del dominio que usa el servidor: no hay una fórmula de cliente y otra de
 * servidor, hay una función importada desde dos sitios.
 *
 * Lo que se envía al guardar es solo el trío. El servidor vuelve a derivar y **descarta**
 * cualquier cifra que llegara en la petición. Es decir: lo de aquí es una PREDICCIÓN, y como
 * es la misma función, la predicción es exacta. El administrador ve antes de guardar
 * exactamente lo que se va a guardar.
 *
 * ────────────────────────── BORRADOR Y CARTA EN JUEGO ──────────────────────────
 *
 *   DRAFT               se edita en sitio. No hay ejemplares: no hay a quién proteger.
 *   PUBLISHED / RETIRED se publica una VERSIÓN nueva. Los ejemplares ya acuñados siguen
 *                       apuntando a la suya y no cambian (bloque 8.2).
 *   ARCHIVED / REJECTED no se edita. La pantalla lo dice y no ofrece el formulario.
 *
 * Antes de publicar sobre una carta en juego, el diálogo enseña **cuántos ejemplares se
 * quedan como están**. Es el número que importa y el que convierte «no afecta a nadie» en una
 * cifra comprobable.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Stage, Plate, Recessed, Rail } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Loading, ErrorState } from "@/components/ui/States";
import {
  adminApi, useAsync, ErrorBar, ConfirmDialog, LifecycleBadge, BucketBadge, Field, FieldGrid,
} from "@/components/admin/cards/shared";
import { CardPreview } from "@/components/admin/cards/CardPreview";
import { getVariant } from "@/domain/cards/variants";
import { deriveCard, COMBAT_STAT_META, type CombatStats } from "@/domain/cards/combat";
import { applyStatBoost } from "@/domain/cards/ovr";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import type { Player, VariantId, CardDef } from "@/domain/cards/types";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("admin");

interface EditorData {
  cardId: string;
  lifecycle: string;
  origin: string;
  definitionVersion: number;
  updatedAt: string | null;
  player: Player;
  variant: { id: string; label: string; group: string; rank: number; bucket: string; statBoost: number; serialized: boolean; serialLimit: number | null };
  baseCombat: CombatStats;
  storedCombat: CombatStats;
  baseExact: boolean;
  generator: { combat: CombatStats; source: string } | null;
  generatorReason: string | null;
  instances: { total: number; byVersion: Record<string, number> };
}

const EJES = ["stronghold", "gamesense", "entryfrag"] as const;

export default function EditarCartaPage() {
  useLocale();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const cardId = decodeURIComponent(String(params.id));
  const { running, error, clear, run } = useAsync<unknown>();

  const [data, setData] = useState<EditorData | null>(null);
  const [base, setBase] = useState<CombatStats>({ stronghold: 0, gamesense: 0, entryfrag: 0 });
  const [confirmando, setConfirmando] = useState(false);
  const [conflicto, setConflicto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await run(async () => adminApi<EditorData>("editor", { cardId }));
    if (r) {
      const d = r as EditorData;
      setData(d);
      setBase(d.baseCombat);
      setConflicto(null);
    }
  }, [cardId, run]);

  useEffect(() => { void cargar(); }, [cargar]);

  /*
   * LA PREVISUALIZACIÓN, derivada con el dominio.
   *
   * `deriveCard` es la misma función que compone el catálogo y la misma que llamará el
   * servidor al guardar. Aquí no se suma un boost a mano ni se pondera un OVR: se pide.
   */
  const derivada = useMemo(() => {
    if (!data) return null;
    let variant;
    try { variant = getVariant(data.variant.id as VariantId); } catch { return null; }
    const { combat, ovr } = deriveCard(base, variant.statBoost);
    const stats = applyStatBoost(data.player.stats, variant.statBoost);
    const card: CardDef = {
      id: data.cardId, playerId: data.player.id, variantId: variant.id,
      stats, ovr, combat, statBoost: variant.statBoost,
    };
    return { variant, combat, ovr, stats, card };
  }, [data, base]);

  const original = useMemo(() => {
    if (!data || !derivada) return null;
    const { combat, ovr } = deriveCard(data.baseCombat, derivada.variant.statBoost);
    return { combat, ovr };
  }, [data, derivada]);

  const hayCambios = useMemo(() => {
    if (!data) return false;
    return EJES.some((k) => base[k] !== data.baseCombat[k]);
  }, [data, base]);

  const esBorrador = data?.lifecycle === "DRAFT";
  const enJuego = data?.lifecycle === "PUBLISHED" || data?.lifecycle === "RETIRED";
  const editable = esBorrador || enJuego;

  const setEje = (k: (typeof EJES)[number], v: string): void => {
    const n = v === "" ? 0 : Number(v);
    if (!Number.isFinite(n)) return;
    setBase({ ...base, [k]: Math.max(0, Math.min(99, Math.round(n))) });
  };

  const guardar = async (motivo: string): Promise<void> => {
    if (!data) return;
    const accion = esBorrador ? "updateDraft" : "publish";
    const r = await run(async () => {
      try {
        return await adminApi<{ version?: number }>(accion, {
          cardId, combat: base, reason: motivo, expectedVersion: data.definitionVersion,
        });
      } catch (e) {
        /*
         * EL CONFLICTO SE DETECTA AQUÍ, no leyendo `error` después de `run`.
         *
         * `error` es estado de React: justo después de `await run(...)` todavía tiene el valor
         * anterior, así que preguntarle si hubo conflicto contestaría por la llamada de antes.
         * El aviso se toma del indicador `conflict` que la ruta ya devuelve —no de comparar
         * el texto del mensaje, que cambiaría con cualquier reescritura.
         */
        const err = e as Error & { conflict?: boolean; current?: number };
        if (err.conflict) {
          setConflicto(
            `${err.message}${err.current ? t(" La versión vigente ahora es la v{current}.", { current: err.current }) : ""}`,
          );
        }
        throw err;
      }
    });
    setConfirmando(false);
    // Lo tecleado NO se toca: si ha fallado, los tres números siguen donde estaban.
    if (r === null) return;
    router.push(`/admin/cartas/${encodeURIComponent(cardId)}`);
  };

  if (!data && running) return <Stage className="p-6"><Loading label={t("Cargando el editor…")} /></Stage>;
  if (!data) {
    return (
      <Stage className="space-y-4 p-6">
        <ErrorBar error={td(error)} onClose={clear} />
        <ErrorState message={t("No se pudo abrir el editor de {cardId}", { cardId: td(cardId) })} onRetry={() => void cargar()} />
        <NxButton href="/admin/cartas" variant="secondary">{t("Volver al listado")}</NxButton>
      </Stage>
    );
  }

  const ejemplaresIntactos = data.instances.total;

  return (
    <Stage data-admin-panel="editar" className="space-y-5 p-4 sm:p-6">
      {/* ── Cabecera ── */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SectionTitle>{data.player.nick}</SectionTitle>
            <LifecycleBadge state={data.lifecycle} />
            <BucketBadge bucket={data.variant.bucket} rank={data.variant.rank} />
            <Badge tone="muted">v{data.definitionVersion}</Badge>
          </div>
          <p className="mt-1 font-mono text-[12px] text-drl-cyan">{data.cardId}</p>
        </div>
        <div className="flex gap-2">
          <NxButton href={`/admin/cartas/${encodeURIComponent(cardId)}`} variant="ghost">{t("← Ficha")}</NxButton>
        </div>
      </header>

      {/* Con conflicto manda la banda de abajo, que explica qué hacer. No se dice dos veces. */}
      <ErrorBar error={conflicto ? null : td(error)} onClose={clear} />

      {conflicto && (
        <Plate tone="gold" className="space-y-2 p-4" role="alert">
          <p className="font-display text-sm font-bold uppercase tracking-wider text-drl-gold">
            {t("Otro administrador se ha adelantado")}
          </p>
          <p className="text-sm text-white/70">{td(conflicto)}</p>
          <p className="text-sm text-white/50">
            {t("No se ha guardado nada. Tus tres números siguen en el formulario: anótalos si los necesitas, recarga para ver lo que hay ahora y decide sobre esa base.")}
          </p>
          <NxButton variant="secondary" onClick={() => void cargar()}>
            {t("Recargar la versión actual")}
          </NxButton>
        </Plate>
      )}

      {!editable && (
        <Plate tone="neutral" className="p-4">
          <p className="text-sm text-white/70">
            {fill(t("Una carta en {estado} no se edita. Es el final del ciclo de vida: su definición y su historial se conservan tal cual, y ni se versiona ni se borra. Si hay que retomarla, primero hay que moverla de estado desde la ficha.", slots("estado")), { estado: <strong>{td(data.lifecycle)}</strong> })}
          </p>
        </Plate>
      )}

      {editable && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
          {/* ── Izquierda: lo que se escribe y lo que se deriva ── */}
          <div className="min-w-0 space-y-5">
            <section aria-labelledby="h-trio">
              <h2 id="h-trio" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
                {t("1 · Trío de combate (lo único que se escribe)")}
              </h2>
              <Plate className="space-y-4 p-4">
                <p className="text-sm text-white/50">
                  {fill(t("Son los valores {base} del jugador, sin el bonus de la variante. La carta suma después los {bonus} de {variante}.", { ...slots("base", "bonus"), variante: td(data.variant.label) }), {
                    base: <strong>{t("base")}</strong>,
                    bonus: <strong className="text-white/80">+{data.variant.statBoost}</strong>,
                  })}
                </p>

                {!data.baseExact && (
                  <Recessed className="border border-drl-gold/30 p-3">
                    <p className="text-[12px] leading-relaxed text-drl-gold">
                      {t("El trío guardado no se reconstruye exactamente desde su base (algún eje está en el tope de la escala). Los números de abajo son la base mínima compatible: guardar sin tocarlos deja la carta como está.")}
                    </p>
                  </Recessed>
                )}

                <div className="grid gap-3 sm:grid-cols-3">
                  {EJES.map((k) => (
                    <div key={k} className="min-w-0">
                      <label htmlFor={`eje-${k}`} className="block">
                        <span
                          className="font-display text-label uppercase tracking-wider"
                          style={{ color: COMBAT_STAT_META[k].color }}
                        >
                          {td(COMBAT_STAT_META[k].label)} · {td(COMBAT_STAT_META[k].full)}
                        </span>
                      </label>
                      <input
                        id={`eje-${k}`}
                        type="number" inputMode="numeric" min={0} max={99} step={1}
                        value={String(base[k])}
                        onChange={(e) => setEje(k, e.target.value)}
                        aria-describedby={`eje-${k}-ayuda`}
                        className="mt-1 min-h-[44px] w-full border border-white/15 bg-base-800 px-3 font-display text-lg font-bold tabular-nums text-white outline-none focus-visible:border-drl"
                      />
                      <p id={`eje-${k}-ayuda`} className="mt-1 text-[11px] text-white/35">
                        {t("base 0-99 · en carta {valor}", { valor: derivada?.combat[k] ?? "—" })}
                        {data.baseCombat[k] !== base[k] && (
                          <span className="text-drl-gold"> {t("· era {valor}", { valor: data.baseCombat[k] })}</span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <NxButton
                    variant="tertiary"
                    disabled={!hayCambios}
                    onClick={() => setBase(data.baseCombat)}
                  >
                    {t("Deshacer cambios")}
                  </NxButton>
                  {data.generator ? (
                    <NxButton
                      variant="tertiary"
                      onClick={() => setBase(data.generator!.combat)}
                    >
                      {t("Restaurar el trío derivado ({trio})", { trio: `${data.generator.combat.stronghold}/${data.generator.combat.gamesense}/${data.generator.combat.entryfrag}` })}
                    </NxButton>
                  ) : (
                    <Badge tone="warn">
                      {t("Sin trío derivable:")} {td(data.generatorReason) ?? t("el generador rechaza a este jugador")}
                    </Badge>
                  )}
                </div>
              </Plate>
            </section>

            {/* ── Lo derivado ── */}
            <section aria-labelledby="h-derivado">
              <h2 id="h-derivado" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
                {t("2 · Lo que se deriva (no se escribe)")}
              </h2>
              <Plate className="space-y-4 p-4">
                <div className="flex flex-wrap items-end gap-6">
                  <div>
                    <p className="font-display text-label uppercase tracking-wider text-white/40">{t("OVR")}</p>
                    <p className="font-display text-4xl font-bold tabular-nums text-white">
                      {derivada?.ovr ?? "—"}
                      {original && derivada && derivada.ovr !== original.ovr && (
                        <span className="ml-2 align-middle font-display text-sm text-drl-gold">
                          {t("era {valor}", { valor: original.ovr })}
                        </span>
                      )}
                    </p>
                  </div>
                  <p className="max-w-sm text-[12px] leading-relaxed text-white/40">
                    {fill(t("Sale de {fn} sobre el trío ya boosteado: media ponderada del trío ordenado de mayor a menor, reescalada contra el anclaje congelado de VCT-2026.", slots("fn")), { fn: <code className="text-white/60">computeCombatOvr()</code> })}
                  </p>
                </div>

                <FieldGrid cols={4}>
                  <Field label={t("Rank")}>{data.variant.rank}</Field>
                  <Field label={t("Bucket")}>{td(data.variant.bucket)}</Field>
                  <Field label={t("Stat boost")}>+{data.variant.statBoost}</Field>
                  <Field label={t("Serializada")}>
                    {data.variant.serialized ? t("sí · /{v}", { v: data.variant.serialLimit ?? "?" }) : t("no")}
                  </Field>
                  <Field label={t("Valor de mercado")}>
                    {derivada ? t("{v} cr", { v: marketValue(derivada.card).toLocaleString(getIntlLocale()) }) : "—"}
                  </Field>
                  <Field label={t("Desguace")}>
                    {derivada ? t("{v} cr", { v: salvageValue(derivada.card).toLocaleString(getIntlLocale()) }) : "—"}
                  </Field>
                  <Field label={t("Origen de la definición")}>{td(data.origin)}</Field>
                  <Field label={t("Ejemplares acuñados")}>{ejemplaresIntactos}</Field>
                </FieldGrid>

                <Recessed className="p-3">
                  <p className="text-[11px] leading-relaxed text-white/45">
                    {fill(t("Rank, bucket y boost los fija la variante; las seis estadísticas heredadas salen del jugador más el boost; la huella la firma el servidor sobre la fila final. Si el trío que guardas difiere del derivado, la carta queda marcada {marca}: deja de ser un dato de VLR y pasa a ser una decisión con nombre y motivo.", slots("marca")), { marca: <code className="text-drl-gold">editorial</code> })}
                  </p>
                </Recessed>
              </Plate>
            </section>
          </div>

          {/* ── Derecha: la carta de verdad ── */}
          <section aria-labelledby="h-preview" className="min-w-0">
            <h2 id="h-preview" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
              {t("3 · Cómo queda")}
            </h2>
            <Plate className="p-4">
              {derivada ? (
                <CardPreview
                  player={data.player}
                  variant={derivada.variant}
                  stats={derivada.stats}
                  ovr={derivada.ovr}
                  combat={derivada.combat}
                  size="lg"
                  nota={esBorrador ? t("Es un borrador: todavía no la tiene nadie.") : undefined}
                />
              ) : (
                <p className="p-6 text-sm text-white/40">{t("Sin datos suficientes para la preview.")}</p>
              )}
            </Plate>
          </section>
        </div>
      )}

      {/* ── Guardar ── */}
      {editable && (
        <section aria-labelledby="h-guardar">
          <h2 id="h-guardar" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
            {t("4 · Guardar")}
          </h2>
          <Plate className="flex flex-wrap items-center gap-3 p-4">
            <NxButton
              variant="primary"
              disabled={!hayCambios || running}
              onClick={() => setConfirmando(true)}
            >
              {esBorrador ? t("Guardar el borrador") : t("Publicar una versión nueva")}
            </NxButton>
            <p className="text-[12px] text-white/40">
              {esBorrador
                ? t("Se edita en sitio: no hay ejemplares, así que no hay historia que preservar.")
                : t("Se crea la versión v{v}. Los {ejemplaresIntactos} ejemplares ya acuñados siguen apuntando a la suya y no cambian.", { v: data.definitionVersion + 1, ejemplaresIntactos })}
            </p>
          </Plate>
        </section>
      )}

      <Rail label={t("El trío lo escribe una persona; el resto lo deriva el servidor")} />

      <ConfirmDialog
        open={confirmando}
        title={esBorrador ? t("Guardar el borrador") : t("Publicar la versión v{v}", { v: data.definitionVersion + 1 })}
        confirmLabel={esBorrador ? t("Guardar") : t("Publicar versión")}
        running={running}
        onCancel={() => setConfirmando(false)}
        onConfirm={(motivo) => void guardar(motivo)}
        body={
          <div className="space-y-2 text-sm text-white/70">
            <p className="font-mono text-[12px] text-drl-cyan">{data.cardId}</p>
            <p>
              {t("Trío base")} {data.baseCombat.stronghold}/{data.baseCombat.gamesense}/
              {data.baseCombat.entryfrag} → <strong className="text-white">
                {base.stronghold}/{base.gamesense}/{base.entryfrag}
              </strong>
            </p>
            {original && derivada && (
              <p>{t("OVR")} {original.ovr} → <strong className="text-white">{derivada.ovr}</strong></p>
            )}
            {esBorrador ? (
              <p className="text-white/50">
                {t("Es un borrador: se reescribe su versión 1 y no hay ejemplares a los que afectar.")}
              </p>
            ) : (
              <p className="text-white/50">
                {fill(t("Se crea una versión nueva. {n} ejemplares ya acuñados se quedan exactamente como están: siguen apuntando a la versión bajo la que nacieron.", slots("n")), { n: <strong className="text-white">{ejemplaresIntactos}</strong> })}
              </p>
            )}
          </div>
        }
      />
    </Stage>
  );
}
