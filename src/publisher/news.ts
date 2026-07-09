/**
 * NEWS PUBLISHER (Fase 7) — publica las noticias ESTRUCTURADAS de la build en el runtime
 * (dedupe por id determinista; nunca renderiza; el feed de la app las consumirá tal cual).
 */
import type { NewsItem } from "@/intel/news";
import { internal } from "./runtime";

export function applyNewsRuntime(news: NewsItem[]): number {
  const state = internal.state();
  const known = new Set(state.news.map((n) => n.id));
  let published = 0;
  for (const n of news) {
    if (known.has(n.id)) continue;
    state.news.push(n);
    known.add(n.id);
    published++;
  }
  return published;
}
