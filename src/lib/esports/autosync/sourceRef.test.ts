/**
 * AUTO-SYNC · FUENTE (Fase 24.6) — referencias permitidas, timeout, reintentos y clasificación.
 * Pruebas 24, 25, 26, 40, 41 del brief. Sin red: `fetch` es de mentira.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AUTO_SYNC_CONFIG } from "./config";
import { classifySourceError, createTimedFetcher, resolveSourceRef, sourceRefFromInput, SourceError } from "./sourceRef";

const retry = { maxAttempts: 3, baseDelayMs: 1 };
const noSleep = async () => {};
type FetchImpl = typeof fetch;

const okResponse = (text: string, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, text: async () => text }) as unknown as Response;

test("40 · el scheduler no acepta URLs arbitrarias: solo eventos de la BD con referencia a vlr.gg", () => {
  assert.deepEqual(resolveSourceRef({ id: "vlr-2766", source: "vlr" }), { eventId: "vlr-2766", vlrEventId: "2766", url: "https://www.vlr.gg/event/2766" });
  assert.deepEqual(resolveSourceRef({ id: "2766", source: "vlr" })?.vlrEventId, "2766");
  assert.equal(resolveSourceRef({ id: "champions-2026", source: "vlr", vlr_url: "https://www.vlr.gg/event/2766/valorant-champions-2026" })?.vlrEventId, "2766");
  // Una URL que no es de vlr.gg en `vlr_url` no vale como referencia, y la URL final SIEMPRE se construye aquí.
  assert.equal(resolveSourceRef({ id: "x", source: "vlr", vlr_url: "https://evil.example.com/event/2766/x" }), null);
  const ref = resolveSourceRef({ id: "y", source: "vlr", vlr_url: "https://www.vlr.gg/event/2766/slug?x=1" })!;
  assert.equal(ref.url, "https://www.vlr.gg/event/2766");
});

test("41 · fuente no soportada (source distinto de vlr, id sin referencia) → rechazada", () => {
  assert.equal(resolveSourceRef({ id: "demo-masters-madrid-2026", source: "mock" }), null);
  assert.equal(resolveSourceRef({ id: "demo-masters-madrid-2026", source: "vlr" }), null);
  assert.equal(sourceRefFromInput("e", "https://cualquier-sitio.com/event/1"), null);
  assert.equal(sourceRefFromInput("e", "https://www.vlr.gg/event/2766/champions")?.vlrEventId, "2766");
  assert.equal(sourceRefFromInput("e", "2766")?.url, "https://www.vlr.gg/event/2766");
});

test("fetcher · rechaza cualquier host fuera de la allowlist sin llamar a la red", async () => {
  let calls = 0;
  const fetcher = createTimedFetcher({ timeoutMs: 1000, retry, sleep: noSleep, fetchImpl: (async () => { calls++; return okResponse("x"); }) as FetchImpl });
  await assert.rejects(fetcher("https://evil.example.com/event/1"), (e: unknown) => e instanceof SourceError && e.kind === "permanent" && /host no permitido/.test(e.message));
  assert.equal(calls, 0);
  assert.equal(await fetcher("https://www.vlr.gg/event/1"), "x");
});

test("24 · timeout: la petición se aborta y el error es TRANSITORIO", async () => {
  const fetchImpl = (async (_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  })) as FetchImpl;
  const fetcher = createTimedFetcher({ timeoutMs: 5, retry: { maxAttempts: 1, baseDelayMs: 1 }, sleep: noSleep, fetchImpl });
  await assert.rejects(fetcher("https://www.vlr.gg/event/1"), (e: unknown) => e instanceof SourceError && e.kind === "transient" && /timeout/.test(e.message));
});

test("25 · reintento solo ante errores transitorios (5xx, 429, red): a la tercera va la vencida", async () => {
  let n = 0;
  const attempts: number[] = [];
  const fetchImpl = (async () => { n++; if (n < 3) return okResponse("", n === 1 ? 503 : 429); return okResponse("<html>ok</html>"); }) as FetchImpl;
  const fetcher = createTimedFetcher({ timeoutMs: 1000, retry, sleep: noSleep, fetchImpl, onAttempt: (i) => attempts.push(i.attempt) });
  assert.equal(await fetcher("https://www.vlr.gg/event/1"), "<html>ok</html>");
  assert.equal(n, 3);
  assert.deepEqual(attempts.filter((_, i) => i % 1 === 0).length >= 3, true);
  // Agotados los intentos, el último error transitorio se propaga.
  let m = 0;
  const always503 = createTimedFetcher({ timeoutMs: 1000, retry, sleep: noSleep, fetchImpl: (async () => { m++; return okResponse("", 503); }) as FetchImpl });
  await assert.rejects(always503("https://www.vlr.gg/event/1"), (e: unknown) => e instanceof SourceError && e.kind === "transient" && e.status === 503);
  assert.equal(m, 3);
});

test("26 · NO se reintenta ante 4xx ni ante errores de parse/validación", async () => {
  let n = 0;
  const fetcher = createTimedFetcher({ timeoutMs: 1000, retry, sleep: noSleep, fetchImpl: (async () => { n++; return okResponse("", 404); }) as FetchImpl });
  await assert.rejects(fetcher("https://www.vlr.gg/event/1"), (e: unknown) => e instanceof SourceError && e.kind === "permanent" && e.status === 404);
  assert.equal(n, 1);
  assert.equal(classifySourceError(new Error("la página de VLR no parece un torneo (sin título de evento): x")).kind, "parse");
  assert.equal(classifySourceError(new Error("URL de VLR no válida (se espera .../event/{id}/... ): x")).kind, "parse");
  assert.equal(classifySourceError(new Error("VLR HTTP 500 — x")).kind, "transient");
  assert.equal(classifySourceError(new Error("fetch failed")).kind, "transient");
  assert.equal(classifySourceError(new Error("VLR HTTP 403 — x")).kind, "permanent");
});

test("defaults · el timeout por petición existe y es finito", () => {
  assert.ok(DEFAULT_AUTO_SYNC_CONFIG.timeoutMs > 0 && DEFAULT_AUTO_SYNC_CONFIG.timeoutMs <= 60_000);
  assert.ok(DEFAULT_AUTO_SYNC_CONFIG.maxConcurrency >= 1 && DEFAULT_AUTO_SYNC_CONFIG.maxConcurrency <= 4);
});
