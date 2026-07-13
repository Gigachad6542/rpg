import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createServer } from "vite";

const acknowledgement = "--i-understand-this-makes-paid-calls";
if (!process.argv.includes(acknowledgement)) {
  throw new Error(`Refusing live provider calls without ${acknowledgement}.`);
}

const configPath = readArgument("--config");
const outputPath = readArgument("--output");
const judgmentsPath = readOptionalArgument("--judgments");
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

try {
  const [evalModule, runnerModule] = await Promise.all([
    vite.ssrLoadModule("/src/evals/phase11Eval.ts"),
    vite.ssrLoadModule("/src/evals/phase11LiveRunner.ts"),
  ]);
  const config = evalModule.parsePhase11LiveConfig(readFileSync(resolve(configPath), "utf8"));
  let artifact = await runnerModule.runPhase11LiveExperiment(config, { environment: process.env });
  if (judgmentsPath) {
    artifact = evalModule.applyPhase11QualityJudgments(
      artifact,
      readFileSync(resolve(judgmentsPath), "utf8"),
    );
  }

  const target = resolve(outputPath);
  const temporary = `${target}.tmp`;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "w" });
  renameSync(temporary, target);
  process.stdout.write(`${JSON.stringify(evalModule.scorePhase11LiveArtifact(artifact), null, 2)}\n`);
} finally {
  await vite.close();
}

function readArgument(name) {
  const value = readOptionalArgument(name);
  if (!value) {
    throw new Error(`Missing required ${name} path.`);
  }
  return value;
}

function readOptionalArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} needs a path value.`);
  }
  return value;
}
