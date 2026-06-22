"use client";

import { useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { AuthForms } from "@/components/auth/AuthForms";
import { getSupabase } from "@/lib/supabase/client";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/format";

const AVATARS = ["🎮", "🦅", "🐉", "🔥", "👑", "⚡", "🎯", "🦊", "🐺", "🌟", "💎", "🃏"];

export default function CuentaPage() {
  const { configured, loading, user, profile, signOut, refreshProfile } = useAuth();
  const { toast, notify } = useToast();
  const [savingAvatar, setSavingAvatar] = useState<string | null>(null);

  async function setAvatar(avatar: string) {
    if (!user) return;
    setSavingAvatar(avatar);
    await getSupabase()?.from("profiles").update({ avatar }).eq("id", user.id);
    await refreshProfile();
    setSavingAvatar(null);
    notify("Avatar actualizado", true);
  }

  if (!configured) {
    return (
      <section className="animate-rise">
        <Header />
        <div className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-base-700/40 p-6 text-center">
          <p className="text-4xl">📦</p>
          <p className="mt-3 font-display text-lg font-bold uppercase text-white">Modo local</p>
          <p className="mt-2 text-sm text-white/55">
            Estás jugando con tu progreso guardado en este dispositivo. Para tener cuenta online,
            ranking y mercado entre jugadores, configura Supabase
            (<code className="text-drl">NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
            <code className="text-drl">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>). Ver{" "}
            <code className="text-drl">supabase/README.md</code>.
          </p>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="animate-rise">
        <Header />
        <div className="grid min-h-[30vh] place-items-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-drl border-t-transparent" />
        </div>
      </section>
    );
  }

  if (!user || !profile) {
    return (
      <section className="animate-rise">
        <Header />
        <AuthForms />
      </section>
    );
  }

  const fields: [string, string][] = [
    ["Nivel", String(profile.level)],
    ["XP", formatCredits(profile.xp)],
    ["Créditos", `🪙 ${formatCredits(profile.credits)}`],
    ["Tokens", `🎟️ ${formatCredits(profile.tokens)}`],
    ["Valor colección", `🪙 ${formatCredits(profile.collection_value)}`],
    ["Cartas distintas", String(profile.distinct_cards)],
    ["Volumen mercado", `🪙 ${formatCredits(profile.market_volume)}`],
    ["Sobres abiertos", String(profile.packs_opened)],
  ];

  return (
    <section className="animate-rise">
      <Header />
      <div className="rounded-2xl border border-white/10 bg-base-700/40 p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-drl/30 to-base-800 text-4xl shadow-glow">
            {profile.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl font-bold uppercase text-white">{profile.username}</h2>
            <p className="text-sm text-white/45">Nivel {profile.level} · {formatCredits(profile.xp)} XP</p>
          </div>
          <button
            onClick={() => signOut()}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 font-display text-sm uppercase tracking-wide text-white transition hover:bg-white/10"
          >
            Cerrar sesión
          </button>
        </div>

        <p className="mt-5 mb-2 text-[10px] uppercase tracking-widest text-white/40">Avatar</p>
        <div className="flex flex-wrap gap-2">
          {AVATARS.map((a) => (
            <button
              key={a}
              onClick={() => setAvatar(a)}
              disabled={savingAvatar !== null}
              className={cn(
                "grid h-10 w-10 place-items-center rounded-lg border text-xl transition",
                profile.avatar === a ? "border-drl bg-drl/15" : "border-white/10 bg-white/5 hover:bg-white/10",
              )}
            >
              {a}
            </button>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {fields.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/10 bg-base-800/60 p-3">
              <p className="text-[10px] uppercase tracking-widest text-white/40">{label}</p>
              <p className="font-display text-lg font-bold text-white">{value}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-white/35">
          Tu progreso se sincroniza automáticamente con la nube en cada cambio.
        </p>
      </div>
      <Toast toast={toast} />
    </section>
  );
}

function Header() {
  return (
    <header className="mb-6">
      <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
        Mi <span className="text-drl">Cuenta</span>
      </h1>
      <p className="mt-1 text-white/50">Perfil, progreso y sincronización en la nube.</p>
    </header>
  );
}
