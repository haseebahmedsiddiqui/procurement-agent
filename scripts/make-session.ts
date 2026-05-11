import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createSessionToken } from "../src/lib/auth/session";

async function main() {
  const email = process.env.AUTH_EMAIL;
  if (!email) {
    console.error("AUTH_EMAIL not set");
    process.exit(1);
  }
  const token = await createSessionToken(email);
  process.stdout.write(token);
}

main();
