/**
 * Tipos del Release Dashboard (Fase 4/7). SON SOLO una vista: describen lo que el reader agrega
 * a partir de los JSON YA generados por las fases 1-3 (pipeline-state.json · publish.json ·
 * history.json · release.json · release-report.json · manifests). No se inventa ningún dato.
 */

export type HealthLevel = "green" | "yellow" | "red" | "off";
export type ReleaseStatus = "published" | "ready" | "failed" | "building" | "queued" | "unknown";

export interface FileHash {
  name: string;
  size: number;
  sha256: string | null;
  url?: string | null;
  mtime?: string | null;
}

export interface PipelineTransition {
  state: string;
  at: number;
  elapsedMs: number;
}

export interface PipelineState {
  state: string;
  label: string;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number;
  transitions: PipelineTransition[];
}

export interface ReleaseEntry {
  channel: string;
  full: string;
  version: string;
  build: number | null;
  date: string | null;
  isCurrent: boolean;
  kind: "release" | "rollback";
  rolledBackFrom: string | null;
  status: ReleaseStatus;
  provider: string | null;
  destination: string | null;
  signed: boolean;
  totalBytes: number;
  uploadMs: number | null;
  buildMs: number | null;
  commit: string | null;
  branch: string | null;
  author: string | null;
  notes: string | null;
  fileCount: number;
  rollbackAvailable: boolean;
  rollbackTargets: string[];
  // Detalle (solo releases vigentes, leído de los JSON ricos):
  files: FileHash[];
  manifests: { hasLatest: boolean; hasMeta: boolean; hasFiles: boolean };
  pipeline: PipelineState | null;
  reportMd: string | null;
  verify: { ok: boolean; checked: number; mismatches: string[]; missing: string[] } | null;
  baseUrl: string | null;
}

export interface ProviderStatus {
  name: string;
  configured: boolean;
  healthy: boolean;
  detail: string;
  latencyMs: number | null;
  sampleUrl: string | null;
  lastPublish: { full: string; date: string | null } | null;
  errors: string[];
  active: boolean;
}

export interface HealthItem {
  key: string;
  label: string;
  level: HealthLevel;
  detail: string;
}

export interface DashboardStats {
  releases: number;
  builds: number;
  published: number;
  failed: number;
  rollbackReady: number;
  errors: number;
  avgBuildMs: number | null;
  avgUploadMs: number | null;
  avgBytes: number | null;
  channels: number;
  activeProvider: string;
}

export interface RollbackEvent {
  type: "rollback";
  at: string | null;
  from: string | null;
  to: string;
  channel: string;
  provider: string | null;
  user: string | null;
  reason: string | null;
  durationMs: number | null;
  result: "ok" | "failed";
  code: string | null;
  files: number;
  signed: boolean;
  error: string | null;
  reverted: boolean;
  verify: { ok: boolean; checked: number; mismatches: string[]; missing: string[] } | null;
}

export interface TimelineEvent {
  type: "release" | "rollback";
  at: string | null;
  channel: string;
  full: string;
  detail: string;
  result: string;
}

// ── Distribución global (Fase 6) ──
export interface DistTarget {
  id: string; region: string; provider: string; required: boolean;
  ok: boolean; status: string; pending: boolean;
  attempts: number; retries: number; ms: number; uploadMs: number | null; bytes: number;
  destination: string | null; error: string | null;
}
export interface DistRegion {
  region: string; status: "ok" | "partial" | "failed";
  providers: string[]; ok: number; total: number; pending: string[];
  uploadMs: number; bytes: number; primary: string | null; mirrors: string[];
}
export interface DistHealth {
  id: string; name: string; region: string; availability: boolean;
  latencyMs: number; score: number; status: string; speedBps: number; errors: number;
}
export interface CdnRegion {
  region: string; primary: string | null; endpoint: string | null;
  mirrors: string[]; fallbackOrder: string[]; healthy: number; total: number;
}
export interface DistributionData {
  channel: string; full: string; date: string | null;
  ready: boolean; status: string;
  requiredRegions: string[]; missingRequired: string[];
  targets: DistTarget[];
  regions: DistRegion[];
  cdn: { primaryRegion: string | null; regions: CdnRegion[] };
  analytics: { totalMs: number; targets: number; succeeded: number; failed: number; retries: number; bytes: number; speedBps: number; mirrorsUsed: number };
  health: DistHealth[];
}

export interface DashboardData {
  generatedAt: string;
  root: string;
  channels: string[];
  activeProvider: string;
  releases: ReleaseEntry[];
  pipeline: PipelineState | null;
  providers: ProviderStatus[];
  health: HealthItem[];
  stats: DashboardStats;
  rollbacks: RollbackEvent[];
  timeline: TimelineEvent[];
  distribution: DistributionData[];
  errors: string[];
  hasData: boolean;
}
