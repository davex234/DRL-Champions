/**
 * VERIFICACIÓN DE LAS ESTRATEGIAS — Fase 9I.
 *
 *   npm run dev            (en otra terminal)
 *   npm run strats:verify
 *
 * `user_strats` es la ÚNICA tabla de la Fase 9 en la que el cliente puede escribir sus
 * propias filas, porque una estrategia es contenido suyo y no una cifra del juego. Eso
 * hace que sea la que más hay que probar:
 *
 *   · que no puede tocar las de otro, ni leerlas, ni crearlas a su nombre;
 *   · que la ruta de servidor SANEA el contenido antes de guardarlo, y no acepta un plan
 *     de diez megas con coordenadas de un millón por venir de un token válido;
 *   · que el tope por usuario lo impone la BASE DE DATOS, no solo la aplicación —porque a
 *     PostgREST se llega sin pasar por la aplicación.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { emptyStrat } from "@/domain/tactics";

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

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✕"} ${label}${detail && !ok ? ` — ${detail}` : ""}`);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

async function makeUser(tag: string) {
  const email = `strat-${tag}-${Date.now()}@example.invalid`;
  const password = "Test-1234-strat";
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `strat${tag}` },
  });
  if (error || !data.user) throw new Error(error?.message ?? "no se pudo crear el usuario");
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: signin } = await pub.auth.signInWithPassword({ email, password });
  const token = signin!.session!.access_token;
  return {
    id: data.user.id,
    token,
    db: createClient(URL_, ANON, {
      auth: { persistSession: false },
      global: { headers: { authorization: `Bearer ${token}` } },
    }),
  };
}

async function api(token: string | null, method: "GET" | "POST", body?: unknown) {
  const res = await fetch(`${BASE}/api/game/strats`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function main() {
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) {
    console.error(`❌ No hay servidor NEXUS en ${BASE}. Arranca 'npm run dev' primero.`);
    process.exit(1);
  }

  console.log(`# Verificación de estrategias — ${BASE}\n`);

  const ana = await makeUser("a");
  const beto = await makeUser("b");

  try {
    // ── 1 · Autenticación ──
    console.log("## Autenticación");
    check((await api(null, "GET")).status === 401, "sin token no se listan estrategias");
    check((await api(null, "POST", { action: "save" })).status === 401, "sin token no se guarda nada");

    // ── 2 · Guardar y leer ──
    console.log("\n## Guardar y leer");
    const plan = emptyStrat("nueva", "terminal", "attack", "Ejecución rápida A");
    const saved = await api(ana.token, "POST", { action: "save", strat: plan });
    check(saved.status === 200, "una estrategia válida se guarda", String(saved.status));
    const id = saved.json.id as string;
    check(typeof id === "string" && id.length > 0, "el servidor devuelve el identificador");

    const list = await api(ana.token, "GET");
    const strats = (list.json.strats ?? []) as { id: string; name: string }[];
    check(strats.length === 1, "aparece en su lista", `${strats.length}`);
    check(strats[0]?.name === "Ejecución rápida A", "conserva el nombre", strats[0]?.name);

    // ── 3 · Saneado del contenido ──
    console.log("\n## El servidor sanea, no confía");
    const sucia = await api(ana.token, "POST", {
      action: "save",
      strat: {
        ...plan,
        name: "Sucia",
        notes: "n".repeat(9000),
        markers: [
          ...plan.markers.map((m) => ({ ...m, x: 999999, y: -50000 })),
          ...Array.from({ length: 300 }, (_, i) => ({
            id: `basura${i}`, kind: "<script>", x: 1e9, y: 1e9, label: "L".repeat(900), step: 500,
          })),
        ],
      },
    });
    check(sucia.status === 200, "una estrategia con basura se acepta tras sanearse", String(sucia.status));

    const afterDirty = await api(ana.token, "GET");
    const dirty = ((afterDirty.json.strats ?? []) as { name: string; plan: Record<string, unknown> }[])
      .find((s) => s.name === "Sucia");
    const markers = (dirty?.plan.markers ?? []) as { x: number; y: number; label: string; step: number; kind: string }[];
    check(markers.length <= 40, "los marcadores se acotan al máximo", `${markers.length}`);
    check(
      markers.every((m) => m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100),
      "las coordenadas quedan dentro del mapa",
    );
    check(markers.every((m) => m.label.length <= 40), "las etiquetas se recortan");
    check(markers.every((m) => ["player", "utility", "note"].includes(m.kind)), "los tipos desconocidos se normalizan");
    check(String(dirty?.plan.notes ?? "").length <= 1000, "las notas se recortan");

    // ── 4 · Estrategias mal formadas ──
    console.log("\n## Estrategias mal formadas");
    check(
      (await api(ana.token, "POST", { action: "save", strat: { mapId: "atlantida" } })).status === 400,
      "un mapa inexistente se rechaza",
    );
    check(
      (await api(ana.token, "POST", { action: "save", strat: "no soy un objeto" })).status === 400,
      "algo que no es una estrategia se rechaza",
    );
    const sinEquipo = await api(ana.token, "POST", {
      action: "save",
      strat: { ...plan, markers: plan.markers.slice(0, 2) },
    });
    check(sinEquipo.status === 409, "un equipo incompleto se rechaza con su motivo", String(sinEquipo.status));

    // ── 5 · Aislamiento entre usuarios ──
    console.log("\n## Aislamiento");
    const betoList = await api(beto.token, "GET");
    check(((betoList.json.strats ?? []) as unknown[]).length === 0, "Beto no ve las estrategias de Ana");

    const stolen = await api(beto.token, "POST", { action: "save", id, strat: { ...plan, name: "Robada" } });
    check(stolen.status === 404, "Beto no puede sobrescribir la de Ana", String(stolen.status));

    const deleted = await api(beto.token, "POST", { action: "delete", id });
    check(deleted.status === 200, "borrar la de otro responde ok…");
    const stillThere = await api(ana.token, "GET");
    check(
      ((stillThere.json.strats ?? []) as { id: string }[]).some((s) => s.id === id),
      "…pero no borra nada: la estrategia de Ana sigue ahí",
    );

    // ── 6 · La base de datos también defiende ──
    console.log("\n## Defensa en la base de datos (sin pasar por la aplicación)");
    const direct = await beto.db.from("user_strats")
      .insert({ user_id: ana.id, name: "A nombre de otro", map_id: "terminal", side: "attack", plan: {} });
    check(!!direct.error, "por PostgREST no se puede crear a nombre de otro", "el INSERT pasó");

    const readOther = await beto.db.from("user_strats").select("id").eq("user_id", ana.id);
    check((readOther.data ?? []).length === 0, "por PostgREST no se leen las de otro");

    const updateOther = await beto.db.from("user_strats").update({ name: "Mía ahora" }).eq("id", id);
    check(
      !!updateOther.error || (updateOther.data ?? []).length === 0,
      "por PostgREST no se modifican las de otro",
    );

    // El tope lo impone un trigger, no la aplicación: se prueba insertando directamente.
    console.log("\n## Tope por usuario");
    const rows = Array.from({ length: 45 }, (_, i) => ({
      user_id: beto.id, name: `carga ${i}`, map_id: "terminal", side: "attack",
      plan: emptyStrat(`c${i}`, "terminal", "attack"),
    }));
    let blocked = false;
    for (const row of rows) {
      const { error } = await beto.db.from("user_strats").insert(row);
      if (error) { blocked = true; break; }
    }
    check(blocked, "la base de datos corta antes de las 45 estrategias");
    const { count } = await admin.from("user_strats")
      .select("id", { count: "exact", head: true }).eq("user_id", beto.id);
    check((count ?? 0) <= 40, "y nunca pasa de 40 guardadas", `${count}`);
  } finally {
    await admin.auth.admin.deleteUser(ana.id).catch(() => {});
    await admin.auth.admin.deleteUser(beto.id).catch(() => {});
  }

  console.log(`\n${failures === 0 ? "✅ PASA" : `❌ ${failures} comprobaciones fallidas`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
