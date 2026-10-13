"use client";

/**
 * ARTEFACTOS DE UNA CARTA, VERSIÓN A VERSIÓN.
 *
 * ────────────────────────── TRES COSAS, Y UNA MANDA ──────────────────────────
 *
 *   1. ARTWORK (manual)   la ilustración final, hecha por una persona. **Es la definitiva.**
 *   2. DEFINICIÓN (JSON)  la fila de `content_card_versions`. Existe siempre; no se genera.
 *   3. RENDER (técnico)   la exportación del pipeline. Prueba de datos, no arte.
 *
 * El orden de la pantalla es ese a propósito. Las cartas de NEXUS se diseñan a mano; el
 * render existe para comprobar que los datos de una versión son los que se creen, no para
 * sustituir al diseñador. Ponerlo primero invitaría a confundir un marcador con una carta.
 *
 * ────────────────────────── UNA VERSIÓN, SUS PROPIOS FICHEROS ──────────────────────────
 *
 * Cada versión tiene su bloque. El artwork se guarda con la clave `<card_id>#v<N>`, así que
 * la v1 y la v2 son sujetos distintos en el gestor de assets: subir el de la v2 no puede
 * pisar el de la v1 porque ni siquiera comparten fila.
 *
 * ────────────────────────── SOLO SE PINTA LO QUE TIENE SENTIDO ──────────────────────────
 *
 * Sin artwork: «Subir artwork». Con artwork: «Ver», «Descargar» y «Reemplazar». No hay un
 * botón de descarga esperando junto a algo que no existe.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Plate, Recessed } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { adminDownload } from "@/lib/supabase/adminClient";
import { adminFetch } from "@/lib/supabase/adminClient";
import { adminApi, useAsync, ErrorBar } from "./shared";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("admin");

export interface VersionArtifact {
  version: number;
  ovr: number;
  effective_to: string | null;
  checksum: string;
}

interface ArtworkAsset {
  id: string; cardId: string; cardVersion: number; name: string; format: string;
  bytes: number; checksum: string; url: string | null; assetVersion: number; createdAt: string;
}
interface RenderEstado {
  generated: boolean; files: { kind: string; path: string; bytes: number }[]; fingerprint: string;
}
interface EstadoVersion { version: number; artwork: ArtworkAsset | null; render: RenderEstado }

const KB = (b: number): string => `${Math.round(b / 1024)} KB`;

export function CardArtifacts({
  cardId, versions, instancesByVersion,
}: {
  cardId: string;
  versions: readonly VersionArtifact[];
  instancesByVersion: Record<string, number>;
}) {
  useLocale();
  const { running, error, clear, run } = useAsync<unknown>();
  const [estados, setEstados] = useState<Record<number, EstadoVersion>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const inputs = useRef<Record<number, HTMLInputElement | null>>({});

  const cargar = useCallback(async () => {
    const r = await run(async () => adminApi<{ versions: EstadoVersion[] }>("artworkStatus", { cardId }));
    if (r) {
      const mapa: Record<number, EstadoVersion> = {};
      for (const e of (r as { versions: EstadoVersion[] }).versions) mapa[e.version] = e;
      setEstados(mapa);
    }
  }, [cardId, run]);

  useEffect(() => { void cargar(); }, [cargar]);

  /** Sube el fichero elegido. Multipart: el binario no cabe en un JSON. */
  const subir = async (version: number, file: File): Promise<void> => {
    setOcupado(`${version}:subir`);
    setErrorLocal(null); setAviso(null);
    try {
      const fd = new FormData();
      fd.append("action", "artworkUpload");
      fd.append("cardId", cardId);
      fd.append("version", String(version));
      fd.append("file", file);
      const res = await adminFetch("/api/admin/cards", { method: "POST", body: fd });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((cuerpo as { error?: string }).error ?? `HTTP ${res.status}`);
      const a = cuerpo as ArtworkAsset;
      setAviso(a.assetVersion > 1
        ? t("Artwork de la v{version} reemplazado (revisión {assetVersion} del asset). El anterior se conserva.", { version, assetVersion: a.assetVersion })
        : t("Artwork de la v{version} subido — {format} · {bytes}.", { version, format: a.format.toUpperCase(), bytes: KB(a.bytes) }));
      await cargar();
    } catch (e) {
      setErrorLocal(e instanceof Error ? e.message : t("No se pudo subir el artwork"));
    } finally {
      setOcupado(null);
    }
  };

  const descargar = async (url: string, nombre: string, clave: string): Promise<void> => {
    setOcupado(clave); setErrorLocal(null);
    try { await adminDownload(url, nombre); }
    catch (e) { setErrorLocal(e instanceof Error ? e.message : t("No se pudo descargar")); }
    finally { setOcupado(null); }
  };

  const generarRender = async (version: number): Promise<void> => {
    setOcupado(`${version}:render`); setAviso(null);
    const r = await run(async () => adminApi<{ cached: boolean; substituted: number }>(
      "renderArtwork", { cardId, version }));
    setOcupado(null);
    if (r) {
      const d = r as { cached: boolean; substituted: number };
      setAviso(d.cached ? t("Render técnico de la v{version} ya existía · {substituted} elementos con marcador.", { version, substituted: d.substituted }) : t("Render técnico de la v{version} generado · {substituted} elementos con marcador.", { version, substituted: d.substituted }));
      await cargar();
    }
  };

  return (
    <section aria-labelledby="h-artefactos">
      <h2 id="h-artefactos" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
        {t("Artwork de la carta ({n, plural, one {# versión} other {# versiones}})", { n: versions.length })}
      </h2>

      <Plate className="space-y-3 p-4">
        <ErrorBar error={td(error) ?? td(errorLocal)} onClose={() => { clear(); setErrorLocal(null); }} />
        {aviso && (
          <Recessed className="px-3 py-2" role="status">
            <p className="text-[13px] text-white/75">{td(aviso)}</p>
          </Recessed>
        )}

        {versions.map((v) => {
          const est = estados[v.version];
          const art = est?.artwork ?? null;
          const ejemplares = instancesByVersion[String(v.version)] ?? 0;
          const vigente = v.effective_to === null;

          return (
            <Recessed key={v.version} className="space-y-3 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={vigente ? "ok" : "muted"}>v{v.version}</Badge>
                <span className="font-display text-sm font-bold uppercase tracking-wide text-white">
                  {t("Versión")} {v.version}
                </span>
                <span className="text-[12px] text-white/45">
                  {t("OVR")} {v.ovr} · {ejemplares === 0
                    ? t("sin ejemplares")
                    : t("{n, plural, one {# ejemplar} other {# ejemplares}}", { n: ejemplares })}
                </span>
              </div>

              {/* ── EL ARTWORK: lo que importa ── */}
              <div className="border-t border-white/5 pt-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-label uppercase tracking-wider text-white/50">
                      {t("Artwork")}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-[13px]">
                      <span aria-hidden className={art ? "text-drl-ok" : "text-white/25"}>
                        {art ? "●" : "○"}
                      </span>
                      <span className={art ? "text-white/80" : "text-white/45"}>
                        {art
                          ? t("Disponible · {format} · {bytes}", { format: art.format.toUpperCase(), bytes: KB(art.bytes) })
                          : t("Sin artwork")}
                      </span>
                    </p>
                    {art && (
                      <p className="mt-0.5 font-mono text-[11px] text-white/30">
                        {art.name} {t("· rev.")} {art.assetVersion} · {art.checksum.slice(0, 12)}…
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {/*
                      El `input` va oculto y lo dispara el botón: un `<input type=file>` desnudo
                      no se puede vestir con el lenguaje del panel, y el objetivo táctil de 44 px
                      lo da el botón.
                    */}
                    <input
                      ref={(el) => { inputs.current[v.version] = el; }}
                      type="file" accept="image/png,image/webp" className="sr-only"
                      aria-label={t("Artwork para la versión {version}", { version: v.version })}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void subir(v.version, f);
                        e.target.value = "";
                      }}
                    />
                    <NxButton
                      variant={art ? "tertiary" : "primary"}
                      disabled={ocupado !== null}
                      onClick={() => inputs.current[v.version]?.click()}
                    >
                      {ocupado === `${v.version}:subir`
                        ? t("Subiendo…")
                        : art ? t("Reemplazar") : t("Subir artwork")}
                    </NxButton>

                    {art?.url && (
                      <>
                        {/*
                          «Ver» abre el fichero en una pestaña nueva. `NxButton` no admite
                          `target`, así que aquí va un enlace con la misma altura de 44 px:
                          forzar el componente habría sido peor que usar el elemento correcto.
                        */}
                        <a
                          href={art.url} target="_blank" rel="noreferrer"
                          className="nx-clip-sm nx-focus inline-flex min-h-[44px] items-center px-4
                                     font-display text-sm font-bold uppercase tracking-wide text-white/80
                                     shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] transition duration-fast
                                     hover:bg-white/5 hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]"
                        >
                          {t("Ver")}
                        </a>
                        <NxButton
                          variant="secondary" disabled={ocupado !== null}
                          onClick={() => void descargar(
                            art.url!, `${cardId}.v${v.version}.${art.format}`, `${v.version}:dl`)}
                        >
                          {ocupado === `${v.version}:dl` ? "…" : t("Descargar")}
                        </NxButton>
                      </>
                    )}
                  </div>
                </div>

                {/* ── PREVIEW: el fichero real, no una recreación ── */}
                {art?.url && (
                  <div className="mt-3 flex flex-wrap items-start gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={art.url} alt={t("Artwork de {cardId} versión {version}", { cardId: td(cardId), version: v.version })}
                      className="nx-clip-sm block max-h-64 w-auto border border-white/10 bg-base-800"
                    />
                    <p className="max-w-prose text-[12px] leading-relaxed text-white/45">
                      {fill(t("Este es el fichero que usa la {version}. Un ejemplar acuñado bajo esta versión enseñará esta ilustración aunque después se publiquen versiones nuevas.", slots("version")), { version: <strong className="text-white/70">{t("versión {n}", { n: v.version })}</strong> })}
                    </p>
                  </div>
                )}
              </div>

              {/* ── La definición, siempre disponible ── */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-3">
                <div className="min-w-0">
                  <p className="font-display text-label uppercase tracking-wider text-white/50">
                    {t("Definición · JSON")}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-white/35">
                    {cardId}.v{v.version}{t(".json ·")} {v.checksum.slice(0, 12)}…
                  </p>
                </div>
                <NxButton
                  variant="secondary" disabled={ocupado !== null}
                  onClick={() => void descargar(
                    `/api/admin/cards?cardId=${encodeURIComponent(cardId)}&version=${v.version}`,
                    `${cardId}.v${v.version}.json`, `${v.version}:json`)}
                >
                  {ocupado === `${v.version}:json` ? "…" : t("Descargar JSON")}
                </NxButton>
              </div>

              {/* ── El render técnico, al final y dicho por su nombre ── */}
              <details className="border-t border-white/5 pt-3">
                <summary className="cursor-pointer font-display text-label uppercase tracking-wider text-white/35">
                  {est?.render.generated ? t("Render técnico · generado") : t("Render técnico")}
                </summary>
                <p className="mt-1.5 max-w-prose text-[12px] leading-relaxed text-white/45">
                  {fill(t("Exportación del pipeline a partir de los datos de la versión. Sirve para comprobar que la carta dice lo que debe; {aviso} — ese se diseña a mano y se sube arriba.", slots("aviso")), { aviso: <strong className="text-white/70">{t("no es el arte final")}</strong> })}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <NxButton
                    variant="tertiary" disabled={running || ocupado !== null}
                    onClick={() => void generarRender(v.version)}
                  >
                    {ocupado === `${v.version}:render`
                      ? t("Generando…")
                      : est?.render.generated ? t("Regenerar") : t("Generar render")}
                  </NxButton>
                  {est?.render.generated && ["png", "webp"].map((k) => (
                    est.render.files.some((f) => f.kind === k) ? (
                      <NxButton
                        key={k} variant="secondary" disabled={ocupado !== null}
                        onClick={() => void descargar(
                          `/api/admin/cards?cardId=${encodeURIComponent(cardId)}&version=${v.version}&artifact=${k}`,
                          `${cardId}.v${v.version}.render.${k}`, `${v.version}:r${k}`)}
                      >
                        {k.toUpperCase()}
                      </NxButton>
                    ) : null
                  ))}
                </div>
              </details>
            </Recessed>
          );
        })}

        <Recessed className="p-3">
          <p className="text-[12px] leading-relaxed text-white/50">
            {fill(t("El artwork se guarda en el gestor de assets con la clave {clave}, así que cada versión tiene el suyo y reemplazar uno no toca los demás. Subir un artwork {nomodifica} el OVR, el trío, la rareza, el valor ni la huella de la carta: es un asset asociado, no un dato de la definición.", slots("clave", "nomodifica")), { clave: <code className="text-drl-cyan">{cardId}#v&lt;N&gt;</code>, nomodifica: <strong className="text-white/70">{t("no modifica")}</strong> })}
          </p>
        </Recessed>
      </Plate>
    </section>
  );
}
