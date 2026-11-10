/**
 * WATCH ENGINE — observar · detectar · emitir. NADA MÁS:
 *
 *   TournamentSnapshot → snapshot anterior (registry) → comparación → WatchResult
 *
 * Sin fingerprint nuevo ⇒ cero eventos (cero falsos positivos). Jamás ejecuta el pipeline,
 * jamás llama a Publisher/Orchestrator/Control, jamás descarga: los snapshots LLEGAN de
 * fuera (inyección) y las acciones las decidirá Tournament Control en fases posteriores.
 */
import type { RawSnapshot } from "@/importer";
import { diffSnapshots } from "./diff";
import { makeEvents } from "./events";
import { tournamentFingerprint } from "./fingerprint";
import { createWatcherRegistry, withObservation, withRemoval } from "./registry";
import { tournamentIdOf } from "./snapshot";
import type { ObserveMeta, WatchEvent, WatchResult, WatcherRegistry } from "./types";

export class WatchEngine {
  constructor(public registry: WatcherRegistry = createWatcherRegistry()) {}

  /** Observa UN snapshot: compara con el anterior y emite eventos. Nunca actúa. */
  observe(snapshot: RawSnapshot, meta: ObserveMeta): WatchResult {
    const tournamentId = tournamentIdOf(snapshot);
    const prev = this.registry.tournaments[tournamentId];
    const fingerprint = tournamentFingerprint(snapshot);

    if (prev && !prev.removed && prev.fingerprint === fingerprint) {
      // Mismo contenido real ⇒ misma huella ⇒ CERO eventos (aunque cambie el orden de scraping).
      this.registry = withObservation(this.registry, tournamentId, snapshot, fingerprint, meta.at, []);
      return { tournamentId, changed: false, previousFingerprint: prev.fingerprint, fingerprint, revision: prev.revision, events: [] };
    }

    let events: WatchEvent[];
    if (!prev || prev.removed) {
      events = makeEvents(this.registry.seq, meta, tournamentId, [
        { kind: "tournament-created", subject: tournamentId, detail: snapshot.tournament.name },
        ...(snapshot.tournament.status === "finished" ? [{ kind: "tournament-finished" as const, subject: tournamentId }] : []),
      ]);
    } else {
      const changes = diffSnapshots(prev.snapshot, snapshot);
      events = makeEvents(this.registry.seq, meta, tournamentId, [
        { kind: "tournament-updated", subject: tournamentId, detail: `${changes.length} cambio(s)` },
        ...changes,
      ]);
    }

    this.registry = withObservation(this.registry, tournamentId, snapshot, fingerprint, meta.at, events);
    return {
      tournamentId,
      changed: true,
      previousFingerprint: prev?.fingerprint,
      fingerprint,
      revision: this.registry.tournaments[tournamentId].revision,
      events,
    };
  }

  /** Observa un LOTE completo y detecta torneos desaparecidos (tournament-removed). */
  observeBatch(snapshots: RawSnapshot[], meta: ObserveMeta): WatchResult[] {
    const results = snapshots.map((s) => this.observe(s, meta));
    const seen = new Set(snapshots.map(tournamentIdOf));
    for (const id of this.registry.order) {
      const t = this.registry.tournaments[id];
      if (seen.has(id) || t.removed) continue;
      const events = makeEvents(this.registry.seq, meta, id, [{ kind: "tournament-removed", subject: id }]);
      this.registry = withRemoval(this.registry, id, events);
      results.push({ tournamentId: id, changed: true, previousFingerprint: t.fingerprint, fingerprint: t.fingerprint, revision: t.revision, events });
    }
    return results;
  }
}
