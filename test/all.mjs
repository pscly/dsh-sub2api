/**
 * Run every suite in one process, reporting a single pass/fail.
 *
 * Each suite already prints its own results; this wrapper only exists so
 * `npm test` and CI agree on what "the tests" means.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const suites = ["smoke.mjs", "edges.mjs", "client-load.mjs"];

let failed = 0;
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const result = spawnSync(process.execPath, [join(here, suite)], { stdio: "inherit" });
  if (result.status !== 0) failed += 1;
}

if (failed > 0) {
  console.error(`\n${failed} 个测试套件失败`);
  process.exit(1);
}
console.log("\n全部测试通过");
