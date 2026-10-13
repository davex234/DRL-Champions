/**
 * NEXUS LIVE OPERATIONS — EL SNAPSHOT (Fase 14, bloque 6, SOLO SERVIDOR).
 *
 * Reúne en **una sola operación** todo lo que la sala de control necesita. La alternativa
 * era que la pantalla hiciera diez peticiones y las coordinara en React: diez viajes, diez
 * estados de carga y diez formas de fallar a medias.
 *
 * ────────────────────────── AQUÍ NO SE CALCULA NADA ──────────────────────────
 *
 * Cada campo sale de `services/analytics.ts`, que a su vez llama a las funciones SQL de la
 * migración 0030. Este módulo **orquesta y etiqueta**; no suma, no promedia y no deriva.
 * Si un número no cuadra, hay un solo sitio donde mirar.
 *
 * ────────────────────────── FALLO PARCIAL, A PROPÓSITO ──────────────────────────
 *
 * Las nueve consultas van en paralelo y **cada una puede fallar por su cuenta**. Si el
 * mercado revienta, el mercado aparece en error y las otras ocho siguen ahí.
 *
 * Es la diferencia entre una sala de control y un informe: cuando algo va mal —que es
 * justo cuando se abre esta pantalla— lo último que debe pasar es que la consola se caiga
 * porque una métrica secundaria no responde.
 *
 * ────────────────────────── COBERTURA, NO CEROS ──────────────────────────
 *
 * Varias métricas dependen de `telemetry_events`, que existe desde la Fase 14. Un cero de
 * esas es ambiguo: puede ser «nadie lo hizo» o «no se estaba midiendo». Por eso el
 * snapshot lleva `coverage`, con la fecha del primer evento registrado, y cada métrica
 * declara de qué origen viene. La pantalla usa eso para no enseñar un 0 que miente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ftueFunnel, duelFunnel, pickemFunnel, marketFunnel, zoneUsage, sessionStats,
  activeUsers, errorGroups, flowStats, lastDays,
  type FtueStep, type DuelFunnel, type PickemFunnel, type MarketFunnel,
  type ZoneUsage, type SessionStats, type ActiveUsersDay, type ErrorGroup, type FlowStats,
} from "./analytics";
import { readHealth, type EsportsSyncHealth } from "@/lib/esports/autosync/health";

/** Las tres ventanas del MVP. Cerradas a propósito: sin selector de fechas arbitrario. */
export const WINDOWS = ["24h", "7d", "30d"] as const;
export type WindowKey = (typeof WINDOWS)[number];
export const isWindowKey = (v: unknown): v is WindowKey =>
  typeof v === "string" && (WINDOWS as readonly string[]).includes(v);

const DAYS: Record<WindowKey, number> = { "24h": 1, "7d": 7, "30d": 30 };

/**
 * Un bloque del snapshot: o trae datos, o dice por qué no.
 *
 * El tipo obliga a la pantalla a contemplar el fallo. Con un `T | null` se podría pintar
 * un cero sin enterarse; con esto hay que decidir qué enseñar cuando `ok` es falso.
 */
export type Block<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const ok = <T>(data: T): Block<T> => ({ ok: true, data });
const ko = (error: string): Block<never> => ({ ok: false, error });

/** Envuelve una consulta para que su fallo no contamine a las demás. */
async function block<T>(p: Promise<T | null>, nombre: string): Promise<Block<T>> {
  try {
    const r = await p;
    return r === null ? ko(`No se pudo calcular ${nombre}`) : ok(r);
  } catch {
    return ko(`No se pudo calcular ${nombre}`);
  }
}

/**
 * Hasta dónde llega la instrumentación.
 *
 * `since` es el primer evento de telemetría que existe. Todo lo que dependa de la
 * telemetría y quede antes de esa fecha **no es cero: es desconocido**.
 */
export interface Coverage {
  /** ISO del primer evento, o `null` si todavía no hay ninguno. */
  telemetrySince: string | null;
  /** ¿Hay algún evento? Si no, media consola está en blanco por razones legítimas. */
  hasTelemetry: boolean;
}

export interface OperationsSnapshot {
  generatedAt: string;
  window: WindowKey;
  windowFrom: string;
  windowTo: string;
  coverage: Coverage;
  /** Cuánto tardó en construirse, en milisegundos. Se enseña: es parte de la salud. */
  tookMs: number;

  activity: Block<ActiveUsersDay[]>;
  sessions: Block<SessionStats>;
  zones: Block<ZoneUsage[]>;
  ftue: Block<FtueStep[]>;
  duel: Block<DuelFunnel>;
  pickems: Block<PickemFunnel>;
  market: Block<MarketFunnel>;
  errors: Block<ErrorGroup[]>;
  flows: Block<FlowStats[]>;
  /** Fase 24.6 · salud del pipeline de datos esports (último éxito, duración, fallos). */
  esportsSync: Block<EsportsSyncHealth>;
}

/**
 * Construye el snapshot.
 *
 * La ventana llega como una de tres claves, no como un par de fechas: el cliente **no
 * elige el rango**, elige entre tres opciones que el servidor traduce. Un rango arbitrario
 * desde el navegador es una consulta arbitraria contra la base de datos.
 */
export async function getOperationsSnapshot(
  sb: SupabaseClient, windowKey: WindowKey = "24h",
): Promise<OperationsSnapshot> {
  const t0 = Date.now();
  const w = lastDays(DAYS[windowKey]);

  /*
   * Los errores SIEMPRE se miran a 24 horas, sea cual sea la ventana elegida.
   *
   * La pregunta de la sección de errores es «¿algo está roto AHORA?», y mezclarla con una
   * ventana de 30 días la haría inútil: un fallo de hace tres semanas ya resuelto
   * enterraría el de hace diez minutos. La pantalla lo dice al lado del título.
   */
  const wErr = lastDays(1);

  const [activity, sessions, zones, ftue, duel, pickems, market, errors, flows, coverage, esportsSync] =
    await Promise.all([
      block(activeUsers(sb, w), "actividad"),
      block(sessionStats(sb, w), "sesiones"),
      block(zoneUsage(sb, w), "zonas"),
      block(ftueFunnel(sb, w), "el embudo de primera experiencia"),
      block(duelFunnel(sb, w), "el embudo de duelo"),
      block(pickemFunnel(sb, w), "el embudo de Pick'ems"),
      block(marketFunnel(sb, w), "el embudo de mercado"),
      block(errorGroups(sb, wErr), "los errores"),
      block(flowStats(sb, w), "los flujos"),
      telemetryCoverage(sb),
      // `readHealth` nunca lanza: sin fila devuelve el estado vacío (que la pantalla enseña como «nunca»).
      block(readHealth(sb), "el sync esports"),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    window: windowKey,
    windowFrom: w.from.toISOString(),
    windowTo: w.to.toISOString(),
    coverage,
    tookMs: Date.now() - t0,
    activity, sessions, zones, ftue, duel, pickems, market, errors, flows, esportsSync,
  };
}

/**
 * Desde cuándo hay telemetría.
 *
 * Una lectura mínima —una fila, por índice— que evita que la consola presente ceros
 * ambiguos. Si falla, se asume que no hay cobertura: es la respuesta conservadora.
 */
async function telemetryCoverage(sb: SupabaseClient): Promise<Coverage> {
  try {
    const { data } = await sb
      .from("telemetry_events")
      .select("occurred_at")
      .order("occurred_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const since = (data as { occurred_at: string } | null)?.occurred_at ?? null;
    return { telemetrySince: since, hasTelemetry: since !== null };
  } catch {
    return { telemetrySince: null, hasTelemetry: false };
  }
}

/**
 * ¿Hay algún error crítico en la ventana de errores?
 *
 * Se calcula aquí y no en la pantalla para que la respuesta sea una sola, y la misma, en
 * cualquier sitio que la pregunte.
 */
export function hasCritical(snap: OperationsSnapshot): boolean {
  return snap.errors.ok && snap.errors.data.some((e) => e.severity === "critical");
}
