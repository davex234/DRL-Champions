/**
 * IMPORT PROVIDER — interfaz ÚNICA de fuente de datos (Fase 2).
 *
 * Unifica las tres interfaces existentes (`DataSource` de engine, `LiveDataProvider` de live,
 * `CompetitiveSource` de esports-sync): forma rica (torneo completo) + envoltura de failover
 * (priority/health/discover). En la FASE 1 NO se implementa ningún provider concreto ni scraping:
 * solo existe el contrato, para que el ImportEngine consuma `RawSnapshot` desde cualquier fuente.
 *
 * REGLA: el scraping/HTTP vive DETRÁS de esta interfaz (Fase 2). El pipeline interno nunca hace red.
 */
import type { RawSnapshot } from "../types";

export type ProviderId = "vlr" | "liquipedia" | "riot" | "tracker" | "ribgg" | "runitback" | "mock";

export interface ProviderHealth {
  ok: boolean;
  latencyMs?: number;
  detail?: string;
}

/** Contrato que TODO proveedor implementará en Fase 2. Vacío a propósito en Fase 1. */
export interface ImportProvider {
  readonly id: ProviderId;
  /** Prioridad para failover (mayor = preferente). */
  priority(): number;
  /** ¿Soporta este juego/circuito? */
  supports(game: string): boolean;
  /** Estado del proveedor (para failover). */
  health(): Promise<ProviderHealth>;
  /** Ids de torneos descubribles. */
  discover(): Promise<string[]>;
  /** Snapshot CRUDO de un torneo (lo que consume el ImportEngine). */
  fetchTournament(tournamentId: string): Promise<RawSnapshot>;
}
