/**
 * PROVIDERS — arquitectura ABIERTA de proveedores (search · download · metadata · license ·
 * priority · health), NO acoplada a ningún sitio. Aquí solo la infraestructura y dos
 * proveedores de referencia (los reales llegarán como datos/config, no como código nuevo):
 *
 *  - LocalDirectoryProvider: recursos ya presentes en un directorio local (cero red).
 *  - StaticManifestProvider: manifiesto declarativo sujeto→URL con fetcher INYECTABLE
 *    (la política de red vive fuera; los verifies inyectan bytes en memoria).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SUBJECT_DIRS } from "./registry";
import type {
  AcquisitionTarget, AssetCandidate, AssetProvider, CandidateMetadata, LicenseKind,
} from "./types";

/** Descargador inyectable (URL → bytes). La red SOLO puede vivir aquí. */
export type AssetFetcher = (url: string) => Promise<Uint8Array>;

/** Orden de consulta: prioridad desc; los no operativos (health=false) se saltan. */
export async function rankProviders(providers: AssetProvider[]): Promise<AssetProvider[]> {
  const alive: AssetProvider[] = [];
  for (const p of providers) if (await p.health()) alive.push(p);
  return alive.sort((a, b) => b.priority() - a.priority() || (a.id < b.id ? -1 : 1));
}

/* ── Proveedor 1: directorio local (assets ya conseguidos a mano) ─────────── */

export class LocalDirectoryProvider implements AssetProvider {
  readonly id = "local-dir";
  constructor(private root: string) {}
  priority(): number { return 100; }
  health(): boolean { return existsSync(this.root); }

  async search(target: AcquisitionTarget): Promise<AssetCandidate[]> {
    const dir = SUBJECT_DIRS[target.category];
    if (!dir) return [];
    const out: AssetCandidate[] = [];
    for (const ext of ["png", "webp", "jpg"] as const) {
      const p = join(this.root, dir, `${target.subjectId}.${ext}`);
      if (existsSync(p)) out.push({ providerId: this.id, sourceRef: p, score: 90, format: ext, license: "official" });
    }
    return out;
  }

  async download(c: AssetCandidate): Promise<Uint8Array> { return readFileSync(c.sourceRef); }
  async metadata(c: AssetCandidate): Promise<CandidateMetadata> { return { sourceUrl: c.sourceRef }; }
  async license(): Promise<LicenseKind> { return "official"; }
}

/* ── Proveedor 2: manifiesto estático (config → URL) ──────────────────────── */

export interface StaticManifestEntry {
  category: AcquisitionTarget["category"];
  subjectId: string;
  url: string;
  license?: LicenseKind;
  score?: number;
}

export class StaticManifestProvider implements AssetProvider {
  constructor(
    readonly id: string,
    private entries: StaticManifestEntry[],
    private fetcher: AssetFetcher,
    private prio = 50,
  ) {}
  priority(): number { return this.prio; }
  health(): boolean { return this.entries.length > 0; }

  async search(target: AcquisitionTarget): Promise<AssetCandidate[]> {
    return this.entries
      .filter((e) => e.category === target.category && e.subjectId === target.subjectId)
      .map((e) => ({ providerId: this.id, sourceRef: e.url, score: e.score ?? 50, license: e.license ?? "unknown" }));
  }

  async download(c: AssetCandidate): Promise<Uint8Array> { return this.fetcher(c.sourceRef); }
  async metadata(c: AssetCandidate): Promise<CandidateMetadata> { return { sourceUrl: c.sourceRef }; }
  async license(c: AssetCandidate): Promise<LicenseKind> { return c.license ?? "unknown"; }
}

/** Selección de candidato: licencia oficial primero, luego score, luego orden estable. */
export function selectCandidate(candidates: AssetCandidate[]): AssetCandidate | null {
  if (!candidates.length) return null;
  const rank = (l?: LicenseKind): number => (l === "official" ? 3 : l === "editorial" ? 2 : l === "cc" ? 1 : 0);
  return [...candidates].sort((a, b) =>
    rank(b.license) - rank(a.license) || b.score - a.score || (a.sourceRef < b.sourceRef ? -1 : 1))[0];
}
