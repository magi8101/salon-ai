import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Single .env lives at the repo root; expose only the browser-safe values.
const env = parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8"));

export default {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY,
  },
};
