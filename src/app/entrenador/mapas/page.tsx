"use client";

/**
 * MAPAS — MAP INTELLIGENCE. Los doce mapas del Entrenador.
 *
 * Una pantalla de ESTUDIO, no un editor: aquí no se arrastra nada y no se guarda nada. Se
 * elige un mapa, se mira grande, se hace zoom donde interese y se pasa a la pizarra.
 *
 * El asset se enseña **tal cual**: sin recortar, sin escalar de forma permanente y sin
 * deformar. Lo que cambia es la cámara. Solo se descarga el PNG del mapa elegido: el selector usa
 * las miniaturas (`public/maps/thumbs`).
 *
 * FASE 51 · además de los datos del asset, lo que TÚ tienes preparado en ese mapa (jugadas y
 * composiciones), leído de tus datos reales. Sin sesión o si la lectura falla, esa línea no sale.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  availableMaps, getTacticalMap, aspectRatio, DEFAULT_MAP_ID, type TacticalMap,
} from "@/domain/tactics";
import { MapCanvas, fitCamera, type Camera } from "@/components/tactics/MapCanvas";
import { MapPicker } from "@/components/tactics/MapPicker";
import { CoachHeader } from "@/components/coach/tc/CoachFrame";
import { useAuth } from "@/lib/supabase/auth";
import { fetchStrats, fetchCompositions } from "@/lib/tactics/client";
import { ns, td, formatNumber } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("entrenador");

interface Preparado { strats: Record<string, number>; comps: Record<string, number> }

export default function MapasPage() {
  useLocale();
  const { user } = useAuth();
  const [id, setId] = useState(DEFAULT_MAP_ID);
  const map: TacticalMap = getTacticalMap(id) ?? availableMaps()[0];
  const [camera, setCamera] = useState<Camera>(() => fitCamera(map));
  const [preparado, setPreparado] = useState<Preparado | null>(null);

  useEffect(() => { setCamera(fitCamera(map)); }, [map.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return;
    let vivo = true;
    Promise.all([fetchStrats(), fetchCompositions()])
      .then(([s, c]) => {
        if (!vivo) return;
        const cuenta = (ids: string[]) => ids.reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});
        setPreparado({ strats: cuenta(s.map((x) => x.mapId)), comps: cuenta(c.map((x) => x.mapId)) });
      })
      .catch(() => { /* Sin datos no se inventa nada: la línea no se enseña. */ });
    return () => { vivo = false; };
  }, [user]);

  const jugadas = preparado?.strats[map.id] ?? 0;
  const comps = preparado?.comps[map.id] ?? 0;

  return (
    <div className="space-y-3">
      <CoachHeader
        kicker={t("Map Intelligence")}
        title={<>{t("Mapas ·")} <span className="text-[#2fe0ff]">{td(map.name)}</span></>}
        actions={
          <>
            <Link href="/entrenador/composiciones" className="nx-coach-btn" data-variant="ghost">{t("Composiciones")}</Link>
            <Link href="/entrenador/strats" className="nx-coach-btn">{t("Ir a la pizarra →")}</Link>
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 space-y-3">
          <div className="nx-coach-board relative">
            {(["tl", "tr", "bl", "br"] as const).map((c) => <span key={c} aria-hidden className="nx-coach-corner z-10" data-c={c} />)}
            <MapCanvas
              map={map}
              camera={camera}
              onCamera={setCamera}
              /* El lienzo se mide en `vh`, también en móvil: un mapa de estudio de 267 px no se estudia. */
              className="h-[min(58vh,470px)] w-full sm:h-[min(66vh,600px)] lg:h-[min(76vh,860px)]"
            >
              {/* Pantalla de estudio: el mapa y nada encima. */}
              <g />
            </MapCanvas>
          </div>

          {/* Los datos del mapa como CIFRAS. */}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="map-intel">
            <Cifra label={t("Sitios")} value={map.sites} />
            <Cifra label={t("Resolución")} value={`${map.width} × ${map.height}`} />
            <Cifra label={t("Proporción")} value={formatNumber(aspectRatio(map), { minimumFractionDigits: 3, maximumFractionDigits: 3 })} />
            {preparado ? (
              <Cifra label={t("Tu preparación")} value={t("{jugadas} jug. · {comps} comp.", { jugadas, comps })} tone="#2fe0ff" />
            ) : (
              <Cifra label={t("Mapa")} value={map.name} tone="#2fe0ff" />
            )}
          </dl>
        </section>

        <aside className="space-y-3">
          <section className="nx-coach-panel p-3">
            <h2 className="nx-coach-kicker mb-2">{t("Elegir mapa")}</h2>
            <MapPicker compact value={map.id} onChange={(m) => setId(m.id)} />
          </section>

          <section className="nx-coach-panel p-3">
            <h2 className="nx-coach-kicker mb-1.5">{td(map.name)}</h2>
            <p className="text-[14px] leading-relaxed text-white/75">{td(map.identity)}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Link href="/entrenador/strats" className="nx-coach-btn" data-size="sm">{t("Dibujar una jugada")}</Link>
              <Link href="/entrenador/composiciones" className="nx-coach-btn" data-variant="ghost" data-size="sm">{t("Preparar composición")}</Link>
            </div>
            <p className="nx-coach-muted mt-3 border-t border-[rgba(47,224,255,0.12)] pt-2.5 text-[12px] leading-relaxed">
              {fill(t("Son assets de mapa adaptados para NEXUS y se usan como capa visual de la herramienta. Los rótulos de los sitios forman parte del propio asset: la pizarra dibuja {encima}, nunca sobre la imagen.", slots("encima")), { encima: <em>{t("encima")}</em> })}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Cifra({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  useLocale();
  return (
    <div className="nx-coach-stat px-3 py-2.5">
      <dt className="nx-label !text-[9.5px] !text-white/45">{td(label)}</dt>
      <dd className="mt-1 truncate font-display text-[17px] font-extrabold uppercase leading-none" style={{ color: tone ?? "#fff" }}>{value}</dd>
    </div>
  );
}
