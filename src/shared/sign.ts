/**
 * Direcciones firmadas para que Meta descargue un vídeo del panel.
 *
 * El ejecutor no tiene dirección en internet, así que no puede servir el
 * vídeo; el panel sí. El ejecutor firma `clave.caducidad` con un secreto
 * que comparten los dos Workers (MEDIA_SIGNING_KEY) y el panel sólo
 * entrega el archivo si la firma es buena y no caducó. Sin firma, el
 * material del dueño no se puede descargar de ningún sitio.
 */

const enc = new TextEncoder();

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `base` es la dirección del panel, p. ej. https://example.com/panel */
export async function signedMediaUrl(base: string, key: string, secret: string, ttlSeconds = 3600): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmac(secret, `${key}.${exp}`);
  return `${base}/media/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}

export async function verifyMediaSignature(key: string, exp: string, sig: string, secret: string): Promise<boolean> {
  if (!secret || !/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  const expected = await hmac(secret, `${key}.${exp}`);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
