/**
 * Sonda puntual: qué enseñan de verdad las pantallas con poco texto.
 *
 * La auditoría mide caracteres visibles, y varias rutas salieron por debajo de 600. Eso
 * puede ser un estado vacío legítimo («todavía no tienes mazos») o una pantalla atascada
 * en «Cargando…», que sí es un fallo. La única forma de distinguirlo es leer lo que pone.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep } from "./lib/cdp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const SUSPECTS = [
  "/duelos/jugar", "/duelos/mazos", "/entrenador/equipos", "/entrenador/partido",
  "/carrera", "/colecciones", "/inventario", "/noticias", "/duelos", "/cuenta",
  "/ranking", "/admin",
  // Rutas dinámicas, con id válido y con id inexistente: por un enlace viejo llega
  // siempre el segundo caso, y es el que suele no estar contemplado.
  "/abrir/inicial",
  "/abrir/no-existe",
  "/colecciones/no-existe",
  "/torneos/00000000-0000-4000-8000-000000000000",
  "/duelos/replay/00000000-0000-4000-8000-000000000000",
];

/** Frases que delatan una pantalla que no ha terminado de cargar. */
const STUCK = /cargando|preparando|loading|…\s*$/i;

async function main() {
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const email = `low-${Date.now()}@example.invalid`;
  const password = "Test-1234-low";
  const { data: created } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: "lowcheck" },
  });
  const userId = created!.user!.id;

  const browser = await launch({ width: 1440, height: 900 });
  let stuck = 0;

  try {
    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin } = await pub.auth.signInWithPassword({ email, password });
    const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;
    await browser.tab.goto(`${BASE}/`, 800);
    await browser.tab.setStorage(storageKey, JSON.stringify(signin!.session!));

    console.log(`# Qué enseñan las pantallas con poco texto — ${BASE}\n`);

    for (const path of SUSPECTS) {
      // Se espera GENEROSAMENTE: lo que se busca es una pantalla que no termina nunca,
      // no una que tarda dos segundos.
      await browser.tab.goto(`${BASE}${path}`, 6000);
      const text = await browser.tab.js<string>(
        `(document.querySelector('main') || document.body).innerText.replace(/\\s+/g,' ').trim().slice(0, 220)`,
      );
      const atascada = STUCK.test(text) && text.length < 120;
      if (atascada) stuck++;
      console.log(`${atascada ? "  ✕" : "  ✓"} ${path}`);
      console.log(`      ${text || "(vacío)"}`);
    }
  } finally {
    await browser.close();
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(`\n${stuck === 0 ? "✅ ninguna pantalla atascada en carga" : `❌ ${stuck} pantalla(s) atascadas`}`);
  process.exit(stuck === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
