/**
 * Genera el valor del secreto PANEL_PASSWORD_HASH. La contraseña se lee de
 * la entrada estándar para que no quede en el historial de la terminal ni
 * en ningún archivo.
 */
import { hashPassword } from "../src/panel/auth.ts";

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
if (!password) {
  console.error("No llegó ninguna contraseña por la entrada estándar.");
  process.exit(1);
}
process.stdout.write(await hashPassword(password));
