"use client";

/**
 * COACH CREATOR — creación del entrenador (Career Fase 1/7).
 *
 * Al comenzar la carrera el usuario CREA su entrenador: nombre, avatar, país, idioma,
 * estilo, especialidad, personalidad, biografía y objetivo personal. Llama a
 * `useManagerStore.create` (que orquesta el motor puro `@/career`).
 */
import { useState } from "react";
import { useManagerStore } from "@/store/useManagerStore";
import { PERSONALITY_LABEL } from "@/career";
import type { CoachStyle, CoachSpecialty, CoachPersonalityId, Region } from "@/career";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("career");

const AVATARS = ["🧑‍🏫", "🧔", "👨‍💼", "👩‍💼", "🧑‍💻", "👨‍🎤", "🦊", "🐉", "🦅", "🐺", "🎯", "🧠"];
const REGIONS: { id: Region; label: string }[] = [
  { id: "EMEA", label: "EMEA" },
  { id: "Americas", label: "Américas" },
  { id: "Pacific", label: "Pacífico" },
  { id: "China", label: "China" },
];
const STYLES: { id: CoachStyle; label: string; hint: string }[] = [
  { id: "aggressive", label: "Agresivo", hint: "Ritmo alto, presión constante" },
  { id: "control", label: "Control", hint: "Mapa lento, disciplina férrea" },
  { id: "tactical", label: "Táctico", hint: "Lectura y anti-strats" },
  { id: "balanced", label: "Equilibrado", hint: "Adaptable a todo" },
  { id: "developer", label: "Formador", hint: "Construye estrellas desde cero" },
  { id: "motivator", label: "Motivador", hint: "Gestiona la mente del equipo" },
];
const SPECIALTIES: { id: CoachSpecialty; label: string }[] = [
  { id: "aim", label: "Mecánicas" },
  { id: "igl", label: "Liderazgo / IGL" },
  { id: "strategy", label: "Estrategia" },
  { id: "psychology", label: "Psicología" },
  { id: "scouting", label: "Scouting" },
  { id: "management", label: "Gestión" },
];
const PERSONALITIES = Object.entries(PERSONALITY_LABEL) as [CoachPersonalityId, string][];

export function CoachCreator() {
  useLocale();
  const create = useManagerStore((s) => s.create);
  const [name, setName] = useState("");
  const [age, setAge] = useState(32);
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState<Region>("EMEA");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [language, setLanguage] = useState("es");
  const [style, setStyle] = useState<CoachStyle>("tactical");
  const [specialty, setSpecialty] = useState<CoachSpecialty>("strategy");
  const [personality, setPersonality] = useState<CoachPersonalityId>("analytical");
  const [bio, setBio] = useState("");
  const [personalGoal, setPersonalGoal] = useState(() => t("Construir una dinastía mundial"));
  const [team, setTeam] = useState("");

  const valid = name.trim().length >= 2 && country.trim().length >= 2;

  const submit = () => {
    if (!valid) return;
    create({ name, age, country, region, avatar, bio, language, style, specialty, personality, personalGoal, team: team.trim() || undefined });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <p className="font-display text-xs uppercase tracking-[0.25em] text-drl">{t("Career · Fase 1")}</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-white">{t("Crea tu entrenador")}</h1>
        <p className="mt-1 text-sm text-white/50">{t("Tú eres el protagonista. Tu carrera puede durar décadas.")}</p>
      </header>

      <div className="space-y-6 rounded-2xl border border-white/10 bg-base-800/60 p-6">
        {/* Avatar */}
        <Field label={t("Avatar")}>
          <div className="flex flex-wrap gap-2">
            {AVATARS.map((a) => (
              <button
                key={a}
                onClick={() => setAvatar(a)}
                className={cn("grid h-11 w-11 place-items-center rounded-xl border text-2xl transition",
                  avatar === a ? "border-drl bg-drl/15" : "border-white/10 bg-base-700/50 hover:border-white/30")}
              >
                {td(a)}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Nombre")}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Alex Rivera")}
              className="w-full rounded-lg border border-white/10 bg-base-900/60 px-3 py-2 text-white outline-none focus:border-drl" />
          </Field>
          <Field label={t("País")}>
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder={t("España")}
              className="w-full rounded-lg border border-white/10 bg-base-900/60 px-3 py-2 text-white outline-none focus:border-drl" />
          </Field>
          <Field label={t("Edad: {age}", { age })}>
            <input type="range" min={18} max={70} value={age} onChange={(e) => setAge(Number(e.target.value))} className="w-full accent-drl" />
          </Field>
          <Field label={t("Idioma")}>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-base-900/60 px-3 py-2 text-white outline-none focus:border-drl">
              <option value="es">{t("Español")}</option>
              <option value="en">{t("English")}</option>
              <option value="pt">{t("Português")}</option>
              <option value="ko">한국어</option>
            </select>
          </Field>
        </div>

        <Field label={t("Región")}>
          <Choices options={REGIONS.map((r) => ({ id: r.id, label: r.label }))} value={region} onChange={(v) => setRegion(v as Region)} />
        </Field>

        <Field label={t("Estilo")}>
          <div className="grid gap-2 sm:grid-cols-3">
            {STYLES.map((s) => (
              <button key={s.id} onClick={() => setStyle(s.id)}
                className={cn("rounded-xl border p-3 text-left transition",
                  style === s.id ? "border-drl bg-drl/15" : "border-white/10 bg-base-700/40 hover:border-white/30")}>
                <p className="font-display text-sm text-white">{td(s.label)}</p>
                <p className="mt-0.5 text-[11px] text-white/45">{td(s.hint)}</p>
              </button>
            ))}
          </div>
        </Field>

        <Field label={t("Especialidad")}>
          <Choices options={SPECIALTIES} value={specialty} onChange={(v) => setSpecialty(v as CoachSpecialty)} />
        </Field>

        <Field label={t("Personalidad")}>
          <Choices options={PERSONALITIES.map(([id, label]) => ({ id, label }))} value={personality} onChange={(v) => setPersonality(v as CoachPersonalityId)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Equipo inicial (opcional)")}>
            <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder={t("Madrid Vipers")}
              className="w-full rounded-lg border border-white/10 bg-base-900/60 px-3 py-2 text-white outline-none focus:border-drl" />
          </Field>
          <Field label={t("Objetivo personal (vitalicio)")}>
            <input value={personalGoal} onChange={(e) => setPersonalGoal(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-base-900/60 px-3 py-2 text-white outline-none focus:border-drl" />
          </Field>
        </div>

        <Field label={t("Biografía")}>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder={t("Tu historia...")}
            className="w-full resize-none rounded-lg border border-white/10 bg-base-900/60 px-3 py-2 text-white outline-none focus:border-drl" />
        </Field>

        <button onClick={submit} disabled={!valid}
          className={cn("w-full rounded-xl py-3 font-display text-sm font-bold uppercase tracking-wide transition",
            valid ? "bg-drl text-white shadow-glow hover:brightness-110" : "cursor-not-allowed bg-white/10 text-white/30")}>
          {t("Firmar primer contrato")}
        </button>
        {!valid && <p className="text-center text-xs text-white/40">{t("Introduce al menos nombre y país.")}</p>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  useLocale();
  return (
    <label className="block">
      <span className="mb-1.5 block font-display text-xs uppercase tracking-wider text-white/45">{td(label)}</span>
      {children}
    </label>
  );
}

function Choices<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  useLocale();
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={cn("rounded-lg border px-3 py-1.5 text-sm transition",
            value === o.id ? "border-drl bg-drl/15 text-white" : "border-white/10 bg-base-700/40 text-white/60 hover:border-white/30")}>
          {td(o.label)}
        </button>
      ))}
    </div>
  );
}
