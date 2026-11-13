/**
 * Link the host packages the plugin imports at runtime.
 *
 * They are peer dependencies on purpose: a plugin must share the host's single
 * copy of `LlmAdapter`, or `instanceof` checks in the registry fail. npm cannot
 * install a package that is also declared as a peer (it assumes the consumer
 * provides it), so local development and CI link them from an installed DSH
 * checkout instead.
 *
 * Resolution order: $DSH_PACKAGES, then the globally installed CLI.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const WANTED = ["dsh-llm", "dsh-tools", "dsh-credentials", "dsh-web", "cordis", "schemastery"];

function candidates() {
  const out = [];
  if (process.env.DSH_PACKAGES) out.push(process.env.DSH_PACKAGES);

  try {
    const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    out.push(join(root, "@deepseek-ai/dsh/node_modules/@deepseek-ai"));
  } catch {
    // No global npm root: fall through to the home-relative guesses.
  }

  if (process.env.DSH_HOME) out.push(join(process.env.DSH_HOME, "node_modules/@deepseek-ai"));
  return out;
}

const source = candidates().find((dir) => {
  try {
    return existsSync(dir) && readdirSync(dir).includes("dsh-llm");
  } catch {
    return false;
  }
});

if (!source) {
  console.error(
    "找不到 DSH 的包目录。装一个 dsh（npm i -g @deepseek-ai/dsh）或用 DSH_PACKAGES 指向其 @deepseek-ai 目录。",
  );
  process.exit(1);
}

const target = join(process.cwd(), "node_modules", "@deepseek-ai");
mkdirSync(target, { recursive: true });

let linked = 0;
for (const name of WANTED) {
  const from = join(source, name);
  if (!existsSync(from)) continue;
  const to = join(target, name);
  rmSync(to, { force: true, recursive: true });
  symlinkSync(from, to, "dir");
  linked += 1;
}

console.log(`已链接 ${linked} 个宿主包 ← ${source}`);
