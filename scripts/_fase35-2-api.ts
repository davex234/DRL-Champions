/**
 * FASE 35.2 · CLIENTE DE LA API REAL CON LA CUENTA QA (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase35-2-api.ts <credsFile> <comando> [args]
 *
 * Inicia sesión como la cuenta QA con el cliente PÚBLICO (anon + contraseña, igual que el formulario) y llama a
 * la app LOCAL (`BASE`, por defecto http://127.0.0.1:3005) con el Bearer del usuario. Nunca usa la service key.
 * Imprime solo datos no sensibles (ids truncados, conteos, códigos).
 *
 * Comandos:
 *   open-starter            abre los sobres de bienvenida que tenga (inicial, estandar)
 *   buy-open <packId>       compra y abre un sobre con créditos de la cuenta QA (economía real de la cuenta QA)
 *   workspace               cobertura de roles/jugadores, equipos y equipo activo
 *   campaign                foto de Road to Champions (resumen por nodo)
 *   post '<json>'           POST crudo a /api/game/campaign (pruebas de seguridad del contrato) → status + code
 *   raw <method> <path> ['<json>']  cualquier endpoint de la app con el Bearer QA → status + extracto
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
const [credsFile, cmd, ...args] = process.argv.slice(2);
const creds = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; userId: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
async function token(): Promise<string> {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error || !data.session) throw new Error(`login QA falló: ${error?.message}`);
  return data.session.access_token;
}

async function call(t: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${t}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function coverage(collection: any[]): string {
  const roles = ["Duelista", "Controlador", "Iniciador", "Centinela", "Flex"];
  return roles.map((r) => `${r}:${new Set(collection.filter((c) => c.role === r).map((c) => c.playerId)).size}`).join(" ");
}

async function main() {
  const t = await token();
  const uid = creds.userId.slice(0, 8);
  switch (cmd) {
    case "open-starter": {
      for (const packId of ["inicial", "inicial", "inicial", "estandar"]) {
        const r = await call(t, "POST", "/api/game/packs", { action: "open", packId, ref: `f352-open-${randomUUID()}` });
        console.log(`open ${packId} → ${r.status} cards=${r.json.opened?.length ?? "-"} ${r.json.error ?? ""}`);
      }
      break;
    }
    case "buy-open": {
      const r = await call(t, "POST", "/api/game/packs", { action: "buy_and_open", packId: args[0], ref: `f352-buy-${randomUUID()}` });
      console.log(`buy_and_open ${args[0]} → ${r.status} cards=${r.json.opened?.length ?? "-"} credits=${r.json.credits ?? "-"} ${r.json.error ?? ""}`);
      break;
    }
    case "workspace": {
      const r = await call(t, "GET", "/api/game/duels");
      const w = r.json;
      console.log(`user=${uid} status=${r.status} collection=${w.collection?.length ?? "-"} distinctPlayersByRole=[${coverage(w.collection ?? [])}] activeSupported=${w.activeSupported} activeDeck=${w.activeDeckId ? String(w.activeDeckId).slice(0, 8) : "none"}`);
      for (const d of w.decks ?? []) console.log(`deck ${String(d.id).slice(0, 8)} "${d.name}" cards=${d.cards.length} valid=${d.valid} status=${d.status} sum=${d.sumOvr} active=${d.active} roles=${JSON.stringify(d.roleCounts)}`);
      break;
    }
    case "campaign": {
      const r = await call(t, "GET", "/api/game/campaign");
      const s = r.json;
      console.log(`status=${r.status} available=${s.available} reason=${s.unavailableReason} version=${s.version} summary=${s.summary?.completed}/${s.summary?.total} next=${s.summary?.nextNodeId} earned=${s.economy?.firstClearEarned} active=${s.activeAttempt ? s.activeAttempt.nodeId + ":" + s.activeAttempt.status : "none"} last=${s.lastAttempt ? `${s.lastAttempt.nodeId}:${s.lastAttempt.result}:firstClear=${s.lastAttempt.firstClear}` : "none"}`);
      for (const c of s.chapters ?? []) console.log(`  ${c.id} ${c.completed}/${c.total} ` + c.nodes.map((n: any) => `${n.id}=${n.status[0]}${n.attempts ? `(${n.attempts}a,${n.wins}w,best=${n.bestResult})` : ""}`).join(" "));
      break;
    }
    case "post": {
      const r = await call(t, "POST", "/api/game/campaign", args[0]);
      console.log(`status=${r.status} code=${r.json.code ?? "-"} error=${r.json.error ?? "-"} viewMatch=${r.json.view?.matchId ? String(r.json.view.matchId).slice(0, 8) : "-"} rival=${r.json.view?.rivalLabel ?? "-"} difficulty=${r.json.view?.difficulty ?? "-"}`);
      break;
    }
    case "race-start": {
      // Dos pestañas a la vez: dos «start» del mismo nodo en paralelo, con el contrato real.
      const body = JSON.stringify({ action: "start", nodeId: args[0] });
      const [a, b] = await Promise.all([call(t, "POST", "/api/game/campaign", body), call(t, "POST", "/api/game/campaign", body)]);
      for (const [i, r] of [a, b].entries()) console.log(`tab${i + 1} status=${r.status} code=${r.json.code ?? "-"} match=${r.json.view?.matchId ? String(r.json.view.matchId).slice(0, 8) : "-"} rival=${r.json.view?.rivalLabel ?? "-"} difficulty=${r.json.view?.difficulty ?? "-"}`);
      break;
    }
    case "raw": {
      const [method, path, body] = args;
      const r = await call(t, method, path, body);
      console.log(`status=${r.status} ${JSON.stringify(r.json).slice(0, 400)}`);
      break;
    }
    default:
      console.error("comando desconocido");
      process.exit(1);
  }
}

main().catch((e) => { console.error("ERROR", e instanceof Error ? e.message : e); process.exit(1); });
