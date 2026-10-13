"use client";

/**
 * F67 · NUEVA CONTRASEÑA tras el enlace de recuperación. Antes el correo llevaba a /cuenta y no había dónde escribirla:
 * el flujo de «he olvidado mi contraseña» terminaba en nada.
 */
import { useState } from "react";
import { useAuth } from "@/lib/supabase/auth";

export function PasswordRecoveryForm() {
  const { updatePassword } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (pw !== pw2) { setMsg({ ok: false, text: "Las dos contraseñas no coinciden." }); return; }
    setBusy(true); setMsg(null);
    const r = await updatePassword(pw);
    setBusy(false);
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "Contraseña actualizada. Ya puedes seguir jugando." });
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-6 max-w-sm space-y-3" data-testid="password-recovery">
      <h2 className="font-display text-xl uppercase text-ink-primary">Nueva contraseña</h2>
      <p className="text-sm text-ink-muted">Escribe la contraseña nueva para tu cuenta.</p>
      <input type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)}
        aria-label="Nueva contraseña" className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-ink-primary" />
      <input type="password" autoComplete="new-password" minLength={8} required value={pw2} onChange={(e) => setPw2(e.target.value)}
        aria-label="Repite la contraseña" className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-ink-primary" />
      <button type="submit" disabled={busy} className="nx-press w-full rounded-md bg-drl px-3 py-2 font-semibold uppercase text-white disabled:opacity-60">
        {busy ? "Guardando…" : "Guardar contraseña"}
      </button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-emerald-300" : "text-sm text-red-300"}>{msg.text}</p>}
    </form>
  );
}
