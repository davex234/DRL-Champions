/**
 * ESPORTS AUTO-SYNC (Fase 24.6) — API pública.
 *
 *   config     → configuración centralizada y kill switch (OFF por defecto)
 *   policy     → clasificación de eventos, frecuencias, backoff, jitter (puro)
 *   validate   → validación de payload, transiciones de estado, huella de resultados (puro)
 *   lock       → single-flight con lease en `sync_state`
 *   health     → salud del pipeline persistida en `sync_state`
 *   sourceRef  → referencias permitidas a la fuente, timeout, reintentos, host allowlist
 *   runner     → `runEsportsSync()`: el core único para manual y scheduled
 *   report     → informe legible (dry run / CLI)
 */
export * from "./config";
export * from "./policy";
export * from "./validate";
export * from "./lock";
export * from "./health";
export * from "./sourceRef";
export * from "./log";
export * from "./runner";
export * from "./report";
