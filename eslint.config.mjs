/**
 * SANEAMIENTO POST F47 · CONFIGURACIÓN «FLAT» DE ESLINT.
 *
 * `next lint` desapareció en Next 16 (aquí 16.2.9): `npm run lint` lo interpretaba como
 * `next <directorio>` y moría con «Invalid project directory ... \lint». Y ESLint 9 usa configuración
 * «flat» por defecto, así que `.eslintrc.json` por sí solo ya no se carga.
 *
 * Aquí se cierra el contrato correcto para ESLint 9 + Next 16, SIN variables de entorno de compatibilidad
 * (`ESLINT_USE_FLAT_CONFIG=false` no funciona igual en cmd/PowerShell, que es el entorno real del proyecto):
 * `FlatCompat` traduce la configuración heredada. `.eslintrc.json` SIGUE SIENDO LA ÚNICA FUENTE de
 * `extends`/`plugins`/`rules` — se lee de ahí, no se duplica — porque `eslint-config-next@15.1.6` todavía
 * no publica entrada «flat» propia.
 */
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const here = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: here });
const legacy = JSON.parse(readFileSync(new URL("./.eslintrc.json", import.meta.url), "utf8"));

export default [
  {
    // Sin `.eslintignore` en modo «flat»: lo generado y lo que no es código fuente se ignora aquí.
    ignores: [
      ".next/**", "out/**", "build/**", "dist/**", "coverage/**", "output/**",
      "public/**", "deploy/**", "docs/**", "supabase/**",
      "src-tauri/target/**", "src-tauri/gen/**",
      "next-env.d.ts", "**/*.d.ts",
    ],
  },
  ...compat.config(legacy),
];
