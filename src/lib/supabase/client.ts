"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let _client: SupabaseClient | null = null;

/** ¿Está configurado Supabase? Si no, el juego funciona en modo local. */
export function isSupabaseConfigured(): boolean {
  return Boolean(URL && ANON);
}

/** Cliente Supabase (singleton). Devuelve null si no está configurado. */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!_client) {
    _client = createClient(URL as string, ANON as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return _client;
}
