"use client";

import { useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { cn } from "@/lib/format";

type Mode = "login" | "register" | "recover";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-base-800 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-drl focus:outline-none";

export function AuthForms() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMsg(null);
    let res: { error?: string } = {};
    if (mode === "login") res = await signIn(email, password);
    else if (mode === "register") res = await signUp(email, password, username);
    else res = await resetPassword(email);
    setBusy(false);
    if (res.error) setMsg({ ok: false, text: res.error });
    else if (mode === "register") setMsg({ ok: true, text: "Cuenta creada. Revisa tu correo si se requiere confirmación." });
    else if (mode === "recover") setMsg({ ok: true, text: "Te enviamos un enlace de recuperación." });
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-base-700/40 p-6">
      <div className="mb-5 flex gap-1 rounded-xl border border-white/10 bg-base-800 p-1">
        {([
          ["login", "Entrar"],
          ["register", "Registro"],
          ["recover", "Recuperar"],
        ] as [Mode, string][]).map(([m, label]) => (
          <button
            key={m}
            onClick={() => { setMode(m); setMsg(null); }}
            className={cn(
              "flex-1 rounded-lg px-3 py-2 font-display text-sm uppercase tracking-wide transition",
              mode === m ? "bg-drl text-white" : "text-white/55 hover:text-white",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {mode === "register" && (
          <input className={inputCls} placeholder="Nombre de usuario" value={username} onChange={(e) => setUsername(e.target.value)} />
        )}
        <input className={inputCls} type="email" placeholder="Correo electrónico" value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode !== "recover" && (
          <input className={inputCls} type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />
        )}

        {msg && (
          <p className={cn("text-sm", msg.ok ? "text-drl-cyan" : "text-drl-glow")}>{msg.text}</p>
        )}

        <button
          onClick={submit}
          disabled={busy}
          className="w-full rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-4 py-3 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition enabled:hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "…" : mode === "login" ? "Entrar" : mode === "register" ? "Crear cuenta" : "Enviar enlace"}
        </button>
      </div>
    </div>
  );
}
