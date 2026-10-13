/**
 * FASE 35.2 · CUENTA QA CONTROLADA (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase35-2-qa-account.ts <credsFile>
 *
 * Crea UNA cuenta QA claramente identificada (`qa-campaign-fase352-…@example.invalid`, dominio reservado que
 * no pertenece a nadie) con la API de administración de Supabase, igual que los verificadores del proyecto.
 * La contraseña es aleatoria y SOLO se escribe en `credsFile` (fuera del repo, permisos restringidos): nunca
 * se imprime. Si el fichero ya existe y la cuenta sigue viva, se reutiliza.
 *
 * El alta dispara `handle_new_user` (perfil, 3 sobres inicial + 1 estándar, 6.000 créditos con asiento en el
 * libro mayor): el estado de partida sale del mecanismo real, no de inserciones a mano.
 */
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const f of [".env.local"]) {
  const p = join(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const credsFile = process.argv[2];
if (!credsFile) { console.error("uso: _fase35-2-qa-account.ts <credsFile>"); process.exit(1); }
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function main() {
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

  if (existsSync(credsFile)) {
    const c = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; userId: string };
    const { data } = await admin.auth.admin.getUserById(c.userId);
    if (data.user) {
      const s = await anon.auth.signInWithPassword({ email: c.email, password: c.password });
      console.log(`reuse user=${c.userId.slice(0, 8)} signin=${s.error ? "FAIL " + s.error.message : "OK"}`);
      return;
    }
  }

  const tag = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const email = `qa-campaign-fase352-${tag}@example.invalid`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `qa_campaign_352` },
  });
  if (error || !data.user) throw new Error(error?.message ?? "no se pudo crear la cuenta QA");
  writeFileSync(credsFile, JSON.stringify({ email, password, userId: data.user.id }), { mode: 0o600 });
  try { chmodSync(credsFile, 0o600); } catch { /* Windows */ }

  const s = await anon.auth.signInWithPassword({ email, password });
  console.log(`created user=${data.user.id.slice(0, 8)} signin=${s.error ? "FAIL " + s.error.message : "OK"} admin_client_in_browser=NO`);
}

main().catch((e) => { console.error("ERROR", e instanceof Error ? e.message : e); process.exit(1); });
