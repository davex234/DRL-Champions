"use client";

/**
 * F60 · SINCRONIZACIÓN DEL CONTENIDO VIVO — agentes y sobres gestionados desde /admin llegan al juego sin recompilar ni
 * reiniciar.
 *
 * Una sola vez al arrancar (y al volver a la pestaña, como mucho una vez por minuto) pide `/api/content/agents` y
 * `/api/content/packs` —públicos, de solo lectura, sin borradores— y los aplica EN SITIO al roster, al arte de agentes y
 * al registro de sobres. Los componentes que los leen se re-pintan por su suscripción. No pinta nada. Si la red falla,
 * el juego sigue con la instantánea del código (nunca se vacía nada).
 */
import { useEffect } from "react";
import { applyAgentCatalog, type AgentCatalogPayload } from "@/domain/tactics/agentCatalog";
import { applyRuntimePacks } from "@/data/packs";
import type { PackDef } from "@/domain/packs/types";

const MIN_INTERVAL = 60_000;
let last = 0;
let running: Promise<void> | null = null;

export async function syncContent(fetcher: typeof fetch = fetch): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      const [a, p] = await Promise.all([
        fetcher("/api/content/agents", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetcher("/api/content/packs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (a) applyAgentCatalog(a as AgentCatalogPayload);
      if (p && Array.isArray((p as { packs?: unknown }).packs)) applyRuntimePacks((p as { packs: PackDef[] }).packs);
      last = Date.now();
    } finally { running = null; }
  })();
  return running;
}

export function ContentSync() {
  useEffect(() => {
    void syncContent();
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - last >= MIN_INTERVAL) void syncContent(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return null;
}
