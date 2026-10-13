/**
 * FASE 69 · BETA HARDENING — utillaje de los instrumentos de F69 (fuera de CI). Reutiliza el arnés de F68 (login por
 * formulario, red, API con Bearer) y escribe su evidencia en docs/product/qa/fase69-hardening/. SOLO cuentas QA.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { api, sleep, type Client } from "./_fase68-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
export * from "./_fase68-lib";
export const OUT69 = join(process.cwd(), "docs/product/qa/fase69-hardening");
export const RAW69 = join(OUT69, "raw");
export const SHOTS69 = join(OUT69, "screenshots");
for (const d of [OUT69, RAW69, SHOTS69]) mkdirSync(d, { recursive: true });

export function writeRaw69(id: string, data: unknown) {
  writeFileSync(join(RAW69, `${id}.json`), JSON.stringify(data, null, 2));
  console.log(`→ fase69-hardening/raw/${id}.json`);
}

export async function shot69(c: Client, name: string) {
  await sleep(400);
  await c.tab.shot(join(SHOTS69, `${c.label}-${name}-${c.width}.png`)).catch(() => null);
}

/** Lo que el SERVIDOR dice de la cuenta: saldo, XP de cuenta y nivel (lectura GET, sin escrituras). */
export async function serverWallet(t: string) {
  const s = (await api(t, "/api/game/state")).json ?? {};
  return { credits: s.credits ?? null, xp: s.xp ?? null, level: s.level ?? null };
}

/** Lo que el HUD PINTA (cabecera del armazón): créditos y nivel. Sin sesión, `signin: true`. */
export async function hudWallet(c: Client) {
  return c.tab.js<any>(`(() => {
    const cr = document.querySelector('[title="DRL Credits"] .nx-readout') || document.querySelector('[data-testid="hud-credits"]');
    const lv = document.querySelector('a[aria-label^="Tu perfil · nivel"]');
    const num = (s) => { const d = String(s || '').replace(/[^0-9]/g, ''); return d ? Number(d) : null; };
    return {
      credits: cr ? num(cr.textContent) : null,
      level: lv ? num(lv.getAttribute('aria-label')) : null,
      signin: !!document.querySelector('[data-testid="hud-signin"]'),
    };
  })()`);
}
