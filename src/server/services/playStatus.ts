/**
 * FASE 44 · ESTADO DE JUEGO DEL ARMAZÓN (solo lectura).
 *
 * El botón global JUGAR se convierte en CONTINUAR PARTIDA solo si el SERVIDOR dice que hay una partida abierta.
 * No hay lógica nueva: reutiliza la lectura de partidas abiertas del Daily Loop (`readActiveMatches`, columnas
 * públicas, nunca `state`/`rng`) y la acción de retomar del dominio (`primaryResume`, el mismo orden que el
 * vestíbulo). Cero escrituras, tiempo máximo acotado, y ante cualquier fallo `resume: null` (JUGAR normal).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { primaryResume } from "@/domain/dailyLoop";
import { readActiveMatches, SUBSYSTEM_TIMEOUT_MS } from "./dailyLoop";

export interface PlayStatus {
  serverNow: number;
  /** `null` = no hay partida que retomar (o no se pudo saber: nunca se inventa una). */
  resume: { id: string; label: string; href: string; eyebrow: string; title: string } | null;
  /** La lectura falló o tardó demasiado: el cliente no debe afirmar nada. */
  unknown: boolean;
}

export async function getPlayStatus(sb: SupabaseClient, userId: string, now = Date.now(), ms = SUBSYSTEM_TIMEOUT_MS): Promise<PlayStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = await Promise.race([
      readActiveMatches(sb, userId),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
    ]);
    if (!read) return { serverNow: now, resume: null, unknown: true };
    const a = primaryResume(read.matches);
    return {
      serverNow: now,
      resume: a ? { id: a.id, label: a.cta, href: a.href, eyebrow: a.eyebrow, title: a.title } : null,
      unknown: false,
    };
  } catch (e) {
    console.warn("[play-status]", e instanceof Error ? e.message : "unavailable");
    return { serverNow: now, resume: null, unknown: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
