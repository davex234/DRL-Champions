"use client";

/**
 * F58 · /admin/users/[id] — FICHA 360.
 *
 * Todo lo que se ve sale de `user360` (servidor, columnas nombradas, sin secretos). Las acciones sensibles viven en
 * dos zonas separadas: «Operaciones» (créditos y concesiones) y «Zona peligrosa» (sanciones). Ninguna se ejecuta con
 * un clic: todas abren un diálogo con resumen, motivo obligatorio y confirmación; el resultado lo decide el servidor.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAdminQuery, adminPost, newGestureRef, fmt, dateTime, dateOnly } from "@/components/admin/cc/api";
import { PageHeader, Panel, KV, Stat, Pill, Loading, ErrorBox, Empty, Button, ConfirmDialog, Field, Input, Select, Textarea, DataTable, LevelBadge } from "@/components/admin/cc/ui";
import { ActivityList, type AuditItem } from "@/components/admin/cc/Activity";
import { useAuth } from "@/lib/supabase/auth";
import { PACKS } from "@/data/packs";
import { getCard } from "@/data/catalog";
import { packLifecycle } from "@/domain/packs/lifecycle";
import { SUSPENSION_HOURS, REASON_MIN } from "@/domain/admin/sanctions";
import { CREDIT_ADJUST_MAX, previewAdjust } from "@/domain/admin/credits";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("admin");

interface Sanction { id: string; type: "ban" | "suspension"; reason: string; created_at: string; expires_at: string | null; revoked_at: string | null; revoke_reason: string | null; status: "ACTIVE" | "EXPIRED" | "REVOKED"; createdByName: string | null; revokedByName: string | null }
interface U360 {
  identity: { id: string; username: string; email: string | null; createdAt: string | null; lastSignInAt: string | null; lastSeenAt: string | null; confirmedAt: string | null; provider: string | null; isAdmin: boolean; tag: string | null };
  progress: { level: number; xp: number; points: number; credits: number };
  collection: { cards: number; distinct: number; favorites: number };
  packs: { unopened: { packId: string; name: string; qty: number }[]; opened: number };
  decks: { decks: number; hasActive: boolean };
  competitive: { rating: number; games: number; wins: number; losses: number; draws: number } | null;
  season: { passes: { seasonId: string; xp: number; level: number | null }[] };
  modes: { campaignNodes: number; draftRuns: number; coachMatches: number };
  ledger: { at: string; delta: number; reason: string; balanceAfter: number; ref: string | null }[];
  sanctions: Sanction[];
  activity: AuditItem[];
}

type Dialog = null | "credits" | "grant" | "sanction" | "revoke";

export default function UserPage() {
  useLocale();
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const q = useAdminQuery<U360>(`/api/admin/users?id=${encodeURIComponent(id)}`);
  const { user } = useAuth();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const u = q.data;
  const active = u?.sanctions.find((s) => s.status === "ACTIVE") ?? null;
  const isSelf = !!user && user.id === id;
  const done = (msg: string) => { setDialog(null); setFlash(msg); q.reload(); };

  return (
    <>
      <PageHeader eyebrow={t("Usuario")} title={u?.identity.username ?? t("Ficha de usuario")}
        description={u ? <span className="flex flex-wrap items-center gap-2">{u.identity.tag && <code className="text-[13px] font-semibold text-ink-secondary" data-field="user-tag">#{u.identity.tag}</code>}<code className="text-[12px] text-ink-faint">{u.identity.id}</code>{u.identity.isAdmin && <Pill tone="drl">{t("administrador")}</Pill>}{active ? <LevelBadge level="CRITICAL" label={active.type === "ban" ? t("Baneado") : t("Suspendido")} /> : <LevelBadge level="HEALTHY" label={t("Sin sanción")} />}</span> : null}
        actions={<Link href="/admin/users" className="nx-focus text-[13px] text-ink-muted hover:text-ink-primary">{t("← Usuarios")}</Link>} />
      {flash && <div role="status" className="mb-4 rounded-card border border-ok/35 bg-ok/[0.07] px-4 py-2.5 text-[13px] text-ink-secondary">✔ {td(flash)}</div>}
      {q.error && <ErrorBox error={td(q.error)} onRetry={q.reload} />}
      {!u && !q.error && <Loading rows={8} />}
      {u && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Stat label={t("Créditos")} value={fmt(u.progress.credits)} accent="gold" />
            <Stat label={t("Nivel")} value={fmt(u.progress.level)} hint={t("{xp} XP · {points} pts", { xp: fmt(u.progress.xp), points: fmt(u.progress.points) })} accent="cyan" />
            <Stat label={t("Colección")} value={fmt(u.collection.cards)} hint={t("{distinct} distintas · {favorites} favoritas", { distinct: fmt(u.collection.distinct), favorites: fmt(u.collection.favorites) })} accent="drl" />
            <Stat label={t("Sobres")} value={fmt(u.packs.opened)} hint={t("abiertos · {v} sin abrir", { v: fmt(u.packs.unopened.reduce((a, p) => a + p.qty, 0)) })} />
            <Stat label={t("Competitivo")} value={u.competitive ? fmt(u.competitive.rating) : "—"} hint={u.competitive ? t("{games} partidas · {wins}V {losses}D {draws}E", { games: u.competitive.games, wins: u.competitive.wins, losses: u.competitive.losses, draws: u.competitive.draws }) : t("Sin rating")} accent="ok" />
            <Stat label={t("Mazos")} value={fmt(u.decks.decks)} hint={u.decks.hasActive ? t("con mazo activo") : t("sin mazo activo")} />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title={t("Identidad")}>
              <KV items={[[t("Email"), u.identity.email], [t("Proveedor"), u.identity.provider], [t("Registro"), dateTime(u.identity.createdAt)], [t("Email confirmado"), dateTime(u.identity.confirmedAt)], [t("Último acceso"), dateTime(u.identity.lastSignInAt)], [t("Última actividad"), dateTime(u.identity.lastSeenAt)]]} />
              <p className="mt-4 text-[11px] text-ink-faint">{t("Nunca se muestran contraseñas, hashes ni tokens: el servidor no los lee.")}</p>
            </Panel>
            <Panel title={t("Juego")}>
              <KV items={[
                [t("Sobres sin abrir"), u.packs.unopened.length ? u.packs.unopened.map((p) => `${p.qty}× ${p.name}`).join(" · ") : t("Ninguno")],
                [t("Pase de temporada"), u.season.passes.length ? u.season.passes.map((p) => `${p.seasonId}: ${fmt(p.xp)} XP`).join(" · ") : t("Sin pase")],
                [t("Road to Champions"), `${u.modes.campaignNodes} nodos`], [t("Draft Gauntlet"), `${u.modes.draftRuns} runs`],
                [t("Tactical Coach"), `${u.modes.coachMatches} partidos`], [t("Competitivo"), u.competitive ? t("{rating} · {games} partidas", { rating: u.competitive.rating, games: u.competitive.games }) : "—"],
              ]} />
            </Panel>
          </div>

          <Panel title={t("Libro mayor")} subtitle={t("Últimos 20 movimientos de créditos (credit_transactions)")}>
            <DataTable caption={t("Movimientos de créditos")} rows={u.ledger} rowKey={(r) => `${r.at}:${r.ref}:${r.delta}`} empty={t("Sin movimientos")}
              cols={[
                { key: "at", label: t("Fecha"), render: (r) => dateTime(r.at) },
                { key: "d", label: t("Cambio"), align: "right", render: (r) => <span className={r.delta >= 0 ? "text-ok" : "text-bad"}>{r.delta >= 0 ? "+" : ""}{fmt(r.delta)}</span> },
                { key: "b", label: t("Saldo"), align: "right", render: (r) => fmt(r.balanceAfter) },
                { key: "r", label: t("Motivo"), render: (r) => <span className="text-ink-muted">{td(r.reason)}</span> },
              ]} />
          </Panel>

          <Panel title={t("Operaciones administrativas")} subtitle={t("Movimientos por el libro mayor y concesiones canónicas: todo queda auditado")} tone="gold"
            actions={<div className="flex gap-2"><Button variant="gold" size="sm" onClick={() => setDialog("credits")}>{t("Ajustar créditos")}</Button><Button variant="cyan" size="sm" onClick={() => setDialog("grant")}>{t("Conceder contenido")}</Button></div>}>
            <p className="text-[13px] text-ink-muted">{fill(t("Añadir o retirar créditos pasa por {rpc} (libro mayor + auditoría, con el saldo que estás viendo como referencia). Conceder un sobre o una carta usa {award}, el mismo camino que las recompensas del juego.", slots("rpc", "award")), { rpc: <code>app_admin_adjust_credits</code>, award: <code>award()</code> })}</p>
          </Panel>

          <Panel title={t("Sanciones")} subtitle={t("Historial completo")}>
            {u.sanctions.length === 0 ? <Empty title={t("Sin sanciones")} /> : (
              <ul className="space-y-2">
                {u.sanctions.map((s) => (
                  <li key={s.id} className="rounded-card border border-white/[0.07] px-3 py-2.5 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2"><LevelBadge level={s.status === "ACTIVE" ? "CRITICAL" : "INFO"} label={s.status === "ACTIVE" ? t("Activa") : s.status === "REVOKED" ? t("Revocada") : t("Caducada")} /><Pill>{s.type === "ban" ? t("Ban") : t("Suspensión")}</Pill><span className="text-ink-faint">{t("{inicio} → {fin} · por {autor}", { inicio: dateTime(s.created_at), fin: s.expires_at ? dateTime(s.expires_at) : t("permanente"), autor: td(s.createdByName) ?? "—" })}</span></div>
                    <p className="mt-1 text-ink-secondary">«{td(s.reason)}»</p>
                    {s.revoked_at && <p className="mt-1 text-[12px] text-ink-faint">{t("Revocada {fecha} por {autor}: «{motivo}»", { fecha: dateTime(s.revoked_at), autor: td(s.revokedByName) ?? "—", motivo: td(s.revoke_reason) ?? "" })}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t("Actividad administrativa")} subtitle={t("Acciones de administradores sobre esta cuenta")}>
            <ActivityList items={u.activity} empty={t("Ninguna acción administrativa sobre esta cuenta.")} />
          </Panel>

          <section aria-labelledby="danger" className="rounded-panel border-2 border-dashed border-bad/40 bg-bad/[0.03] p-5">
            <h2 id="danger" className="font-display text-[15px] font-bold uppercase tracking-[0.14em] text-bad">{t("Zona peligrosa")}</h2>
            <p className="mt-1 text-[13px] text-ink-muted">{t("Una sanción bloquea en el servidor todas las acciones que modifican el juego (sobres, economía, partidas, matchmaking, competitivo, social, pick'ems). Puede seguir entrando y ver su colección.")}</p>
            {isSelf ? <p className="mt-3 text-[13px] text-warn">{t("▲ Es tu propia cuenta: el servidor impide que te sanciones.")}</p>
              : u.identity.isAdmin ? <p className="mt-3 text-[13px] text-warn">{t("▲ Es otro administrador: el servidor impide sancionarlo.")}</p>
                : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {active ? <Button variant="ghost" onClick={() => setDialog("revoke")}>{t("Revocar sanción activa")}</Button> : <Button variant="danger" onClick={() => setDialog("sanction")}>{t("Suspender o banear…")}</Button>}
                  </div>
                )}
          </section>
        </div>
      )}
      {u && dialog === "credits" && <CreditsDialog u={u} onClose={() => setDialog(null)} onDone={done} />}
      {u && dialog === "grant" && <GrantDialog u={u} onClose={() => setDialog(null)} onDone={done} />}
      {u && dialog === "sanction" && <SanctionDialog u={u} onClose={() => setDialog(null)} onDone={done} />}
      {u && dialog === "revoke" && active && <RevokeDialog u={u} sanction={active} onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}

function useSubmit() {
  useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : t("Error")); } finally { setBusy(false); } };
  return { busy, error, run };
}

function CreditsDialog({ u, onClose, onDone }: { u: U360; onClose: () => void; onDone: (m: string) => void }) {
  useLocale();
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const ref = useMemo(newGestureRef, []);
  const s = useSubmit();
  const n = Number(amount);
  const valid = Number.isInteger(n) && n >= 1 && n <= CREDIT_ADJUST_MAX;
  const pv = valid ? previewAdjust(u.progress.credits, { direction, amount: n }) : null;
  return (
    <ConfirmDialog open title={t("Ajustar créditos de {username}", { username: u.identity.username })} risk="HIGH" confirmLabel={direction === "add" ? t("Añadir créditos") : t("Retirar créditos")} busy={s.busy} error={td(s.error)}
      canConfirm={valid && !!pv?.ok && reason.trim().length >= REASON_MIN} onClose={onClose}
      onConfirm={() => s.run(async () => {
        const r = await adminPost<{ repeated: boolean; balanceAfter: number }>("/api/admin/users", { action: "adjust_credits", userId: u.identity.id, direction, amount: n, reason, expectedBalance: u.progress.credits, ref });
        onDone(r.repeated ? t("Esa operación ya estaba aplicada (no se repitió).") : t("Saldo actualizado: {balanceAfter} créditos.", { balanceAfter: fmt(r.balanceAfter) }));
      })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Operación")} htmlFor="cr-dir"><Select id="cr-dir" value={direction} onChange={(e) => setDirection(e.target.value as "add" | "remove")}><option value="add">{t("Añadir")}</option><option value="remove">{t("Retirar")}</option></Select></Field>
        <Field label={t("Cantidad")} htmlFor="cr-amt" hint={`1 – ${fmt(CREDIT_ADJUST_MAX)}`}><Input id="cr-amt" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, "").slice(0, 7))} /></Field>
      </div>
      <Field label={t("Motivo (queda en el registro)")} htmlFor="cr-why" hint={t("Mínimo {REASON_MIN} caracteres", { REASON_MIN })}><Textarea id="cr-why" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="grid grid-cols-3 gap-2 rounded-card border border-white/10 bg-black/20 p-3 text-center">
        <div><p className="text-[11px] uppercase text-ink-faint">{t("Saldo actual")}</p><p className="font-display text-lg text-ink-primary">{fmt(u.progress.credits)}</p></div>
        <div><p className="text-[11px] uppercase text-ink-faint">{t("Cambio")}</p><p className={`font-display text-lg ${pv && pv.delta < 0 ? "text-bad" : "text-ok"}`}>{pv ? `${pv.delta > 0 ? "+" : ""}${fmt(pv.delta)}` : "—"}</p></div>
        <div><p className="text-[11px] uppercase text-ink-faint">{t("Saldo final")}</p><p className="font-display text-lg text-ink-primary">{pv ? fmt(pv.after) : "—"}</p></div>
      </div>
      {pv && !pv.ok && <p className="text-[12px] text-bad">{t("▲ El saldo quedaría en negativo.")}</p>}
      <p className="text-[12px] text-ink-faint">{t("Si el saldo cambia antes de confirmar, el servidor rechaza la operación y tendrás que revisarla de nuevo.")}</p>
    </ConfirmDialog>
  );
}

function GrantDialog({ u, onClose, onDone }: { u: U360; onClose: () => void; onDone: (m: string) => void }) {
  useLocale();
  const packs = PACKS.filter((p) => packLifecycle(p) !== "DRAFT");
  const [kind, setKind] = useState<"pack" | "card">("pack");
  const [packId, setPackId] = useState(packs[0]?.id ?? "");
  const [count, setCount] = useState("1");
  const [cardId, setCardId] = useState("");
  const [reason, setReason] = useState("");
  const ref = useMemo(newGestureRef, []);
  const s = useSubmit();
  const card = kind === "card" ? getCard(cardId.trim()) : undefined;
  const n = Number(count);
  const valid = kind === "pack" ? Number.isInteger(n) && n >= 1 && n <= 10 && !!packId : !!card;
  return (
    <ConfirmDialog open title={t("Conceder a {username}", { username: u.identity.username })} risk="HIGH" confirmLabel={t("Conceder")} busy={s.busy} error={td(s.error)}
      canConfirm={valid && reason.trim().length >= REASON_MIN} onClose={onClose}
      onConfirm={() => s.run(async () => {
        const r = await adminPost<{ applied: boolean }>("/api/admin/users", kind === "pack" ? { action: "grant", userId: u.identity.id, kind, packId, count: n, reason, ref } : { action: "grant", userId: u.identity.id, kind, cardId: card!.id, reason, ref });
        onDone(r.applied ? t("Concesión aplicada.") : t("Esa concesión ya estaba aplicada (no se repitió)."));
      })}>
      <Field label={t("Qué")} htmlFor="gr-kind"><Select id="gr-kind" value={kind} onChange={(e) => setKind(e.target.value as "pack" | "card")}><option value="pack">{t("Sobre")}</option><option value="card">{t("Carta")}</option></Select></Field>
      {kind === "pack" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <Field label={t("Sobre")} htmlFor="gr-pack"><Select id="gr-pack" value={packId} onChange={(e) => setPackId(e.target.value)}>{packs.map((p) => <option key={p.id} value={p.id}>{p.name} ({packLifecycle(p)})</option>)}</Select></Field>
          <Field label={t("Cantidad")} htmlFor="gr-n" hint="1–10"><Input id="gr-n" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, "").slice(0, 2))} /></Field>
        </div>
      ) : (
        <Field label={t("Id de la carta")} htmlFor="gr-card" hint={card ? t("{id} · OVR {ovr}", { id: card.id, ovr: card.ovr }) : t("p. ej. mada__moments")} error={cardId && !card ? t("No existe en el catálogo") : null}><Input id="gr-card" value={cardId} onChange={(e) => setCardId(e.target.value.slice(0, 80))} /></Field>
      )}
      <Field label={t("Motivo (queda en el registro)")} htmlFor="gr-why" hint={t("Mínimo {REASON_MIN} caracteres", { REASON_MIN })}><Textarea id="gr-why" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
      <p className="text-[12px] text-ink-faint">{fill(t("Se entrega con el mecanismo canónico ({award}): idempotente, queda en el libro mayor y en la auditoría.", slots("award")), { award: <code>award()</code> })}</p>
    </ConfirmDialog>
  );
}

function SanctionDialog({ u, onClose, onDone }: { u: U360; onClose: () => void; onDone: (m: string) => void }) {
  useLocale();
  const [type, setType] = useState<"suspension" | "ban">("suspension");
  const [duration, setDuration] = useState<string>("24");
  const [reason, setReason] = useState("");
  const s = useSubmit();
  const permanent = type === "ban" && duration === "permanent";
  return (
    <ConfirmDialog open title={type === "ban" ? t("Banear a {username}", { username: u.identity.username }) : t("Suspender a {username}", { username: u.identity.username })} risk={permanent ? "CRITICAL" : "HIGH"}
      confirmLabel={type === "ban" ? t("Banear") : t("Suspender")} busy={s.busy} error={td(s.error)} typeToConfirm={u.identity.username}
      canConfirm={reason.trim().length >= REASON_MIN} onClose={onClose}
      onConfirm={() => s.run(async () => {
        await adminPost("/api/admin/moderation", { action: "sanction", userId: u.identity.id, type, reason, hours: permanent ? null : Number(duration) });
        onDone(type === "ban" ? t("Usuario baneado.") : t("Usuario suspendido."));
      })}>
      <div className="rounded-card border border-bad/30 bg-bad/[0.06] px-3 py-2 text-[13px]">{fill(t("Vas a sancionar a {usuario} {id} ({email}).", { ...slots("usuario", "id"), email: u.identity.email ?? t("sin email") }), { usuario: <b className="text-ink-primary">{u.identity.username}</b>, id: <code className="text-[11px] text-ink-faint">{u.identity.id}</code> })}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Tipo")} htmlFor="sa-type"><Select id="sa-type" value={type} onChange={(e) => { setType(e.target.value as "ban" | "suspension"); if (e.target.value === "suspension" && duration === "permanent") setDuration("24"); }}><option value="suspension">{t("Suspensión (temporal)")}</option><option value="ban">{t("Ban")}</option></Select></Field>
        <Field label={t("Duración")} htmlFor="sa-dur"><Select id="sa-dur" value={duration} onChange={(e) => setDuration(e.target.value)}>
          {SUSPENSION_HOURS.map((h) => <option key={h} value={String(h)}>{h < 24 ? `${h} h` : t("{n, plural, one {# día} other {# días}}", { n: h / 24 })}</option>)}
          {type === "ban" && <option value="permanent">{t("Permanente")}</option>}
        </Select></Field>
      </div>
      <Field label={t("Motivo (visible en el registro, no para el jugador)")} htmlFor="sa-why" hint={t("Mínimo {REASON_MIN} caracteres", { REASON_MIN })}><Textarea id="sa-why" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
      <p className="text-[12px] text-ink-faint">{t("Efecto inmediato en el servidor (caché de hasta 15 s en otros procesos). Se puede revocar después con motivo.")}</p>
    </ConfirmDialog>
  );
}

function RevokeDialog({ u, sanction, onClose, onDone }: { u: U360; sanction: Sanction; onClose: () => void; onDone: (m: string) => void }) {
  useLocale();
  const [reason, setReason] = useState("");
  const s = useSubmit();
  return (
    <ConfirmDialog open title={t("Revocar sanción de {username}", { username: u.identity.username })} risk="HIGH" confirmLabel={t("Revocar")} busy={s.busy} error={td(s.error)} canConfirm={reason.trim().length >= REASON_MIN} onClose={onClose}
      onConfirm={() => s.run(async () => { await adminPost("/api/admin/moderation", { action: "revoke", sanctionId: sanction.id, reason }); onDone(t("Sanción revocada.")); })}>
      <p>{t("{tipo} desde {fecha} {fin}: «{motivo}»", { tipo: sanction.type === "ban" ? t("Ban") : t("Suspensión"), fecha: dateOnly(sanction.created_at), fin: sanction.expires_at ? t("hasta {expires_at}", { expires_at: dateTime(sanction.expires_at) }) : t("(permanente)"), motivo: td(sanction.reason) ?? "" })}</p>
      <Field label={t("Motivo de la revocación")} htmlFor="rv-why" hint={t("Mínimo {REASON_MIN} caracteres", { REASON_MIN })}><Textarea id="rv-why" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
    </ConfirmDialog>
  );
}
