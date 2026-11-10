"use client";

/**
 * 0067 · /admin/admins — ADMINISTRADORES. Quién es admin, buscar una cuenta por su nombre público y HACER ADMIN /
 * QUITAR ADMIN con confirmación explícita (escribir el nombre exacto de la cuenta; el servidor lo vuelve a comparar).
 *
 * Aquí no se decide nada: el servidor (`/api/admin/admins` → `app_admin_set_admin`) comprueba que eres admin, protege
 * al último administrador, audita GRANT_ADMIN / REVOKE_ADMIN y la BD rechaza cualquier otro camino. Sin correos.
 */
import { useRef, useState } from "react";
import { useAdminQuery, adminPost, dateTime, useDebounced } from "@/components/admin/cc/api";
import { PageHeader, Panel, Pill, Loading, ErrorBox, DataTable, Button, SearchBox, Empty, ConfirmDialog } from "@/components/admin/cc/ui";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("admin");

interface Account { userId: string; username: string; avatar: string; isAdmin: boolean; tag: string | null }
interface RosterRow extends Account { grantedAt: string | null; grantedBy: string | null; self: boolean }
interface Roster { admins: RosterRow[]; count: number }
interface Pending { kind: "grant" | "revoke"; account: Account; self: boolean }

/** 0068 · se confirma escribiendo el TAG exacto (permanente e inequívoco); una cuenta sin tag (antes de 0068), su nombre. */
const confirmText = (a: Account): string => (a.tag ? `#${a.tag}` : a.username);
const TagCode = ({ tag }: { tag: string | null }) => (tag ? <code className="text-[12px] tracking-[0.08em] text-ink-faint" data-field="account-tag">#{tag}</code> : null);

export default function AdminsPage() {
  useLocale();
  const roster = useAdminQuery<Roster>("/api/admin/admins");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 300);
  const search = useAdminQuery<{ query: string; accounts: Account[] }>(q.length >= 2 ? `/api/admin/admins?q=${encodeURIComponent(q)}` : null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /* Cerrojo SÍNCRONO: dos clics en el mismo fotograma llegan antes de que `busy` se repinte (medido en la QA real: el
     servidor absorbía el segundo como ALREADY_ADMIN, pero la pantalla decía «ya era administrador»). */
  const inFlight = useRef(false);

  const count = roster.data?.count ?? 0;
  const open = (kind: "grant" | "revoke", account: Account) => {
    setError(null); setReason("");
    setPending({ kind, account, self: roster.data?.admins.some((a) => a.self && a.userId === account.userId) ?? false });
  };

  async function confirm() {
    if (!pending || busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try {
      const r = await adminPost<{ code: string; username: string; admins: number }>("/api/admin/admins", {
        action: pending.kind, userId: pending.account.userId, confirm: confirmText(pending.account), ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      const msg = r.code === "GRANTED" ? t("{username} ahora es administrador.", { username: r.username }) : r.code === "REVOKED" ? t("{username} ya no es administrador.", { username: r.username })
        : r.code === "ALREADY_ADMIN" ? t("{username} ya era administrador (sin cambios).", { username: r.username }) : t("{username} ya no era administrador (sin cambios).", { username: r.username });
      setPending(null); setDone(msg);
      // Te has quitado a ti mismo: el panel deja de ser tuyo en la próxima petición. Se sale ya.
      if (pending.self && r.code === "REVOKED") { window.location.assign("/"); return; }
      roster.reload(); search.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("No se pudo completar la operación"));
    } finally { inFlight.current = false; setBusy(false); }
  }

  const action = (a: Account, self = false) => a.isAdmin
    ? <Button variant="danger" size="sm" disabled={count <= 1} title={count <= 1 ? t("Es el único administrador: no se puede quitar") : undefined} onClick={() => open("revoke", a)} data-action="revoke">{self ? t("Quitarme admin") : t("Quitar admin")}</Button>
    : <Button size="sm" onClick={() => open("grant", a)} data-action="grant">{t("Hacer admin")}</Button>;

  return (
    <>
      <PageHeader eyebrow={t("Control")} title={t("Administradores")}
        description={t("Quién puede entrar en este panel. Conceder o quitar admin se confirma escribiendo el nombre de la cuenta, queda auditado (GRANT_ADMIN / REVOKE_ADMIN) y el servidor nunca deja el sistema sin administradores.")} />
      {done && <p role="status" className="mb-4 rounded-card border border-ok/40 bg-ok/10 px-3 py-2 text-[13px] text-ink-primary" data-testid="admins-done">{td(done)}</p>}
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel title={t("Administradores actuales{v}", { v: roster.data ? ` · ${count}` : "" })} tone="cyan">
          {roster.error && <ErrorBox error={td(roster.error)} onRetry={roster.reload} />}
          {!roster.data && !roster.error && <Loading rows={3} />}
          {roster.data && (
            <DataTable caption={t("Administradores")} rows={roster.data.admins} rowKey={(r) => r.userId} empty={t("Ninguno")}
              cols={[
                { key: "u", label: t("Cuenta"), render: (r) => <span className="flex flex-wrap items-center gap-2"><span aria-hidden>{r.avatar}</span><b className="text-ink-primary">{r.username}</b><TagCode tag={r.tag} />{r.self && <Pill tone="cyan">{t("Tú")}</Pill>}</span> },
                { key: "g", label: t("Concedido"), render: (r) => r.grantedAt ? `${dateTime(r.grantedAt)} · ${r.grantedBy ?? "—"}` : <span className="text-ink-faint">{t("antes de este panel")}</span> },
                { key: "a", label: "", align: "right", render: (r) => action(r, r.self) },
              ]} />
          )}
          {count === 1 && <p className="mt-3 text-[12px] text-ink-muted">{t("Solo hay un administrador: no se puede quitar hasta que haya otro.")}</p>}
        </Panel>

        <Panel title={t("Buscar una cuenta")}>
          <SearchBox value={query} onChange={setQuery} placeholder={t("Nombre (mín. 2 letras) o #TAG exacto")} label={t("Buscar por nombre de usuario o tag")} />
          <p className="mt-2 text-[12px] text-ink-faint">{t("Por nombre público o por #TAG exacto. No se busca ni se muestra el correo.")}</p>
          <div className="mt-3">
            {q.length < 2 ? <Empty title={t("Escribe un nombre")}>{t("Busca la cuenta por su nombre de usuario.")}</Empty>
              : search.error ? <ErrorBox error={td(search.error)} onRetry={search.reload} />
              : !search.data ? <Loading rows={2} />
              : (
                <DataTable caption={t("Resultados")} rows={search.data.accounts} rowKey={(r) => r.userId} empty={t("Ninguna cuenta con ese nombre")}
                  cols={[
                    { key: "u", label: t("Cuenta"), render: (r) => <span className="flex flex-wrap items-center gap-2"><span aria-hidden>{r.avatar}</span><b className="text-ink-primary">{r.username}</b><TagCode tag={r.tag} /></span> },
                    { key: "s", label: t("Estado"), render: (r) => r.isAdmin ? <Pill tone="cyan">{t("Admin")}</Pill> : <Pill>{t("Jugador")}</Pill> },
                    { key: "a", label: "", align: "right", render: (r) => action(r, roster.data?.admins.some((x) => x.self && x.userId === r.userId) ?? false) },
                  ]} />
              )}
          </div>
        </Panel>
      </div>

      <ConfirmDialog
        open={!!pending}
        onClose={() => { if (!busy) setPending(null); }}
        onConfirm={() => void confirm()}
        title={pending?.kind === "grant" ? t("Hacer administrador") : pending?.self ? t("Quitarte el acceso de administrador") : t("Quitar administrador")}
        risk="CRITICAL"
        confirmLabel={pending?.kind === "grant" ? t("Hacer admin") : t("Quitar admin")}
        busy={busy}
        error={td(error)}
        typeToConfirm={pending ? confirmText(pending.account) : undefined}
      >
        {pending && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-card border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px]" data-testid="confirm-account">
            <dt className="text-ink-muted">{t("Cuenta")}</dt><dd className="font-semibold text-ink-primary [overflow-wrap:anywhere]">{pending.account.username}</dd>
            {pending.account.tag && <><dt className="text-ink-muted">{t("Tag")}</dt><dd><code className="tracking-[0.1em] text-ink-primary">#{pending.account.tag}</code></dd></>}
          </dl>
        )}
        {pending?.kind === "grant" ? (
          <p>{fill(t("{cuenta} podrá entrar en este panel y hacer TODO lo que hace un administrador: sanciones, créditos, contenido, publicación y dar o quitar admin.", slots("cuenta")), { cuenta: <b className="text-ink-primary">{pending.account.username}</b> })}</p>
        ) : pending?.self ? (
          <p>{t("Vas a quitarte tu propio acceso. Saldrás del panel en cuanto se confirme y otro administrador tendrá que devolvértelo.")}</p>
        ) : (
          <p>{fill(t("{cuenta} dejará de tener acceso al panel en su próxima petición.", slots("cuenta")), { cuenta: <b className="text-ink-primary">{pending?.account.username}</b> })}</p>
        )}
        <label className="block text-[12px] text-ink-muted" htmlFor="admin-reason">{t("Motivo (opcional, queda en la auditoría)")}</label>
        <textarea id="admin-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} rows={2}
          className="w-full rounded-card border border-white/15 bg-black/30 px-3 py-2 text-[13px] text-ink-primary" />
      </ConfirmDialog>
    </>
  );
}
