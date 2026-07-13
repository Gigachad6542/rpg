import { readFileSync } from "node:fs";

import { createServer } from "vite";

const configUrl = new URL("../evals/phase1.1/live-config.example.json", import.meta.url);
const loreUrl = new URL("../evals/phase1.1/lore-decisions.json", import.meta.url);
const campaignsUrl = new URL("../evals/phase1.1/long-session-campaigns.json", import.meta.url);
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

try {
  const evalModule = await vite.ssrLoadModule("/src/evals/phase11Eval.ts");
  const config = evalModule.parsePhase11LiveConfig(readFileSync(configUrl, "utf8"));
  const lore = evalModule.scoreLoreDecisionCorpus(
    evalModule.parseLoreDecisionCorpus(readFileSync(loreUrl, "utf8")),
  );
  const campaigns = evalModule.parseLongSessionCampaignFixtures(readFileSync(campaignsUrl, "utf8"));
  evalModule.assertLongSessionCampaignCoverage(campaigns);

  if (lore.decisionCount < 80 || lore.decisionCount > 120 || lore.precision < 0.9 || lore.recall < 0.95) {
    throw new Error(`Lore gate failed: ${JSON.stringify(lore)}`);
  }
  if (config.readyForPaidRuns) {
    throw new Error("The committed example config must never be marked ready for paid runs.");
  }

  process.stdout.write(`${JSON.stringify({
    status: "pass",
    liveCallsMade: 0,
    lore,
    campaigns: campaigns.map((campaign) => ({ id: campaign.id, turns: campaign.turns.length })),
    profiles: config.profiles.map((profile) => ({ id: profile.id, class: profile.class })),
  }, null, 2)}\n`);
} finally {
  await vite.close();
}
