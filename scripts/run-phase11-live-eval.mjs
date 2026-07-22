import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createServer } from "vite";

const acknowledgement = "--i-understand-this-makes-paid-calls";
if (!process.argv.includes(acknowledgement)) {
  throw new Error(`Refusing live provider calls without ${acknowledgement}.`);
}

const configPath = readArgument("--config");
const outputPath = readArgument("--output");
const reviewOutputPath = readOptionalArgument("--review-output");
const strategyFilter = readCsvArgument("--strategies");
const scenarioFilter = readCsvArgument("--scenarios");
const repetitions = readIntegerArgument("--repetitions");
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

try {
  const [evalModule, runnerModule] = await Promise.all([
    vite.ssrLoadModule("/src/evals/phase11Eval.ts"),
    vite.ssrLoadModule("/src/evals/phase11LiveRunner.ts"),
  ]);
  const config = evalModule.parsePhase11LiveConfig(readFileSync(resolve(configPath), "utf8"));
  const artifact = await runnerModule.runPhase11LiveExperiment(config, {
    environment: process.env,
    ...(strategyFilter ? { strategyFilter } : {}),
    ...(scenarioFilter ? { scenarioFilter } : {}),
    ...(repetitions ? { repetitions } : {}),
  });
  writeJsonAtomically(outputPath, artifact);
  if (reviewOutputPath) {
    writeJsonAtomically(reviewOutputPath, evalModule.buildPhase11ReviewPacket(config, artifact));
  }
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

function readCsvArgument(name) {
  const value = readOptionalArgument(name);
  return value?.split(",").map((item) => item.trim()).filter(Boolean);
}

function readIntegerArgument(name) {
  const value = readOptionalArgument(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} needs a positive integer.`);
  return parsed;
}
