/**
 * CLOUD STORAGE · REPLAY STORAGE/ARCHIVE/CDN/SEARCH/SHARE · ASSET STORAGE (Online Fase 7/7).
 *
 * Capa de persistencia con ADAPTER (BlobAdapter: memoria por defecto, Supabase/CDN PREPARADOS). El
 * Replay Store REUTILIZA el Replay Engine (encode/decode/checksum/shareCode/verify) — no duplica el
 * formato — y añade índice de búsqueda + archivo frío + resolución de URL de CDN. Determinista
 * (ids/checksum estables, sin wall-clock salvo el `now` inyectado).
 */
import {
  encodeReplay, decodeReplay, checksumReplay, shareCode, verifyReplay, type Replay,
} from "@/replay";
import { idFrom } from "./types";

// ───────────────────────────── Blob Adapter (DI) ─────────────────────────────

export interface BlobAdapter {
  readonly name: string;
  put(key: string, blob: string): void;
  get(key: string): string | null;
  del(key: string): void;
  list(prefix: string): string[];
}

/** Adapter en memoria (tests / servidor-en-proceso). Determinista. */
export class MemoryBlobAdapter implements BlobAdapter {
  readonly name = "memory";
  private m = new Map<string, string>();
  put(k: string, b: string): void { this.m.set(k, b); }
  get(k: string): string | null { return this.m.get(k) ?? null; }
  del(k: string): void { this.m.delete(k); }
  list(prefix: string): string[] { return [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort(); }
}

/** CDN Layer: resuelve URLs públicas deterministas para un blob (PREPARADO para un CDN real). */
export class CdnLayer {
  constructor(private base = "https://cdn.drlchampions.gg") {}
  url(bucket: string, key: string): string { return `${this.base}/${bucket}/${key}`; }
  /** Clave de caché estable (para invalidación por versión). */
  cacheKey(bucket: string, key: string, version: number): string { return idFrom(bucket, key, version); }
}

// ───────────────────────────── Replay Store + índice de búsqueda ─────────────────────────────

export interface ReplayIndexEntry {
  matchId: string; mode: string; region: string; players: string[];
  winner: "home" | "away" | null; rounds: number; checksum: number; share: string;
  tournamentId: string | null; storedAt: number; archived: boolean;
}

export interface ReplayQuery { player?: string; mode?: string; region?: string; tournamentId?: string; winnerSide?: "home" | "away" }

export class ReplayStore {
  private index = new Map<string, ReplayIndexEntry>();
  constructor(private blobs: BlobAdapter = new MemoryBlobAdapter(), private cdn = new CdnLayer()) {}

  /** Guarda un replay (íntegro): valida checksum → encode → blob → índice. Devuelve la entrada. */
  put(rep: Replay, now: number, tournamentId: string | null = null): ReplayIndexEntry | null {
    if (!verifyReplay(rep).ok) return null; // no se archiva un replay manipulado
    const key = `replay/${rep.meta.matchId}`;
    this.blobs.put(key, encodeReplay(rep));
    const entry: ReplayIndexEntry = {
      matchId: rep.meta.matchId, mode: rep.meta.mode, region: rep.meta.region,
      players: rep.meta.players.map((p) => p.id), winner: rep.meta.winner,
      rounds: rep.meta.rounds, checksum: checksumReplay(rep.config, rep.log), share: shareCode(rep),
      tournamentId, storedAt: now, archived: false,
    };
    this.index.set(rep.meta.matchId, entry);
    return entry;
  }

  /** Recupera y decodifica un replay (verifica integridad al leer). */
  get(matchId: string): Replay | null {
    const blob = this.blobs.get(`replay/${matchId}`);
    return blob ? decodeReplay(blob) : null;
  }

  /** URL pública del replay (CDN). */
  url(matchId: string): string { return this.cdn.url("replays", `${matchId}.drlrep`); }

  /** Búsqueda por índice (por jugador/modo/región/torneo/lado ganador). O(n) sobre el índice. */
  search(q: ReplayQuery): ReplayIndexEntry[] {
    return [...this.index.values()].filter((e) =>
      (!q.player || e.players.includes(q.player)) &&
      (!q.mode || e.mode === q.mode) &&
      (!q.region || e.region === q.region) &&
      (!q.tournamentId || e.tournamentId === q.tournamentId) &&
      (!q.winnerSide || e.winner === q.winnerSide),
    ).sort((a, b) => b.storedAt - a.storedAt);
  }

  /** Resuelve un replay por su share code. */
  byShare(code: string): ReplayIndexEntry | null {
    return [...this.index.values()].find((e) => e.share === code) ?? null;
  }

  /** Archiva (mueve a almacenamiento frío) los replays más antiguos que `olderThan`. */
  archive(olderThan: number): number {
    let n = 0;
    for (const e of this.index.values()) {
      if (!e.archived && e.storedAt < olderThan) {
        const blob = this.blobs.get(`replay/${e.matchId}`);
        if (blob) { this.blobs.put(`archive/${e.matchId}`, blob); this.blobs.del(`replay/${e.matchId}`); }
        e.archived = true; n++;
      }
    }
    return n;
  }

  entry(matchId: string): ReplayIndexEntry | null { return this.index.get(matchId) ?? null; }
  count(): number { return this.index.size; }
}

// ───────────────────────────── Asset Storage ─────────────────────────────

/** Almacén de assets (branding/artwork/VOD posters) con resolución de URL de CDN. */
export class AssetStore {
  constructor(private blobs: BlobAdapter = new MemoryBlobAdapter(), private cdn = new CdnLayer()) {}
  put(id: string, data: string): string { const key = `asset/${id}`; this.blobs.put(key, data); return key; }
  get(id: string): string | null { return this.blobs.get(`asset/${id}`); }
  url(id: string, version = 1): string { return `${this.cdn.url("assets", id)}?v=${version}`; }
}
