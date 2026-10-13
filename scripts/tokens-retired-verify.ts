/**
 * ¿ESTÁ RETIRADA LA SEGUNDA MONEDA? — `npm run tokens:verify`
 *
 * Responde a una sola pregunta, contra la base de datos REAL: ¿se han aplicado las
 * migraciones 0026 y 0027, y ha quedado el sistema con UNA sola moneda?
 *
 * Existe porque el código de la F18.2 y el esquema se retiran por separado: el código dejó
 * de usar las fichas antes de que la columna desapareciera, y entre una cosa y otra hay una
 * ventana en la que conviene poder preguntar «¿por dónde vamos?» sin abrir la consola SQL.
 *
 * No escribe nada. Crea una cuenta de usar y tirar para probar la concesión real y la borra.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL_ || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

async function main(): Promise<void> {
  console.log("# ¿Está retirada la segunda moneda? — DRL Cards (F18.2)\n");

  // ── 0026: ¿sigue `app_grant_reward` aceptando `p_tokens`? ────────────────────
  console.log("## Migración 0026 · la RPC ya no concede fichas");
  const { data: u } = await db.auth.admin.createUser({
    email: `tokprobe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.invalid`,
    password: ephemeralQaPassword(), email_confirm: true,
    user_metadata: { username: `tokprobe${Date.now().toString(36)}` },
  });
  const uid = u?.user?.id;
  if (!uid) throw new Error("no se pudo crear la cuenta de prueba");

  let m0026 = false;
  try {
    /*
     * Se llama a la firma ANTIGUA, la que lleva `p_tokens`. Si PostgREST la encuentra,
     * 0026 no está aplicada: la vía de escritura sigue abierta.
     */
    const legacy = await db.rpc("app_grant_reward", {
      p_user: uid, p_ref: `tokprobe:legacy:${uid}`, p_reason: "qa_token_probe",
      p_credits: 0, p_xp: 0, p_tokens: 0, p_pack_id: null, p_pack_count: 0,
      p_points: 0, p_card_ids: null, p_cosmetics: null,
    });
    m0026 = legacy.error?.code === "PGRST202";
    check("`app_grant_reward` ya NO acepta `p_tokens`", m0026,
      m0026 ? "0026 aplicada" : "0026 SIN aplicar: la firma con p_tokens sigue viva");

    // La firma nueva tiene que funcionar en los dos mundos: es la que usa el servidor.
    const modern = await db.rpc("app_grant_reward", {
      p_user: uid, p_ref: `tokprobe:modern:${uid}`, p_reason: "qa_token_probe",
      p_credits: 10, p_xp: 1, p_pack_id: null, p_pack_count: 0,
      p_points: 0, p_card_ids: null, p_cosmetics: null,
    });
    check("conceder SIN fichas sigue funcionando", !modern.error,
      modern.error ? `${modern.error.code} ${modern.error.message.slice(0, 60)}` : "aplicada");
  } finally {
    await db.auth.admin.deleteUser(uid).catch(() => {});
  }

  // ── 0027: ¿existe todavía la columna? ────────────────────────────────────────
  console.log("\n## Migración 0027 · la columna `profiles.tokens`");
  const { data: rows, error } = await db.from("profiles").select("tokens");
  const gone = !!error && /column .*tokens.* does not exist|tokens/i.test(error.message);

  if (error) {
    check("la columna ya no existe", gone, `${error.code} · ${error.message.slice(0, 70)}`);
  } else {
    const list = (rows ?? []) as { tokens: number | null }[];
    const total = list.reduce((a, r) => a + Number(r.tokens ?? 0), 0);
    const holders = list.filter((r) => Number(r.tokens ?? 0) !== 0).length;
    check("la columna ya no existe", false,
      `0027 SIN aplicar · ${list.length} perfiles · suma ${total} · con saldo ${holders}`);
    /*
     * Mientras siga ahí, lo que importa es que nadie tenga saldo: es la condición que hace
     * que borrarla no destruya nada, y la que el propio 0027 vuelve a comprobar antes de
     * ejecutar el `drop`.
     */
    check("y mientras siga ahí, sigue siendo seguro borrarla (nadie tiene fichas)",
      total === 0 && holders === 0, `suma ${total} · con saldo ${holders}`);
  }

  // ── La lectura de negocio ────────────────────────────────────────────────────
  console.log("\n## Conclusión");
  const single = m0026 && gone;
  console.log(
    single
      ? "  ✅ UNA SOLA MONEDA: los DRL Credits. Las fichas de evento ya no existen ni en el esquema."
      : "  ⏳ RETIRADA A MEDIAS: el código ya no usa fichas, pero el esquema todavía las tiene.\n" +
        "     Aplica las migraciones que falten y vuelve a ejecutar `npm run tokens:verify`.",
  );

  console.log(
    fail === 0
      ? `\n✅ LA SEGUNDA MONEDA ESTÁ RETIRADA — ${pass}/${pass + fail}`
      : `\n⚠️  ${fail} PASO(S) PENDIENTE(S) — ${pass}/${pass + fail}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
