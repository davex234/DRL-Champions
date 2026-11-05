/**
 * F87 · CUENTAS QA NUEVAS para la regresión en producción (instrumento, fuera de CI).
 *
 *   QA_CREDS_DIR=<scratchpad>/qa87 QA_SB=https://valorosters.com QA_ANON_FILE=<clave anon pública> npx tsx scripts/_f87-qa-accounts.mts A B C …
 *
 * Registro real (GoTrue, autoconfirmación ON) con `qa-f87-<p>-<rand>@example.invalid` y nombre `qa_f87_<p>`: el embudo
 * de la alpha y su panel las excluyen (correo @example.invalid y nombre «qa…»). Credenciales SOLO en el scratchpad.
 * Guardia: aborta si el id coincide con una cuenta real. Reutiliza una persona si su fichero ya existe.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const DIR = process.env.QA_CREDS_DIR!;
const SB = process.env.QA_SB!;
const ANON = readFileSync(process.env.QA_ANON_FILE!, "utf8").trim();
const REAL = ["2f86cbe8", "3befce61", "b7ccff02"];
// F87.1 · `QA_PREFIX` (por defecto f87): marca de la fase en correo y nombre, para limpiar SOLO lo de esa fase.
const PFX = (process.env.QA_PREFIX ?? "f87").replace(/[^a-z0-9]/g, "");
mkdirSync(DIR, { recursive: true });

for (const p of process.argv.slice(2)) {
  const file = join(DIR, `${p}.json`);
  if (existsSync(file)) { console.log(`${p}: ya existe`); continue; }
  const username = `qa_${PFX}_${p.toLowerCase()}`;
  const email = `qa-${PFX}-${p.toLowerCase()}-${randomBytes(4).toString("hex")}@example.invalid`;
  const password = randomBytes(18).toString("base64url");
  const r = await fetch(`${SB}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password, data: { username } }) });
  const j = await r.json() as { user?: { id: string }; id?: string };
  const userId = j.user?.id ?? j.id;
  if (!r.ok || !userId) throw new Error(`${p}: registro ${r.status}`);
  if (REAL.some((x) => userId.startsWith(x))) throw new Error("CUENTA REAL: abortado");
  writeFileSync(file, JSON.stringify({ email, password, userId, username }), { mode: 0o600 });
  console.log(`${p}: ${userId.slice(0, 8)} ${username}`);
}
