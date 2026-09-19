/**
 * Loads local env files for build scripts (same KEY=VALUE format as .env).
 *
 * Priority: existing process.env wins; then .dev.vars (Wrangler
 * convention, shared with the Pages Function runtime); then .env.local;
 * then .env. So `pnpm build` picks up keys kept in `.dev.vars`
 * automatically, no shell `export` needed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip wrapping quotes on either side.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadLocalEnv(root: string) {
  loadEnvFile(join(root, ".dev.vars"));
  loadEnvFile(join(root, ".env.local"));
  loadEnvFile(join(root, ".env"));
}
