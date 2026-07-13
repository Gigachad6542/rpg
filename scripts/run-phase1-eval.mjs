import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const corpusUrl = new URL("../evals/phase1/corpus.jsonl", import.meta.url);
const baselineUrl = new URL("../evals/phase1/baseline.json", import.meta.url);
const pricingUrl = new URL("../evals/phase1/pricing.json", import.meta.url);
const manifestUrl = new URL("../evals/phase1/manifest.json", import.meta.url);
const updateArtifacts = process.argv.includes("--update-artifacts") || process.argv.includes("--update-baseline");
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

try {
  const evalModule = await vite.ssrLoadModule("/src/evals/phase1Eval.ts");
  const pricingRaw = readFileSync(pricingUrl, "utf8");
  const pricing = evalModule.parsePhase1PricingManifest(pricingRaw);
  const recordedTurns = await evalModule.recordDeterministicPhase1Corpus(pricing);
  const recordedCorpusRaw = evalModule.serializePhase1EvalCorpus(recordedTurns);

  if (!updateArtifacts) {
    const committedCorpusRaw = readFileSync(corpusUrl, "utf8");
    if (committedCorpusRaw !== recordedCorpusRaw) {
      throw new Error(
        "Phase 1 corpus does not match a fresh credential-free runtime recording. Review runtime changes, then run pnpm eval:phase1:update.",
      );
    }
  }

  const turns = evalModule.validateRecordedPhase1Corpus(
    evalModule.parsePhase1EvalCorpusJsonl(recordedCorpusRaw),
    pricing,
  );
  const provenance = evalModule.createPhase1EvalProvenance(recordedCorpusRaw, pricingRaw);
  const scorecard = evalModule.scorePhase1EvalCorpus(turns, provenance);
  evalModule.assertPhase1EvalReleaseThresholds(scorecard);
  const baselineRaw = `${JSON.stringify(scorecard, null, 2)}\n`;
  const manifestRaw = `${JSON.stringify(evalModule.createPhase1ArtifactManifest(turns, provenance), null, 2)}\n`;

  if (updateArtifacts) {
    writeAtomic(corpusUrl, recordedCorpusRaw);
    writeAtomic(baselineUrl, baselineRaw);
    writeAtomic(manifestUrl, manifestRaw);
    process.stdout.write(`Updated ${fileURLToPath(corpusUrl)}, ${fileURLToPath(baselineUrl)}, and ${fileURLToPath(manifestUrl)}\n`);
  } else {
    if (readFileSync(baselineUrl, "utf8") !== baselineRaw) {
      throw new Error("Phase 1 scorecard drifted from the committed baseline. Review the diff, then run pnpm eval:phase1:update.");
    }
    if (readFileSync(manifestUrl, "utf8") !== manifestRaw) {
      throw new Error("Phase 1 artifact provenance drifted from the committed manifest.");
    }
    process.stdout.write(baselineRaw);
  }
} finally {
  await vite.close();
}

function writeAtomic(url, contents) {
  const target = fileURLToPath(url);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, contents, { encoding: "utf8", flag: "w" });
  renameSync(temporary, target);
}
