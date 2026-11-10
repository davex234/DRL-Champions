/**
 * FASE 45 · CUENTA QA TEMPORAL (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase45-qa-account.ts <credsFile>
 *
 * Crea UNA cuenta nueva, inequívocamente identificada como QA de Fase 45, para poder jugar una partida PvE real
 * contra el servidor real. Mismo procedimiento que la cuenta controlada de Fase 35.2, con tres diferencias de
 * etiquetado: el correo lleva `qa-f45`, el `username` lleva `qa_f45` y se deja constancia del instante de creación.
 *
 * ────────────────────────── POR QUÉ ESTO NO ES «FORZAR EL ESTADO» ──────────────────────────
 *
 * El alta es lo ÚNICO que se hace por la vía de administración, y se hace así porque el registro público del
 * producto exige confirmar el correo y no hay buzón al que llegar. A partir de ahí no se inserta absolutamente
 * nada a mano: el alta dispara `handle_new_user`, que es el mecanismo REAL de arranque del producto (perfil,
 * sobres iniciales, créditos con su asiento en el libro mayor). Las cartas, el mazo y la partida salen después
 * de la API pública, como los conseguiría un jugador.
 *
 * ────────────────────────── QUÉ NO TOCA ──────────────────────────
 *
 * Ni un solo usuario existente. No lee, no modifica y no borra credenciales ajenas. La contraseña es aleatoria
 * (18 bytes) y se escribe ÚNICAMENTE en `credsFile`, fuera del repositorio y con permisos restringidos: no se
 * imprime nunca, ni siquiera en caso de error.
 *
 * El correo usa `@example.invalid`: dominio reservado por la RFC 2606, que no pertenece a nadie y al que no se
 * puede enviar correo. Una cuenta QA no puede quedarse con la dirección de una persona real.
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
if (!credsFile) { console.error("uso: _fase45-qa-account.ts <credsFile>"); process.exit(1); }
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function main() {
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

  // Reutilizar antes que crear: dos cuentas QA por descuido son dos cuentas que limpiar.
  if (existsSync(credsFile)) {
    const c = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; userId: string };
    const { data } = await admin.auth.admin.getUserById(c.userId);
    if (data.user) {
      const s = await anon.auth.signInWithPassword({ email: c.email, password: c.password });
      console.log(`reuse user=${c.userId} email=${c.email} signin=${s.error ? "FAIL " + s.error.message : "OK"}`);
      return;
    }
  }

  const creado = new Date().toISOString();
  const tag = creado.replace(/[-:TZ.]/g, "").slice(0, 14);
  const email = `qa-f45-${tag}@example.invalid`;
  const password = randomBytes(18).toString("base64url");

  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `qa_f45_${tag.slice(8)}` },
  });
  if (error || !data.user) throw new Error(error?.message ?? "no se pudo crear la cuenta QA");

  writeFileSync(credsFile, JSON.stringify({ email, password, userId: data.user.id, createdAt: creado }), { mode: 0o600 });
  try { chmodSync(credsFile, 0o600); } catch { /* Windows */ }

  const s = await anon.auth.signInWithPassword({ email, password });
  // El identificador y el correo SÍ se imprimen: hacen falta para poder rastrear y limpiar lo que genere.
  console.log(`created user=${data.user.id} email=${email} createdAt=${creado} signin=${s.error ? "FAIL " + s.error.message : "OK"}`);
}

main().catch((e) => { console.error("ERROR", e instanceof Error ? e.message : e); process.exit(1); });
