"use client";

/**
 * WALKOUT 0.6 · /admin/walkout — VISTA PREVIA PROTEGIDA del walkout en PRODUCCIÓN, con el despliegue en «off».
 *
 * Para qué: validar en la web real (GPU del dispositivo, assets servidos por el VPS, CSP, audio) la MISMA pieza que la
 * apertura presenta tras guardar un sobre (`PackWalkout`), con la MISMA cola (`packWalkoutQueue` sobre el plan de
 * revelado) de resultados FIJOS de cartas reales del catálogo (las escenas del arnés F81).
 *
 * Qué NO hace: no abre sobres, no llama a ningún endpoint de juego, no toca el store (ni inventario, ni créditos, ni
 * cartas), no guarda nada. Quién entra lo decide el servidor: todo `/admin/*` pasa por `AdminGuard` (`profiles.is_admin`).
 */
import { useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { buildRevealPlan, toOpenedInstances } from "@/domain/packs/reveal";
import { packWalkoutQueue } from "@/domain/walkout/packWalkout";
import { PACK_WALKOUT_3D_ENABLED } from "@/config/features";
import { PackWalkout } from "@/components/packs/PackWalkout";
import { PageHeader, Panel } from "@/components/admin/cc/ui";
import { WALKOUT_SCENES, f81Results } from "@/app/design-system/fase81/fixtures";

const CATALOG = { cards: CARDS, getCard, getPlayer };
type Scene = keyof typeof WALKOUT_SCENES;
const SCENES = Object.keys(WALKOUT_SCENES) as Scene[];

const ROLLOUT_LABEL: Record<typeof PACK_WALKOUT_3D_ENABLED, string> = {
  off: "OFF — nadie lo ve en la apertura real",
  admins: "ADMINS — solo cuentas admin en la apertura real",
  all: "ALL — todos los jugadores",
};

export default function AdminWalkoutPreview() {
  const reduced = !!useReducedMotion();
  const [scene, setScene] = useState<Scene | null>(null);
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState<Scene | null>(null);
  const queue = useMemo(() => scene ? packWalkoutQueue(buildRevealPlan(toOpenedInstances(f81Results(scene)), null, CATALOG).order) : [], [scene]);
  const item = scene ? queue[index] : undefined;
  const close = (done: boolean) => { setFinished(done ? scene : null); setScene(null); setIndex(0); };
  const start = (s: Scene) => { setFinished(null); setIndex(0); setScene(s); };

  return (
    <div data-testid="admin-walkout" data-rollout={PACK_WALKOUT_3D_ENABLED}>
      <PageHeader eyebrow="Walkout" title="Vista previa del walkout" description="La pieza real de la apertura con cartas reales del catálogo. No abre sobres, no da cartas, no toca créditos ni inventario." />
      <Panel title="Estado del despliegue" dense>
        <p className="text-sm text-white/80" data-testid="admin-walkout-rollout">PACK_WALKOUT_3D_ENABLED = <b>{ROLLOUT_LABEL[PACK_WALKOUT_3D_ENABLED]}</b></p>
        <p className="mt-1 text-xs text-white/50">Cambiarlo exige una release nueva. Apagarlo de inmediato: reactivar la release anterior (bin/deploy.sh --activate).</p>
        {reduced && <p className="mt-2 text-xs text-drl-gold">Este navegador pide movimiento reducido: verás la versión 2D corta (la misma que verían esos jugadores).</p>}
      </Panel>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SCENES.map((s) => {
          const n = packWalkoutQueue(buildRevealPlan(toOpenedInstances(f81Results(s)), null, CATALOG).order).length;
          return (
            <button key={s} type="button" onClick={() => start(s)} disabled={n === 0} data-testid={`admin-walkout-scene-${s}`}
              className="nx-focus rounded-panel border border-white/[0.08] bg-surface-raised/80 p-4 text-left transition hover:border-drl-cyan/40 disabled:opacity-50">
              <p className="font-display text-sm font-bold uppercase text-white">{s}</p>
              <p className="mt-1 text-xs text-white/60">{WALKOUT_SCENES[s].note}</p>
              <p className="mt-2 text-xs text-drl-cyan">{n === 0 ? "sin especiales (apertura de siempre)" : `${n} walkout${n === 1 ? "" : "s"}`}</p>
            </button>
          );
        })}
      </div>
      {finished && <p className="mt-4 text-sm text-white/70" data-testid="admin-walkout-finished">Fin de la escena {finished}: se presentaron sus {packWalkoutQueue(buildRevealPlan(toOpenedInstances(f81Results(finished)), null, CATALOG).order).length} especiales.</p>}

      {item && (
        <div className="fixed inset-0 z-modal bg-[#030409]" data-testid="admin-walkout-stage" data-scene={scene ?? ""}>
          <PackWalkout key={`${scene}:${item.uid}`} item={item} index={index} total={queue.length} reduced={reduced}
            onDone={() => { if (index + 1 < queue.length) setIndex(index + 1); else close(true); }} />
          <button type="button" onClick={() => close(false)} data-testid="admin-walkout-close"
            className="nx-focus absolute left-3 top-3 z-modal rounded-control border border-white/20 bg-black/60 px-3 py-1.5 text-xs font-semibold uppercase text-white">
            Cerrar vista previa
          </button>
        </div>
      )}
    </div>
  );
}
