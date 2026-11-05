/** Tipos de filas de las tablas del Asset Manager (0007_assets.sql). */

export interface AssetRow {
  id: string;
  group_id: string;
  version: number;
  is_current: boolean;
  name: string;
  kind: string;
  subject_type: string;
  subject_id: string | null;
  source: string;
  quality: number;
  width: number | null;
  height: number | null;
  format: string | null;
  bytes: number | null;
  checksum: string | null;
  priority: number;
  status: string;
  license: string | null;
  bucket: string;
  storage_path: string | null;
  url: string | null;
  captured_at: string | null;
  tags: string[];
  meta: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetBestRow {
  kind: string;
  subject_type: string;
  subject_id: string;
  asset_id: string;
  bucket: string | null;
  storage_path: string | null;
  url: string | null;
  width: number | null;
  height: number | null;
  quality: number | null;
  priority: number | null;
  updated_at: string;
}

export interface AssetDuplicateRow {
  checksum: string;
  copies: number;
  asset_ids: string[];
  kind: string;
}
