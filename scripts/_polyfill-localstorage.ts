/* Polyfill mínimo de localStorage para ejecutar en Node/tsx código que importa
 * stores de Zustand (persist). Debe importarse ANTES que cualquier store. */
type LS = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  clear(): void;
  key(i: number): string | null;
  length: number;
};
const g = globalThis as unknown as { localStorage?: LS };
if (typeof g.localStorage === "undefined") {
  const mem = new Map<string, string>();
  g.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
}
