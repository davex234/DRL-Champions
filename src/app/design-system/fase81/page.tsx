"use client";

/**
 * F81 · ARNÉS QA DE LA APERTURA CINEMÁTICA (`/design-system/fase81?scene=…`). 404 en producción (middleware), salvo
 * `NEXUS_QA_HARNESS=1`. Monta la ceremonia REAL (`PackOpeningExperience`) con un resultado FIJO (`qaOpen`) en vez del
 * servidor: cartas REALES del catálogo, uids fijos por escena (el desempate de la hero es reproducible). No toca
 * economía, servidor ni base de datos; el inventario de sobres de la escena vive solo en el store local del navegador.
 *
 *   scene = normal | high | tie2 | tieall | dup | single | invalid      (movimiento reducido: emulación del navegador)
 *   &reset=1  borra el revelado guardado en la pestaña (la recuperación tras F5 se prueba SIN él)
 *
 * `scene = w-*` son aperturas con cartas especiales reales (nacieron para el walkout, que desde 2026-10-15 ya no forma parte
 * de la apertura) y `r-masters | r-icon | r-gold | r-mixed | r-same` prueban la sala del color de cada rareza.
 */
import { useEffect, useMemo, useState } from "react";
import { useGameStore } from "@/store/useGameStore";
import { PackOpeningExperience } from "@/components/packs/PackOpeningExperience";
import { clearOpenReveal } from "@/lib/game/openRecovery";
import { F81_SCENES as SCENES, f81Results, f81Scene, type F81Scene } from "./fixtures";


export default function Fase81Harness() {
  const [scene, setScene] = useState<F81Scene | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = (q.get("scene") ?? "normal") as F81Scene;
    if (q.get("reset") === "1") {
      clearOpenReveal();
      try { sessionStorage.removeItem("f81-opens"); } catch { /* sin almacenamiento */ }
      // El reinicio se aplica UNA vez: una recarga (F5) de esta pestaña NO debe volver a borrar lo abierto.
      q.delete("reset");
      window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
    }
    const sc = SCENES.includes(s) ? s : "normal";
    const { packId } = f81Scene(sc);
    // Solo el store LOCAL del navegador: sin servidor ni economía.
    useGameStore.setState((st) => ({ unopenedPacks: { ...st.unopenedPacks, [packId]: Math.max(9, st.unopenedPacks[packId] ?? 0) } }));
    setScene(sc);
  }, []);
  // Cuenta las «aperturas» en la pestaña (sobrevive a F5): la QA demuestra que recargar/omitir/doble clic no reabre.
  const qa = useMemo(() => (scene ? () => {
    try { sessionStorage.setItem("f81-opens", String(Number(sessionStorage.getItem("f81-opens") ?? "0") + 1)); } catch { /* sin almacenamiento */ }
    return f81Results(scene);
  } : undefined), [scene]);
  if (!scene || !qa) return <p className="p-6 text-ink-muted" data-testid="f81-loading">Cargando escena…</p>;
  return (
    <div data-testid="f81-harness" data-scene={scene}>
      <PackOpeningExperience key={scene} packId={f81Scene(scene).packId} qaOpen={qa} />
    </div>
  );
}
