import { randomBytes, scryptSync } from "node:crypto";

const password = process.env.PASSWORD ?? "";
if (password.length < 12) {
  console.error("Set PASSWORD to at least 12 characters. It is read from the environment, not from argv.");
  process.exit(1);
}
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
process.stdout.write(`scrypt$16384$8$1$${salt.toString("hex")}$${hash.toString("hex")}\n`);
