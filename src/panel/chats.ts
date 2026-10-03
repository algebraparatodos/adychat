/**
 * Las conversaciones del chat y el «Conocimiento» de la marca.
 *
 * El dueño abre una conversación por tema (normalmente, una campaña). Cada
 * una tiene sus mensajes y su material, y el modelo sólo relee la
 * conversación en la que está.
 *
 * Borrar una conversación (decidido el 30/09/2026):
 * - las propuestas sin confirmar se cancelan;
 * - si hay alguna confirmada que el ejecutor todavía está aplicando, no se
 *   borra: su material hace falta para terminarla;
 * - se borran sus mensajes y su material (KV y filas). Lo que ya se subió
 *   a Meta queda en Meta, y nunca se borra ni se pausa una campaña;
 * - el registro de acciones se conserva: es la historia de la cuenta.
 */

export type ChatsEnv = { DB: D1Database; IMAGES: KVNamespace };

export const KNOWLEDGE_MAX = 8000;
const DEFAULT_TITLE = "Nueva conversación";

export type Chat = { id: number; title: string; updated_at: string };

export async function listChats(db: D1Database): Promise<Chat[]> {
  const rows = await db.prepare(`select id, title, updated_at from chats order by touched desc, id desc`).all<Chat>();
  return rows.results ?? [];
}

export async function createChat(db: D1Database): Promise<Chat> {
  const row = await db.prepare(`insert into chats (title, touched) values (?, (select coalesce(max(touched), 0) + 1 from chats)) returning id, title, updated_at`).bind(DEFAULT_TITLE).first<Chat>();
  if (!row) throw new Error("no se pudo crear la conversación");
  return row;
}

/** La pedida si existe; si no, la última usada; si no hay ninguna, una nueva. */
export async function resolveChat(db: D1Database, requested: unknown): Promise<number> {
  const id = Number(requested);
  if (Number.isInteger(id) && id > 0) {
    const row = await db.prepare(`select id from chats where id = ?`).bind(id).first<{ id: number }>();
    if (row) return row.id;
  }
  const last = await db.prepare(`select id from chats order by touched desc, id desc limit 1`).first<{ id: number }>();
  return last ? last.id : (await createChat(db)).id;
}

/** La conversación sin título toma el comienzo del primer mensaje del dueño. */
export async function touchChat(db: D1Database, chatId: number, userText: string): Promise<void> {
  const firstLine = userText.split("\n")[0]?.trim() ?? "";
  const title = firstLine.length > 48 ? `${firstLine.slice(0, 47).trimEnd()}…` : firstLine;
  await db
    .prepare(
      `update chats set updated_at = datetime('now'), touched = (select coalesce(max(touched), 0) + 1 from chats),
              title = case when title = ? and ? <> '' then ? else title end
        where id = ?`,
    )
    .bind(DEFAULT_TITLE, title, title, chatId)
    .run();
}

export async function deleteChat(env: ChatsEnv, chatId: number): Promise<{ ok: true } | { error: string; status: number }> {
  const chat = await env.DB.prepare(`select id from chats where id = ?`).bind(chatId).first();
  if (!chat) return { error: "Esa conversación no existe.", status: 404 };
  const running = await env.DB.prepare(`select count(*) as n from actions where chat_id = ? and state in ('confirmed', 'running')`)
    .bind(chatId)
    .first<{ n: number }>();
  if (Number(running?.n ?? 0) > 0) {
    return { error: "Hay un cambio de esta conversación aplicándose en Meta. Espera a que termine y bórrala después.", status: 409 };
  }
  await env.DB.prepare(`update actions set state = 'cancelled', state_at = datetime('now') where chat_id = ? and state = 'proposed'`)
    .bind(chatId)
    .run();
  const media = await env.DB.prepare(
    `select m.key, m.kind, m.chunks from media m join ad_drafts d on d.id = m.draft_id where d.chat_id = ?`,
  )
    .bind(chatId)
    .all<{ key: string; kind: string; chunks: number }>();
  for (const m of media.results ?? []) {
    for (let n = 0; n < m.chunks; n++) await env.IMAGES.delete(m.kind === "image" ? m.key : `${m.key}#${n}`);
    await env.DB.prepare(`delete from media where key = ?`).bind(m.key).run();
  }
  await env.DB.prepare(`delete from ad_drafts where chat_id = ?`).bind(chatId).run();
  await env.DB.prepare(`delete from messages where chat_id = ?`).bind(chatId).run();
  await env.DB.prepare(`delete from chats where id = ?`).bind(chatId).run();
  return { ok: true };
}

export async function getKnowledge(db: D1Database): Promise<{ content: string; updated_at: string | null }> {
  const row = await db.prepare(`select content, updated_at from knowledge where id = 1`).first<{ content: string; updated_at: string }>();
  return row ?? { content: "", updated_at: null };
}

export async function saveKnowledge(db: D1Database, content: string): Promise<{ content: string; updated_at: string | null }> {
  const text = content.replace(/\r\n/g, "\n").trim().slice(0, KNOWLEDGE_MAX);
  await db
    .prepare(
      `insert into knowledge (id, content, updated_at) values (1, ?, datetime('now'))
       on conflict (id) do update set content = excluded.content, updated_at = excluded.updated_at`,
    )
    .bind(text)
    .run();
  return getKnowledge(db);
}

/** El dueño le pone el nombre que quiera; a partir de ahí no se toca solo. */
export async function renameChat(db: D1Database, chatId: number, raw: unknown): Promise<Chat | null> {
  const title = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) return null;
  return db
    .prepare(`update chats set title = ? where id = ? returning id, title, updated_at`)
    .bind(title, chatId)
    .first<Chat>();
}
