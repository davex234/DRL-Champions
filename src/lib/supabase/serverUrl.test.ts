import { test } from "node:test";
import assert from "node:assert/strict";
import { serverSupabaseOrigin, toInternalUrl } from "./serverUrl";

const ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://valorosters.com", SUPABASE_INTERNAL_URL: "http://127.0.0.1:54521" };

test("el tráfico del servidor al origen público se reescribe al interno", () => {
  assert.equal(toInternalUrl("https://valorosters.com/rest/v1/profiles?select=id", ENV), "http://127.0.0.1:54521/rest/v1/profiles?select=id");
  assert.equal(toInternalUrl("https://valorosters.com/auth/v1/user", ENV), "http://127.0.0.1:54521/auth/v1/user");
});

test("solo el origen público exacto: otros hosts y prefijos parecidos no se tocan", () => {
  assert.equal(toInternalUrl("https://valorosters.com.evil.test/rest/v1/x", ENV), "https://valorosters.com.evil.test/rest/v1/x");
  assert.equal(toInternalUrl("https://flagcdn.com/es.svg", ENV), "https://flagcdn.com/es.svg");
});

test("sin SUPABASE_INTERNAL_URL todo queda como antes", () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54521" };
  assert.equal(toInternalUrl("http://127.0.0.1:54521/rest/v1/x", env), "http://127.0.0.1:54521/rest/v1/x");
  assert.equal(serverSupabaseOrigin(env), "http://127.0.0.1:54521");
});

test("el servidor usa el origen interno cuando existe", () => {
  assert.equal(serverSupabaseOrigin(ENV), "http://127.0.0.1:54521");
  assert.equal(serverSupabaseOrigin({ NEXT_PUBLIC_SUPABASE_URL: "https://valorosters.com/" }), "https://valorosters.com");
});
