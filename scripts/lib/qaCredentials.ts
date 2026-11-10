/**
 * Credenciales de las cuentas QA de los scripts de verificación (F70 · qa-secrets).
 *
 * Regla: NINGUNA contraseña literal en el código.
 *   - Si el script CREA su propia cuenta desechable (auth.admin.createUser), usa
 *     `ephemeralQaPassword()`: una contraseña aleatoria nueva en cada ejecución que no
 *     sale del proceso.
 *   - Si el script inicia sesión con una cuenta QA que YA existe, lee la contraseña de una
 *     variable de entorno `QA_<ALGO>_PASSWORD` con `qaPassword(nombre)`. Sin valor por
 *     defecto: si falta, falla con un error claro.
 *
 * Inventario de variables y procedimiento de rotación/borrado:
 * docs/operations/drlcards-qa-accounts.md
 */
import { randomBytes } from "node:crypto";

/** Contraseña aleatoria de un solo uso para una cuenta QA creada por el propio script. */
export function ephemeralQaPassword(): string {
  return randomBytes(18).toString("base64url");
}

/** Contraseña de una cuenta QA existente, leída de `process.env[envName]`. Sin fallback. */
export function qaPassword(envName: string): string {
  const value = process.env[envName];
  if (!value) {
    throw new Error(`Falta ${envName} (credencial QA; ver docs/operations/drlcards-qa-accounts.md)`);
  }
  return value;
}
