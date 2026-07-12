/**
 * REGISTRY — índice puro e inmutable del repositorio de assets: por id, por ALIAS y por
 * HASH, más listados por categoría. No carga nada (loader.ts) ni resuelve cascadas
 * (resolver.ts): solo indexa y responde en O(1).
 */
import type { ArtworkAsset, ArtworkCategory } from "./types";

export class ArtworkRegistry {
  private byId = new Map<string, ArtworkAsset>();
  private byAlias = new Map<string, string>();
  private byHash = new Map<string, string[]>();
  private byCategory = new Map<ArtworkCategory, ArtworkAsset[]>();
  private bySubject = new Map<string, ArtworkAsset>();

  constructor(assets: ArtworkAsset[] = []) {
    for (const a of assets) this.add(a);
  }

  /** Registra un asset (el último con el mismo id SUSTITUYE, sin duplicar índices). */
  add(a: ArtworkAsset): void {
    const prev = this.byId.get(a.id);
    if (prev) {
      const oldHash = this.byHash.get(prev.hash);
      if (oldHash) this.byHash.set(prev.hash, oldHash.filter((id) => id !== prev.id));
      this.byCategory.set(prev.category, (this.byCategory.get(prev.category) ?? []).filter((x) => x.id !== prev.id));
      if (prev.subjectId && !prev.placeholder) this.bySubject.delete(`${prev.category}:${prev.subjectId}`);
    }
    this.byId.set(a.id, a);
    for (const alias of a.aliases) if (!this.byAlias.has(alias)) this.byAlias.set(alias, a.id);
    const list = this.byHash.get(a.hash) ?? [];
    if (!list.includes(a.id)) list.push(a.id);
    this.byHash.set(a.hash, list);
    const cat = this.byCategory.get(a.category) ?? [];
    cat.push(a);
    this.byCategory.set(a.category, cat);
    if (a.subjectId && !a.placeholder) this.bySubject.set(`${a.category}:${a.subjectId}`, a);
  }

  get(id: string): ArtworkAsset | undefined { return this.byId.get(id); }

  /** Resolución por alias (o por id directo si coincide). */
  byAliasOrId(ref: string): ArtworkAsset | undefined {
    return this.byId.get(ref) ?? (this.byAlias.has(ref) ? this.byId.get(this.byAlias.get(ref)!) : undefined);
  }

  /** Todos los ids que comparten una huella (detección de duplicados). */
  idsByHash(hash: string): string[] { return [...(this.byHash.get(hash) ?? [])]; }

  /** Asset REAL (no placeholder) de un sujeto de una categoría. */
  forSubject(category: ArtworkCategory, subjectId: string): ArtworkAsset | undefined {
    return this.bySubject.get(`${category}:${subjectId}`);
  }

  list(category?: ArtworkCategory): ArtworkAsset[] {
    if (category) return [...(this.byCategory.get(category) ?? [])];
    return [...this.byId.values()];
  }

  get total(): number { return this.byId.size; }

  aliases(): [string, string][] { return [...this.byAlias.entries()]; }
}
