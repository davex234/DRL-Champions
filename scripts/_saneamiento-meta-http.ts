/**
 * INSTRUMENTO (no CI) — saneamiento post F47.
 * Prueba `GET /api/game/meta` por HTTP contra la app real con un Bearer de un usuario existente.
 * El token se obtiene con un enlace mágico de un solo uso (admin API): NO cambia la contraseña
 * ni ningún dato de la cuenta. Imprime solo forma y conteos, nunca el token ni datos personales.
 */
import { existsSync, readFileSync } from "node:fs";
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

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function main() {
  const userId = process.argv[2];
  const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
  const { data: u, error: ue } = await admin.auth.admin.getUserById(userId);
  if (ue || !u.user?.email) throw new Error(`sin email para ${userId}: ${ue?.message}`);

  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (le || !link.properties?.hashed_token) throw new Error(`generateLink: ${le?.message}`);

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s, error: se } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (se || !s.session) throw new Error(`verifyOtp: ${se?.message}`);

  const res = await fetch(`${BASE}/api/game/meta`, { headers: { authorization: `Bearer ${s.session.access_token}` } });
  const body = await res.json() as Record<string, unknown>;
  console.log("HTTP", res.status, res.statusText, "| cache-control:", res.headers.get("cache-control"));
  if (res.status !== 200) { console.log("cuerpo:", JSON.stringify(body)); process.exit(1); }

  const d = body as { serverNow: number; account: Record<string, unknown>; level: { level: number }; objectives: unknown[]; loop: { steps?: unknown[] }; ledger: unknown[]; rewards: unknown[]; decks: unknown; duels: unknown; ftue: unknown; season: { id: string; level: number }; pass: { missions: { metric: string; progress: number }[] } };
  console.log("claves:", Object.keys(d).join(", "));
  console.log("serverNow coherente:", Math.abs(Date.now() - d.serverNow) < 120_000);
  console.log("nivel de cuenta:", d.level.level, "| temporada:", d.season.id, "nivel", d.season.level);
  console.log("objetivos:", d.objectives.length, "| pasos del bucle:", d.loop.steps?.length ?? 0, "| libro mayor:", d.ledger.length, "| recompensas:", d.rewards.length);
  console.log("mazos:", JSON.stringify(d.decks), "| duelos:", JSON.stringify(d.duels));
  const picks = d.pass.missions.filter((m) => m.metric === "picks_made");
  console.log("misiones picks_made en el pase:", picks.length, picks.map((m) => m.progress).join(","));
}
main().catch((e) => { console.error("FALLÓ:", (e as Error).message); process.exit(1); });
