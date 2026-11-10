"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { getSupabase } from "@/lib/supabase/client";
import { fetchOnboarding } from "@/lib/onboarding/client";
import { cn } from "@/lib/format";
import { NxButton } from "@/components/ui/NxButton";
import { authLinkError } from "@/lib/supabase/authErrors";
import { SIGNUP_NAME_MAX, SIGNUP_NAME_MIN, SIGNUP_PASSWORD_MIN, signupName, signupNameError, signupPasswordError } from "@/domain/account/signup";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("auth");

/**
 * F63 · ¿A DÓNDE VA QUIEN ACABA DE ENTRAR? Una cuenta recién creada (con sesión ya abierta) va a la portada, donde
 * empieza su primera sesión. Al iniciar sesión, solo si su guía sigue activa (lo dice el servidor); una cuenta con la
 * guía terminada —o de antes de la guía, con partidas— se queda donde estaba, como hasta ahora. Sin bucles: la portada
 * no redirige a ningún sitio.
 */
async function landingAfterAuth(mode: "login" | "register"): Promise<string | null> {
  const sb = getSupabase();
  const hasSession = !!(await sb?.auth.getSession())?.data.session;
  if (!hasSession) return null; // registro pendiente de confirmar el correo
  if (mode === "register") return "/";
  try { return (await fetchOnboarding()).active ? "/" : null; } catch { return null; }
}

type Mode = "login" | "register" | "recover";


export function AuthForms() {
  useLocale();
  const { signIn, signUp, resetPassword } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // F68 · vuelta desde un enlace de correo caducado/usado: se dice qué pasó y se ofrece pedir otro (antes, silencio).
  useEffect(() => {
    const text = authLinkError(window.location.hash) ?? authLinkError(window.location.search);
    // F86.2 · «Crear cuenta» de la portada llega con `?registro=1`: se abre directamente la pestaña de registro.
    if (!text && new URLSearchParams(window.location.search).get("registro") === "1") { setMode("register"); return; }
    if (!text) return;
    setMode("recover");
    setMsg({ ok: false, text });
    window.history.replaceState(null, "", window.location.pathname); // un F5 no repite el aviso
  }, []);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    // F86.2 · el nombre es obligatorio (si no, el alta usaría la parte local del CORREO como nombre público).
    if (mode === "register") {
      const local = signupNameError(username) ?? signupPasswordError(password);
      if (local) { setMsg({ ok: false, text: local }); return; }
    }
    setBusy(true);
    setMsg(null);
    let res: { error?: string } = {};
    if (mode === "login") res = await signIn(email, password);
    else if (mode === "register") res = await signUp(email, password, signupName(username));
    else res = await resetPassword(email);
    setBusy(false);
    if (!res.error && mode !== "recover") {
      const to = await landingAfterAuth(mode);
      if (to) { router.push(to); return; }
    }
    if (res.error) setMsg({ ok: false, text: res.error });
    else if (mode === "register") setMsg({ ok: true, text: t("Cuenta creada. Revisa tu correo si se requiere confirmación.") });
    else if (mode === "recover") setMsg({ ok: true, text: t("Te enviamos un enlace de recuperación.") });
  }

  /*
   * F64 · LA PUERTA DEL JUEGO, no un formulario de web. Mismo formulario (mismos campos, mismo envío, mismos textos de
   * pestaña que usan las pruebas E2E), con la geometría de la casa: panel en chaflán, campos `nx-field` con etiqueta y
   * `autocomplete`, error anunciado (`role="alert"`) con un temblor corto, y el botón principal del sistema.
   */
  // Temblor corto al fallar, reiniciando la clase SIN volver a montar el formulario (el foco se queda donde estaba).
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const f = formRef.current;
    if (!f || !msg || msg.ok) return;
    f.classList.remove("nx-shake");
    void f.offsetWidth;
    f.classList.add("nx-shake");
  }, [msg]);
  const HEAD: Record<Mode, { title: string; line: string }> = {
    login: { title: t("Entra en NEXUS"), line: t("Tu colección, tus equipos y tu progreso te esperan en el servidor.") },
    register: { title: t("Crea tu cuenta"), line: t("Recibirás tus sobres de bienvenida y créditos para empezar.") },
    recover: { title: t("Recupera tu acceso"), line: t("Te enviamos un enlace para elegir una contraseña nueva.") },
  };
  const bad = msg && !msg.ok;
  return (
    <div className="nx-f63-stage mx-auto w-full max-w-md px-5 py-6 sm:px-7 sm:py-7" data-testid="auth-panel" data-mode={mode}>
      <p className="nx-label !text-[11px] text-drl-glow">{t("Cuenta NEXUS")}</p>
      <h2 className="mt-1 font-display text-[clamp(26px,4vw,34px)] font-extrabold uppercase leading-none text-white">{td(HEAD[mode].title)}</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-white/65">{td(HEAD[mode].line)}</p>

      <div className="mt-5 grid grid-cols-3 gap-1 bg-black/30 p-1 nx-clip-sm" role="group" aria-label={t("Acceso")}>
        {([
          ["login", t("Entrar")],
          ["register", t("Registro")],
          ["recover", t("Recuperar")],
        ] as [Mode, string][]).map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => { setMode(m); setMsg(null); }}
            className={cn(
              "nx-clip-sm nx-press min-h-[40px] px-2 font-display text-[12px] font-bold uppercase tracking-[0.14em] transition-colors",
              mode === m ? "bg-drl text-white" : "text-white/55 hover:bg-white/[0.06] hover:text-white",
            )}
          >
            {td(label)}
          </button>
        ))}
      </div>

      {/* Formulario de verdad: pulsar Intro en cualquier campo envía, que es lo que
          todo el mundo hace por reflejo al escribir la contraseña. */}
      <form ref={formRef} className="mt-4 space-y-3" onSubmit={submit}>
        {mode === "register" && (
          <label className="block">
            <span className="nx-label mb-1 block !text-[10px] text-white/55">{t("Nombre de jugador")}</span>
            <input className="nx-field" autoComplete="username" placeholder={t("Cómo te verán los demás")} required minLength={SIGNUP_NAME_MIN} maxLength={SIGNUP_NAME_MAX} value={username} onChange={(e) => setUsername(e.target.value)} data-testid="signup-name" />
            <span className="mt-1 block text-[12px] text-white/45">{t("De {min} a {max} caracteres. Se le añade un sufijo corto para que sea único.", { min: SIGNUP_NAME_MIN, max: SIGNUP_NAME_MAX })}</span>
          </label>
        )}
        <label className="block">
          <span className="nx-label mb-1 block !text-[10px] text-white/55">{t("Correo electrónico")}</span>
          <input className="nx-field" type="email" autoComplete="email" placeholder={t("tu@correo.com")} aria-invalid={bad ? true : undefined} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== "recover" && (
          <label className="block">
            <span className="nx-label mb-1 block !text-[10px] text-white/55">{t("Contraseña")}</span>
            <input className="nx-field" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder={t("Contraseña")} aria-invalid={bad ? true : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === "register" && <span className="mt-1 block text-[12px] text-white/45">{t("Al menos {n} caracteres.", { n: SIGNUP_PASSWORD_MIN })}</span>}
          </label>
        )}

        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-[14px]", msg.ok ? "text-drl-cyan" : "text-drl-glow")}>{td(msg.text)}</p>
        )}

        <NxButton type="submit" variant="primary" size="lg" block disabled={busy} aria-busy={busy}>
          {busy ? t("Un momento…") : mode === "login" ? t("Entrar") : mode === "register" ? t("Crear cuenta") : t("Enviar enlace")}
        </NxButton>
      </form>
    </div>
  );
}
