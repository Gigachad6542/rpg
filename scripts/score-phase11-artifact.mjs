import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createServer } from "vite";

const artifactPath = readArgument("--artifact");
const configPath = readOptionalArgument("--config");
const judgmentsPath = readOptionalArgument("--judgments");
const outputPath = readOptionalArgument("--output");
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

try {
  const evalModule = await vite.ssrLoadModule("/src/evals/phase11Eval.ts");
  let artifact = evalModule.parsePhase11LiveArtifact(readFileSync(resolve(artifactPath), "utf8"));
  if (configPath) {
    artifact = evalModule.regradePhase11LiveArtifact(
      evalModule.parsePhase11LiveConfig(readFileSync(resolve(configPath), "utf8")),
      artifact,
    );
  }
  if (judgmentsPath) {
    artifact = evalModule.applyPhase11QualityJudgments(
      artifact,
      readFileSync(resolve(judgmentsPath), "utf8"),
    );
  }
  if (outputPath) writeJsonAtomically(outputPath, artifact);
  process.stdout.write(`${JSON.stringify(evalModule.scorePhase11LiveArtifact(artifact), null, 2)}\n`);
} finally {
  await vite.close();
}

function writeJsonAtomically(path, value) {
  const target = resolve(path);
  const temporary = `${target}.tmp`;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "w" });
  renameSync(temporary, target);
}

function readArgument(name) {
  const value = readOptionalArgument(name);
  if (!value) throw new Error(`Missing required ${name} path.`);
  return value;
}

function readOptionalArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`);
  return value;
}
