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
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  emptyStrat, addStep, updateStep, moveObject,
  STRAT_VERSION, MAX_STEPS, TEAM_SIZE, MAX_UTILITIES, MAX_ANNOTATIONS, MAX_POINTS,
  DRAW_COLORS, type Strat,
} from "@/domain/tactics";

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
  const password = ephemeralQaPassword();
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
    const plan = emptyStrat("nueva", "ascent", "attack", "Ejecución rápida A");
    const saved = await api(ana.token, "POST", { action: "save", strat: plan });
    check(saved.status === 200, "una estrategia válida se guarda", String(saved.status));
    const id = saved.json.id as string;
    check(typeof id === "string" && id.length > 0, "el servidor devuelve el identificador");

    const list = await api(ana.token, "GET");
    const strats = (list.json.strats ?? []) as { id: string; name: string }[];
    check(strats.length === 1, "aparece en su lista", `${strats.length}`);
    check(strats[0]?.name === "Ejecución rápida A", "conserva el nombre", strats[0]?.name);

    // -- 3 . Saneado del contenido --
    console.log("\n## El servidor sanea, no confia");
    const sucia = await api(ana.token, "POST", {
      action: "save",
      strat: {
        ...plan,
        name: "Sucia",
        notes: "n".repeat(9000),
        description: "d".repeat(9000),
        tags: Array.from({ length: 50 }, (_, i) => `etiqueta-larga-${i}`),
        steps: Array.from({ length: 60 }, () => ({
          label: "L".repeat(400), at: 999999,
          state: {
            players: Array.from({ length: 40 }, () => ({ role: "<script>", x: 1e9, y: -1e9 })),
            utilities: Array.from({ length: 300 }, () => ({ kind: "nuclear", x: 1e9, y: 1e9 })),
            annotations: Array.from({ length: 300 }, () => ({ text: "t".repeat(900), x: -5, y: 500 })),
            drawings: [{
              kind: "<img>", color: "javascript:alert(1)",
              points: Array.from({ length: 400 }, () => ({ x: 1e9, y: 1e9 })),
            }],
          },
        })),
      },
    });
    check(sucia.status === 200, "una estrategia con basura se acepta tras sanearse", String(sucia.status));

    const afterDirty = await api(ana.token, "GET");
    const dirty = ((afterDirty.json.strats ?? []) as { name: string; plan: Strat }[])
      .find((x) => x.name === "Sucia");
    const steps = dirty?.plan.steps ?? [];
    check(steps.length <= MAX_STEPS, "los pasos se acotan al maximo", `${steps.length}`);
    check(steps.every((st) => st.state.players.length <= TEAM_SIZE), "nunca mas de cinco jugadores por paso");
    check(steps.every((st) => st.state.utilities.length <= MAX_UTILITIES), "las utilidades se acotan");
    check(steps.every((st) => st.state.annotations.length <= MAX_ANNOTATIONS), "las anotaciones se acotan");
    check(
      steps.every((st) => st.state.drawings.every((d) => d.points.length <= MAX_POINTS)),
      "los vertices de un dibujo se acotan",
    );
    check(
      steps.every((st) => st.state.drawings.every((d) => (DRAW_COLORS as readonly string[]).includes(d.color))),
      "un color fuera de la paleta no llega a la base",
    );
    check(
      steps.every((st) => [...st.state.players, ...st.state.utilities, ...st.state.annotations]
        .every((o) => o.x >= 0 && o.x <= 100 && o.y >= 0 && o.y <= 100)),
      "las coordenadas quedan dentro del mapa",
    );
    check(String(dirty?.plan.notes ?? "").length <= 1000, "las notas se recortan");
    check(String(dirty?.plan.description ?? "").length <= 600, "la descripcion se recorta");
    check((dirty?.plan.tags ?? []).length <= 8, "las etiquetas se acotan");
    check(dirty?.plan.version === STRAT_VERSION, "se guarda con la version de formato actual", `${dirty?.plan.version}`);

    // -- 3b . Cada paso guarda SU estado --
    console.log("\n## Los pasos son independientes");
    {
      let dos = emptyStrat("dos", "haven", "defense", "Dos pasos");
      dos = addStep(dos, "Rotacion", 20);
      const idFicha = dos.steps[1].state.players[0].id;
      dos = updateStep(dos, 1, (st) => moveObject(st, idFicha, 11, 22));
      const g = await api(ana.token, "POST", { action: "save", strat: dos });
      check(g.status === 200, "una estrategia de dos pasos se guarda", String(g.status));

      const leida = ((await api(ana.token, "GET")).json.strats as { name: string; plan: Strat }[])
        .find((x) => x.name === "Dos pasos")?.plan;
      const p0 = leida?.steps[0].state.players[0];
      const p1 = leida?.steps[1].state.players[0];
      check(!!leida && leida.steps.length === 2, "vuelve con sus dos pasos");
      check(p1?.x === 11 && p1?.y === 22, "el paso 2 conserva la posicion movida", `${p1?.x},${p1?.y}`);
      check(p0?.x !== 11 || p0?.y !== 22, "y el paso 1 NO se movio con el", `${p0?.x},${p0?.y}`);
      check(
        ((await api(ana.token, "GET")).json.strats as { name: string; steps: number }[])
          .find((x) => x.name === "Dos pasos")?.steps === 2,
        "el listado cuenta los pasos por el servidor",
      );
    }

    // -- 4 . Estrategias mal formadas --
    console.log("\n## Estrategias mal formadas");
    check(
      (await api(ana.token, "POST", { action: "save", strat: { mapId: "atlantida" } })).status === 400,
      "un mapa inexistente se rechaza",
    );
    check(
      (await api(ana.token, "POST", { action: "save", strat: { mapId: "terminal" } })).status === 400,
      "un mapa RETIRADO se rechaza igual que uno inventado",
    );
    check(
      (await api(ana.token, "POST", { action: "save", strat: "no soy un objeto" })).status === 400,
      "algo que no es una estrategia se rechaza",
    );
    {
      const repes = updateStep(emptyStrat("r", "ascent", "attack"), 0, (st) => ({
        ...st, players: st.players.map((pl) => ({ ...pl, role: st.players[0].role })),
      }));
      const r = await api(ana.token, "POST", { action: "save", strat: repes });
      check(r.status === 409, "un rol repetido se rechaza con su motivo", String(r.status));
    }
    {
      // Un plan que pasa el saneado por partes pero es enorme en conjunto.
      const gorda = {
        ...emptyStrat("g", "ascent", "attack"),
        steps: Array.from({ length: 12 }, (_, i) => ({
          id: `s${i}`, at: i, label: `P${i}`, notes: "",
          state: {
            players: [], utilities: [], annotations: [],
            drawings: Array.from({ length: 40 }, (_, k) => ({
              id: `d${i}-${k}`, kind: "free", color: "#ff2e63",
              points: Array.from({ length: 64 }, () => ({ x: 12.3456, y: 65.4321 })),
            })),
          },
        })),
      };
      const r = await api(ana.token, "POST", { action: "save", strat: gorda });
      check(r.status === 200 || r.status === 413,
        "un plan al limite se acepta o se rechaza por tamano, nunca revienta", String(r.status));
    }

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
      .insert({ user_id: ana.id, name: "A nombre de otro", map_id: "ascent", side: "attack", plan: {} });
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
      user_id: beto.id, name: `carga ${i}`, map_id: "ascent", side: "attack",
      plan: emptyStrat(`c${i}`, "ascent", "attack"),
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
    // -- 7 . Duplicar --
    console.log("\n## Duplicar");
    {
      const antes = ((await api(ana.token, "GET")).json.strats ?? []) as { id: string; name: string }[];
      const origen = antes.find((x) => x.name === "Dos pasos")!;
      const d = await api(ana.token, "POST", { action: "duplicate", id: origen.id });
      check(d.status === 200, "una estrategia propia se duplica", String(d.status));

      const despues = ((await api(ana.token, "GET")).json.strats ?? []) as { id: string; name: string; plan: Strat }[];
      const copia = despues.find((x) => x.id === d.json.id);
      check(!!copia, "la copia aparece en la lista");
      check(copia?.name === "Dos pasos (copia)", "la copia se llama distinto", copia?.name);
      check(copia?.id !== origen.id, "la copia tiene identificador propio");
      check(copia?.plan.steps.length === 2, "la copia conserva los pasos", `${copia?.plan.steps.length}`);

      // Editar la copia no puede tocar la original.
      const editada = { ...copia!.plan };
      editada.steps = editada.steps.map((st, i) => (i === 0
        ? { ...st, state: { ...st.state, players: st.state.players.map((pl) => ({ ...pl, x: 3, y: 3 })) } }
        : st));
      await api(ana.token, "POST", { action: "save", id: copia!.id, strat: editada });

      const fin = ((await api(ana.token, "GET")).json.strats ?? []) as { id: string; plan: Strat }[];
      const orig = fin.find((x) => x.id === origen.id)!;
      check(orig.plan.steps[0].state.players[0].x !== 3,
        "editar la copia NO toco la original", `${orig.plan.steps[0].state.players[0].x}`);

      const ajena = await api(beto.token, "POST", { action: "duplicate", id: origen.id });
      check(ajena.status === 404, "no se puede duplicar la estrategia de otro", String(ajena.status));
    }

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
