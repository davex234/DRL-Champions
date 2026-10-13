/**
 * F80 · INSTRUMENTO (fuera de CI): comprobación EN PRODUCCIÓN del cobro de sobres con cuentas QA. Nunca la del usuario.
 *   (cwd temporal con .env.local PÚBLICO)  BASE_URL=https://valorosters.com npx tsx <repo>/scripts/_f80-live.mts <persona>
 * 1 · saldos QA; 2 · cuerpo manipulado con `price` → 400; 3 · Icon con saldo ≥ precio ANTIGUO (12.500) y < 60.000 → 409
 * sin cobro; 4 · UNA compra real de Bronce: −2.500 exactos y +1 sobre; el reintento con el mismo gesto no cobra otra vez.
 */
const { login } = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const BASE = process.env.BASE_URL ?? "https://valorosters.com";
const persona = process.argv[2] ?? "C";
const W = await login(persona);
const call = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${W.token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  let j: any = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, j };
};
const state = async () => { const s = await call("/api/game/state"); return { credits: Number(s.j?.credits ?? s.j?.profile?.credits), packs: (s.j?.packs ?? s.j?.inventory?.packs ?? {}) as Record<string, number>, raw: s }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const out: Record<string, unknown> = { persona, at: new Date().toISOString() };

const s0 = await state();
out.before = { credits: s0.credits, estandar: s0.packs.estandar ?? 0, icon: s0.packs.icon ?? 0, stateStatus: s0.raw.status };
console.log("BEFORE", JSON.stringify(out.before));

const tampered = await call("/api/game/packs", { method: "POST", body: JSON.stringify({ action: "buy", packId: "icon", ref: "f80-tamper", price: 1 }) });
out.tamper = { status: tampered.status, error: tampered.j?.error };
console.log("TAMPER", JSON.stringify(out.tamper));
await sleep(600);

if (s0.credits >= 12_500 && s0.credits < 60_000) {
  const icon = await call("/api/game/packs", { method: "POST", body: JSON.stringify({ action: "buy", packId: "icon", ref: `f80-icon-${Date.now()}` }) });
  await sleep(600);
  const s1 = await state();
  out.iconOldPrice = { status: icon.status, error: icon.j?.error, creditsAfter: s1.credits, iconAfter: s1.packs.icon ?? 0, unchanged: s1.credits === s0.credits && (s1.packs.icon ?? 0) === (s0.packs.icon ?? 0) };
  console.log("ICON_WITH_OLD_PRICE_BALANCE", JSON.stringify(out.iconOldPrice));
} else out.iconOldPrice = `saltado: saldo ${s0.credits} fuera de [12.500, 60.000)`;

// --probe <pack>: saldo ≥ precio ANTIGUO y < precio NUEVO → el servidor real tiene que rechazar sin cobrar.
const probe = process.argv.indexOf("--probe");
if (probe > 0) {
  const id = process.argv[probe + 1];
  const r = await call("/api/game/packs", { method: "POST", body: JSON.stringify({ action: "buy", packId: id, ref: `f80-probe-${id}-${Date.now()}` }) });
  await sleep(600);
  const s1 = await state();
  out.probe = { packId: id, status: r.status, error: r.j?.error, creditsBefore: s0.credits, creditsAfter: s1.credits, packsBefore: s0.packs[id] ?? 0, packsAfter: s1.packs[id] ?? 0 };
  console.log("PROBE", JSON.stringify(out.probe));
}

if (process.argv.includes("--buy") && s0.credits >= 2_500) {
  const ref = `f80-bronce-${Date.now()}`;
  const s1 = await state();
  const a = await call("/api/game/packs", { method: "POST", body: JSON.stringify({ action: "buy", packId: "estandar", ref }) });
  await sleep(600);
  const b = await call("/api/game/packs", { method: "POST", body: JSON.stringify({ action: "buy", packId: "estandar", ref }) });
  await sleep(600);
  const s2 = await state();
  out.bronce = { first: { status: a.status, credits: a.j?.credits, qty: a.j?.qty }, retry: { status: b.status, repeated: b.j?.repeated, credits: b.j?.credits },
    creditsBefore: s1.credits, creditsAfter: s2.credits, charged: s1.credits - s2.credits, packsGained: (s2.packs.estandar ?? 0) - (s1.packs.estandar ?? 0) };
  console.log("BRONCE", JSON.stringify(out.bronce));
}
console.log("RESULT", JSON.stringify(out));
