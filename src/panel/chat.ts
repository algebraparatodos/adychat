/**
 * Un turno de conversación con el modelo.
 *
 * gpt-6-luna por la API de Responses, con la clave de OpenAI del dueño (la
 * paga él). Aunque pague él, lleva techo: un día y un mes en euros, que se
 * comprueban ANTES de cada llamada. Un bucle que se desboque se para solo
 * en vez de aparecer en su factura.
 *
 * Dentro del turno se le devuelven al modelo todos sus pasos, razonamiento
 * cifrado incluido (con `store: false` es la única forma de que siga el
 * hilo entre una herramienta y la siguiente). Entre turnos sólo se guarda
 * el texto: las tablas de números viejas no se vuelven a pagar.
 */

import { eur, regionName } from "../shared/actions.ts";
import { limitsOf, timeZoneOf } from "../shared/env.ts";
import { TOOLS, runTool, type ToolEnv } from "./tools.ts";
import { getKnowledge, touchChat } from "./chats.ts";
import { GUIA_OBJETIVOS } from "./guia.ts";

export type ChatEnv = ToolEnv & {
  OPENAI_API_KEY: string;
  AI_DAILY_EUR: string;
  AI_MONTHLY_EUR: string;
  /** Los datos fijos del negocio para el asistente: qué vende, precios, dónde, qué mide el píxel. */
  BUSINESS_FACTS?: string;
  /** De qué tienen que hablar los textos de los anuncios. Opcional. */
  COPY_HINTS?: string;
};

export const MODEL = "gpt-6-luna";
/** Por millón de tokens, en dólares. Lo mismo que cuenta meta-ads-agent. */
const PRICE = { input: 0.1, output: 0.5 };
const USD_TO_EUR = 0.92;
const MAX_STEPS = 8;
const MAX_OUTPUT = 4000;
const HISTORY = 16;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function system(env: ChatEnv, knowledge: string): string {
  const limits = limitsOf(env);
  const now = new Date().toLocaleString("es-ES", { timeZone: timeZoneOf(env), dateStyle: "full", timeStyle: "short" });
  return `Eres el guía de publicidad del dueño de ${env.BRAND_NAME}. El dueño sabe mucho de su negocio y muy poco de anuncios: tu trabajo es llevarlo de la mano para crear, controlar y entender sus anuncios de Instagram.

El negocio: ${env.BUSINESS_FACTS?.trim() || "todavía no hay datos fijos del negocio cargados; pregúntale al dueño qué vende, a qué precio y a quién."} Su web: ${env.SITE_URL}. Vende sólo en ${regionName(env.COUNTRY)} (código ${env.COUNTRY}). Las campañas de ventas optimizan por Purchase.

Ahora es ${now} (zona horaria ${timeZoneOf(env)}). Topes de la cuenta: ${eur(limits.maxAdSetDailyEur)} al día por conjunto y ${eur(limits.maxAccountDailyEur)} al día sumando todo lo encendido.

Reglas fijas que no se discuten:
- Los anuncios salen SÓLO en Instagram (feed, historias y reels). Nunca Facebook ni Threads. Si el dueño pide otra cosa, explícale que así está decidido para su negocio.
- Cada anuncio tiene SU material. El dueño crea un anuncio en «Anuncios en preparación» con «+ Nuevo anuncio» y ahí sube las fotos o vídeos de ese anuncio. Míralo siempre con ver_material y usa sólo el material de ese anuncio. El dueño trabaja en varias conversaciones: ver_material sólo enseña el material de ESTA conversación.
- Nada cambia en Meta hasta que el dueño pulsa Confirmar en la tarjeta. Proponer (herramientas proponer_*) no es hacer: nunca digas que algo está hecho. Si pregunta si se aplicó, míralo con ver_acciones.
- Las tarjetas que crean anuncios traen el botón «Ver cómo queda»: enseña el anuncio tal como lo dibuja Meta en Instagram (Feed, Historias y Reels), con el texto cortado donde lo corta Instagram. Al proponer un anuncio, invítale a mirarlo antes de confirmar; si quiere cambiar algo, haz una propuesta nueva con el cambio. Tú no ves esa vista previa: no describas cómo se ve.
- Los datos salen SIEMPRE de las herramientas. Nunca inventes cifras, id ni estados.
- El presupuesto lo decide SIEMPRE el dueño. Antes de proponer una campaña o un cambio de presupuesto, pregúntale cuánto quiere gastar al día y usa exactamente esa cifra. No le sugieras una cifra ni un reparto, ni siquiera como ejemplo. Si pasa de un tope, dile cuál es el tope y pregúntale de nuevo.

Cómo guías:
- Castellano claro y cercano, frases cortas. Cero jerga sin explicar: si dices «público», «CTR» o «coste por compra», explícalo en una línea la primera vez.
- Vas paso a paso y preguntas una cosa por vez cuando necesitas algo de él. Para crear un anuncio el orden es: 1) qué quiere conseguir y para quién es; 2) que suba el material al anuncio si todavía no lo hizo; 3) le propones el público (zona, edad, intereses relacionados con lo que vende) explicando por qué; 4) le escribes 2 o 3 opciones de texto y titular para que elija o te pida cambios; 5) le preguntas cuánto quiere gastar al día; 6) haces la propuesta y le explicas que se crea apagada y que después la enciende.
- Recomiendas con criterio, no das menús vacíos: di qué harías tú y por qué, y deja que decida.
- Los textos los escribes tú: cortos, concretos, ${env.COPY_HINTS?.trim() || "que hablen de lo que vende, de lo que lo hace distinto y del precio"}. Nada de promesas que no se puedan cumplir.
- Cuando mire resultados, dile en palabras normales qué va bien, qué va mal y qué harías; si hay pocos datos (pocos días, pocas compras), dilo con los números delante.
- Si algo falla, explica el error de Meta en palabras normales y qué haría falta.

Lo que sabes de Meta Ads, para acompañarlo (es tu contexto; no se lo recites entero, úsalo cuando toque):

${GUIA_OBJETIVOS}

${knowledge
    ? `Lo que el dueño te cuenta de su marca (sección «Conocimiento» del panel). Es tu contexto para escribir los textos, elegir el tono y proponer públicos. Si choca con los datos del negocio de arriba, pregúntale cuál vale antes de usarlo:
<conocimiento>
${knowledge}
</conocimiento>`
    : `El dueño todavía no escribió nada en «Conocimiento» (menú de la izquierda). Cuando vayas a escribir textos o a proponer un público, sugiérele una vez que cuente ahí qué vende, a qué precios, a quién le vende y cómo quiere hablar en los anuncios: así los textos salen con su voz.`}`;
}

async function spent(db: D1Database): Promise<{ day: number; month: number }> {
  const d = today();
  const row = await db
    .prepare(
      `select coalesce(sum(case when day = ? then cost_eur else 0 end), 0) as day,
              coalesce(sum(cost_eur), 0) as month
         from ai_usage where day like ?`,
    )
    .bind(d, `${d.slice(0, 7)}%`)
    .first<{ day: number; month: number }>();
  return { day: Number(row?.day ?? 0), month: Number(row?.month ?? 0) };
}

async function record(db: D1Database, usage: { input_tokens?: number; output_tokens?: number } | undefined): Promise<void> {
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const cost = ((input / 1e6) * PRICE.input + (output / 1e6) * PRICE.output) * USD_TO_EUR;
  await db
    .prepare(`insert into ai_usage (day, input_tokens, output_tokens, cost_eur) values (?, ?, ?, ?)`)
    .bind(today(), input, output, cost)
    .run();
}

type Item = Record<string, unknown> & { type?: string };

export type TurnResult = { reply: string; proposed: string[] };

export async function turn(env: ChatEnv, chatId: number, userText: string): Promise<TurnResult> {
  if (!env.OPENAI_API_KEY) {
    return { reply: "El chat todavía no tiene la clave de OpenAI. En cuanto esté cargada, funciona.", proposed: [] };
  }

  const history = await env.DB.prepare(`select role, content from messages where chat_id = ? order by id desc limit ?`)
    .bind(chatId, HISTORY)
    .all<{ role: "user" | "assistant"; content: string }>();
  const input: Item[] = (history.results ?? []).reverse().map((m) => ({ role: m.role, content: m.content }));
  input.push({ role: "user", content: userText });
  await env.DB.prepare(`insert into messages (chat_id, role, content) values (?, 'user', ?)`).bind(chatId, userText).run();
  await touchChat(env.DB, chatId, userText);
  const instructions = system(env, (await getKnowledge(env.DB)).content);

  const proposed: string[] = [];
  let reply = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const money = await spent(env.DB);
    if (money.day >= Number(env.AI_DAILY_EUR) || money.month >= Number(env.AI_MONTHLY_EUR)) {
      reply = `Se alcanzó el tope de gasto del asistente (${eur(Number(env.AI_DAILY_EUR))} al día, ${eur(Number(env.AI_MONTHLY_EUR))} al mes). La pestaña Resultados sigue funcionando.`;
      break;
    }

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        instructions,
        input,
        tools: TOOLS.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false })),
        reasoning: { effort: "low" },
        max_output_tokens: MAX_OUTPUT,
        store: false,
        include: ["reasoning.encrypted_content"],
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.error("[chat] openai", res.status, detail);
      // Sin saldo no es un error pasajero: reintentar no sirve y hay que
      // decirle qué hacer.
      reply = detail.includes("insufficient_quota")
        ? "La cuenta de OpenAI se quedó sin saldo. Carga crédito en platform.openai.com → Billing y el chat vuelve a funcionar. La pestaña Resultados sigue funcionando."
        : `No pude hablar con OpenAI (${res.status}). Prueba otra vez en un momento.`;
      break;
    }
    const body = (await res.json()) as { output?: Item[]; usage?: { input_tokens?: number; output_tokens?: number } };
    // Se apunta antes de mirar la respuesta: aunque venga rota, costó.
    await record(env.DB, body.usage);

    const output = body.output ?? [];
    input.push(...output);

    const calls = output.filter((o) => o.type === "function_call");
    if (calls.length === 0) {
      reply = output
        .filter((o) => o.type === "message")
        .flatMap((o) => (o["content"] as { type: string; text?: string }[] | undefined) ?? [])
        .filter((c) => c.type === "output_text")
        .map((c) => c.text ?? "")
        .join("\n")
        .trim();
      break;
    }

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(String(call["arguments"] ?? "{}")) as Record<string, unknown>;
      } catch {
        args = {};
      }
      const out = await runTool(env, String(call["name"]), args, proposed, chatId);
      input.push({ type: "function_call_output", call_id: call["call_id"], output: JSON.stringify(out) });
    }
  }

  if (!reply) {
    reply = proposed.length > 0 ? "Te dejé la propuesta abajo para que la confirmes." : "No llegué a una respuesta. ¿Me lo dices de otra forma?";
  }
  const saved = proposed.length > 0 ? `${reply}\n\n[propuestas: ${proposed.join(", ")}]` : reply;
  await env.DB.prepare(`insert into messages (chat_id, role, content) values (?, 'assistant', ?)`).bind(chatId, saved).run();
  return { reply, proposed };
}
