/**
 * FASE 68 · BUG F68-004: /cuenta enseñaba el texto crudo de GoTrue en inglés («Invalid login credentials»,
 * «User already registered»). Medido en la beta con una cuenta QA real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authErrorMessage, AUTH_FALLBACK } from "./authErrors";

test("F68 B004 · credenciales malas: en español, y el MISMO texto exista o no la cuenta (sin enumerar)", () => {
  const a = authErrorMessage({ message: "Invalid login credentials", code: "invalid_credentials", status: 400 });
  const b = authErrorMessage({ message: "Invalid login credentials", status: 400 });
  assert.equal(a, "Correo o contraseña incorrectos.");
  assert.equal(a, b);
});

test("F68 B004 · email ya registrado, correo sin confirmar, contraseña débil y límite: mensajes útiles", () => {
  assert.match(authErrorMessage({ message: "User already registered", code: "user_already_exists" }), /Ya hay una cuenta con ese correo/);
  assert.match(authErrorMessage({ message: "User already registered" }), /Ya hay una cuenta con ese correo/);
  assert.match(authErrorMessage({ message: "Email not confirmed" }), /confirmar tu correo/);
  assert.match(authErrorMessage({ message: "Password should be at least 6 characters.", code: "weak_password" }), /al menos 8/);
  assert.match(authErrorMessage({ message: "whatever", status: 429 }), /Espera un momento/);
  assert.match(authErrorMessage({ message: "Failed to fetch" }), /conexión/);
});

test("F68 B004 · un error desconocido NO se reenvía crudo (podría ser técnico): mensaje neutro", () => {
  assert.equal(authErrorMessage({ message: "AuthApiError: unexpected_failure at gotrue/internal 500" }), AUTH_FALLBACK);
  assert.equal(authErrorMessage(null), AUTH_FALLBACK);
  for (const m of ["Invalid login credentials", "User already registered", "Email not confirmed"]) {
    assert.ok(!authErrorMessage({ message: m }).toLowerCase().includes(m.toLowerCase()), `no reenvía «${m}»`);
  }
});

test("F68 B004 · contrato: el proveedor de auth traduce en las cuatro vías (entrar, registro, recuperar, cambiar)", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/supabase/auth.tsx"), "utf8");
  assert.equal((src.match(/authErrorMessage\(error\)/g) ?? []).length, 4);
  assert.ok(!/error: error\.message/.test(src), "ningún error.message crudo hacia la interfaz");
});

test("F68 B009 · enlace de correo caducado o usado: aviso claro (antes, formulario normal sin decir nada)", async () => {
  const { authLinkError } = await import("./authErrors");
  assert.match(authLinkError("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")!, /caducado o ya se usó/);
  assert.match(authLinkError("?error=server_error&error_description=Something")!, /no es válido/);
  assert.equal(authLinkError(""), null);
  assert.equal(authLinkError("#access_token=x&type=recovery"), null, "un enlace BUENO no es un error");
  const form = readFileSync(join(process.cwd(), "src/components/auth/AuthForms.tsx"), "utf8");
  assert.match(form, /authLinkError\(window\.location\.hash\) \?\? authLinkError\(window\.location\.search\)/);
  assert.match(form, /setMode\("recover"\);\s*setMsg\(\{ ok: false, text \}\);\s*window\.history\.replaceState\(null, "", window\.location\.pathname\);/);
});
