"use client";

/**
 * /admin/pools/nueva — ALTA DE UN POOL (Bloque 8.4.3).
 *
 * Crear un pool es declarar un conjunto vacío con nombre. **Nace en DRAFT**, no está vinculado
 * a ningún sobre y no reparte nada: llenarlo de cartas y publicarlo son dos decisiones
 * posteriores, cada una con su confirmación y su línea en el diario.
 *
 * ────────────────────────── LOS DOS MODOS, Y POR QUÉ IMPORTA ELEGIR BIEN ──────────────────────────
 *
 *   EXPLICIT  la lista de cartas ES la pertenencia. Solo sale lo que está dentro.
 *   RULE      la pertenencia la siguen decidiendo las restricciones del sobre; el pool solo
 *             aporta pesos a las cartas que nombra.
 *   MIXED     restringe como EXPLICIT y además admite reglas.
 *
 * Los 12 pools que existen hoy son EXPLICIT, migrados de `PackDef` en 8.3.
 *
 * Un pool nunca ENSANCHA lo que un sobre reparte: un sobre de EMEA con un pool que nombre
 * cartas de Pacific seguirá sin repartirlas, porque las restricciones del sobre se evalúan
 * antes. Eso se dice aquí, en el formulario, y no solo en un informe.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Stage, Plate, Recessed, Rail } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { NxButton } from "@/components/ui/NxButton";
import { adminPoolApi, useAsync, ErrorBar, Select, TextField } from "@/components/admin/cards/shared";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("admin");

/** `content_pools.id` es texto y viaja en la URL: se acota a lo que no necesita escaparse. */
const ID_VALIDO = /^[a-z0-9][a-z0-9-]{1,62}$/;

export default function NuevoPoolPage() {
  useLocale();
  const router = useRouter();
  const { running, error, clear, run } = useAsync<unknown>();

  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState("EXPLICIT");
  const [seasonId, setSeasonId] = useState("");
  const [eventId, setEventId] = useState("");
  const [reason, setReason] = useState("");

  const idOk = ID_VALIDO.test(id);
  const puede = idOk && name.trim().length > 0 && reason.trim().length > 0 && !running;

  const crear = async (): Promise<void> => {
    const r = await run(async () => adminPoolApi<{ poolId: string }>("upsert", {
      pool: {
        id, name: name.trim(),
        description: description.trim() || null,
        mode,
        season_id: seasonId.trim() || null,
        event_id: eventId.trim() || null,
      },
      reason: reason.trim(),
    }));
    if (r) router.push(`/admin/pools/${encodeURIComponent((r as { poolId: string }).poolId)}`);
  };

  return (
    <Stage data-admin-panel="pool-nuevo" className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionTitle>{t("Nuevo pool")}</SectionTitle>
          <p className="mt-1 max-w-2xl text-sm text-white/50">
            {t("Un conjunto de cartas con peso, que uno o varios sobres pueden usar. Nace vacío y en borrador: no reparte nada hasta que se llena y se publica.")}
          </p>
        </div>
        <NxButton href="/admin/pools" variant="ghost">{t("← Pools")}</NxButton>
      </header>

      <ErrorBar error={td(error)} onClose={clear} />

      <section aria-labelledby="h-identidad">
        <h2 id="h-identidad" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
          {t("1 · Identidad")}
        </h2>
        <Plate className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={t("ID")} value={id} onChange={(v) => setId(v.toLowerCase())}
              placeholder={t("evento-invierno-2026")}
              hint={id && !idOk
                ? t("Minúsculas, números y guiones; entre 2 y 63 caracteres.")
                : t("Va en la URL y en el diario. No se puede cambiar después.")}
            />
            <TextField label={t("Nombre")} value={name} onChange={setName}
              placeholder={t("Pool del Evento de Invierno")} />
          </div>
          <TextField label={t("Descripción")} value={description} onChange={setDescription}
            placeholder={t("Para qué existe este pool")} />
        </Plate>
      </section>

      <section aria-labelledby="h-modo">
        <h2 id="h-modo" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
          {t("2 · Modo y contexto")}
        </h2>
        <Plate className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label={t("Modo")} value={mode} onChange={setMode} noEmpty
              options={[
                { value: "EXPLICIT", label: t("EXPLICIT — la lista es la pertenencia") },
                { value: "RULE", label: t("RULE — solo aporta pesos") },
                { value: "MIXED", label: t("MIXED — restringe y admite reglas") },
              ]} />
            <TextField label={t("Temporada (opcional)")} value={seasonId} onChange={setSeasonId}
              placeholder={t("vct-2026")} />
            <TextField label={t("Evento (opcional)")} value={eventId} onChange={setEventId}
              placeholder={t("masters-toronto")} />
          </div>

          <Recessed className="p-3">
            <p className="text-[12px] leading-relaxed text-white/55">
              {mode === "EXPLICIT" && (
                <>{fill(t("Con {modo}, solo pueden salir las cartas que estén en la lista. Es el modo de los 12 pools que existen hoy.", slots("modo")), { modo: <strong className="text-white">{t("EXPLICIT")}</strong> })}</>
              )}
              {mode === "RULE" && (
                <>{fill(t("Con {modo}, la pertenencia la siguen decidiendo las restricciones del sobre; este pool solo cambia el peso de las cartas que nombre.", slots("modo")), { modo: <strong className="text-white">{t("RULE")}</strong> })}</>
              )}
              {mode === "MIXED" && (
                <>{fill(t("Con {modo}, la lista restringe la pertenencia y además se admiten reglas.", slots("modo")), { modo: <strong className="text-white">{t("MIXED")}</strong> })}</>
              )}
              {" "}
              {fill(t("En los tres casos un pool {accion}: nunca ensancha. Un sobre de EMEA seguirá sin repartir cartas de Pacific aunque este pool las nombre, porque las restricciones del sobre se evalúan antes.", slots("accion")), { accion: <strong>{t("estrecha y repondera")}</strong> })}
            </p>
          </Recessed>
        </Plate>
      </section>

      <section aria-labelledby="h-crear">
        <h2 id="h-crear" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
          {t("3 · Crear")}
        </h2>
        <Plate className="space-y-3 p-4">
          <label className="block" htmlFor="motivo-pool">
            <span className="font-display text-label uppercase tracking-wider text-white/50">
              {t("Motivo del alta (queda registrado)")}
            </span>
            <textarea
              id="motivo-pool" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={t("Por qué se crea este pool")}
              className="mt-1 w-full resize-y border border-white/15 bg-base-800 px-3 py-2 text-sm text-white outline-none focus-visible:border-drl"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <NxButton variant="primary" disabled={!puede} onClick={() => void crear()}>
              {running ? t("Creando…") : t("Crear en borrador")}
            </NxButton>
            <p className="text-[12px] text-white/40">
              {fill(t("Nace en {estado}, vacío y sin sobre vinculado. No afecta a ninguna apertura hasta que se le añadan cartas, se vincule a un sobre y se publique.", slots("estado")), { estado: <strong>{t("DRAFT")}</strong> })}
            </p>
          </div>
        </Plate>
      </section>

      <Rail label={t("Un pool vacío en borrador no cambia nada de lo que hoy reparten los sobres")} />
    </Stage>
  );
}
