import { readFileSync } from "node:fs";

import { createServer } from "vite";

const configUrl = new URL("../evals/phase1.1/live-config.example.json", import.meta.url);
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

try {
  const evalModule = await vite.ssrLoadModule("/src/evals/phase11Eval.ts");
  const config = evalModule.parsePhase11LiveConfig(readFileSync(configUrl, "utf8"));
  if (config.readyForPaidRuns) {
    throw new Error("The committed example config must never be marked ready for paid runs.");
  }

  const callsPerScenarioRepetition = config.strategies.reduce(
    (total, strategy) => total + (evalModule.isSingleCallStrategy(strategy) ? 1 : 2),
    0,
  );
  const plannedCalls = config.scenarios.length * config.repetitions * callsPerScenarioRepetition;
  if (plannedCalls > config.limits.maxCalls) {
    throw new Error(`Committed experiment needs ${String(plannedCalls)} calls but maxCalls is ${String(config.limits.maxCalls)}.`);
  }

  process.stdout.write(`${JSON.stringify({
    status: "pass",
    liveCallsMade: 0,
    model: config.provider.model,
    scenarios: config.scenarios.map((scenario) => ({ id: scenario.id, challenge: scenario.challenge })),
    strategies: config.strategies,
    repetitions: config.repetitions,
    plannedCalls,
    limits: config.limits,
  }, null, 2)}\n`);
} finally {
  await vite.close();
}
