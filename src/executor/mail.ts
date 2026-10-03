/**
 * El correo que le avisa al dueño de un contacto nuevo, por Resend con la
 * clave del dueño (la misma cuenta que los correos de la tienda). Va aparte
 * de leads.ts a propósito: ese archivo habla con Meta y sólo lee; éste es
 * el único POST del ejecutor que no va a Meta.
 */

export type MailEnv = {
  RESEND_API_KEY?: string;
  /** Quién manda el aviso: la dirección de la tienda. */
  LEADS_FROM: string;
  /** A quién: el correo del dueño. */
  LEADS_NOTIFY_TO: string;
  /** Zona horaria de las fechas del aviso. Sin poner: Europe/Madrid. */
  TIME_ZONE?: string;
};

export type LeadMail = {
  campaignName: string;
  createdTime: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  /** Las demás respuestas, por si el formulario pregunta algo más. */
  extra: { name: string; value: string }[];
  panelUrl: string;
};

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** La fecha como la lee el dueño, en la zona horaria del negocio. */
export function spanishTime(iso: string, timeZone = "Europe/Madrid"): string {
  const d = new Date(iso.replace(/\+0000$/, "Z"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-ES", { timeZone, dateStyle: "short", timeStyle: "short" });
}

export function leadMail(m: LeadMail, timeZone?: string): { subject: string; text: string; html: string } {
  const when = spanishTime(m.createdTime, timeZone);
  // El asunto distingue cada aviso: con varios en la bandeja no se confunden.
  const subject = `Nuevo contacto: ${m.fullName ?? m.email ?? m.phone ?? "sin nombre"} · ${m.campaignName} · ${when}`;
  const rows: [string, string][] = [
    ["Nombre", m.fullName ?? "—"],
    ["Correo", m.email ?? "—"],
    ["Teléfono", m.phone ?? "—"],
    ...m.extra.map((x): [string, string] => [x.name, x.value]),
    ["Campaña", m.campaignName],
    ["Cuándo", when],
  ];
  const text = [
    "Alguien dejó sus datos en el formulario de un anuncio de Instagram:",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `Lo tienes también en el panel, en Contactos: ${m.panelUrl}`,
  ].join("\n");
  const html =
    `<p>Alguien dejó sus datos en el formulario de un anuncio de Instagram:</p>` +
    `<table cellpadding="4">${rows.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join("")}</table>` +
    `<p>Lo tienes también en el panel, en <a href="${esc(m.panelUrl)}">Contactos</a>.</p>`;
  return { subject, text, html };
}

/** Manda el aviso. Devuelve null si salió, o el motivo si no. */
export async function sendLeadMail(env: MailEnv, m: LeadMail): Promise<string | null> {
  if (!env.RESEND_API_KEY) return "falta RESEND_API_KEY en el ejecutor";
  const mail = leadMail(m, env.TIME_ZONE);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.LEADS_FROM, to: [env.LEADS_NOTIFY_TO], ...mail }),
  });
  if (res.ok) return null;
  return `Resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
}
