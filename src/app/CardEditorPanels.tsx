import { useEffect, useState } from "react";
import { BookOpen, CheckCircle2, ClipboardList, Download, Layers3, Plus, Search } from "lucide-react";
import { LORE_SCAN_SCOPES, getLoreScanScopes } from "../runtime/loreTriggerEngine";
import { type CompiledPrompt } from "../runtime/promptCompiler";
import type {
  Lorebook,
  LorebookEntry,
  LoreMatchMode,
  LoreScanScope,
  NewLorebookEntry,
  NewPlayerRule,
  PlayerRule,
  RuntimeCard,
} from "./runtimeTypes";
import { toBoundedNumber } from "./appUtils";
import { createCustomPlayerRule, filterLorebookEntries, formatEnforcementLabel, getEnabledPlayerRules } from "./cardNormalization";
import { defaultNewLorebookEntry, defaultNewPlayerRule } from "./appDefaults";
import { exportLorebookAsChubJson } from "./lorebookIo";

const KEY_PLACEHOLDERS: Record<LoreMatchMode, string> = {
  literal: "comma or newline separated",
  wildcard: "silver *, gate?",
  regex: "\\bsilver\\s+gates?\\b",
};

const SCOPE_LABELS: Record<LoreScanScope, string> = {
  history: "Chat history",
  draft: "Current message",
  card: "Card definition",
  persona: "Active persona",
  memory: "Card memory",
  rpg: "RPG state",
};

export function InstructionsPanel(props: {
  activeCard: RuntimeCard;
  updateActiveCard: (patch: Partial<RuntimeCard>) => void;
}) {
  return (
    <section className="tab-panel" aria-label="Card instructions">
      <div className="section-title">
        <BookOpen size={17} />
        <h3>Card Instructions</h3>
      </div>
      <div className="instruction-grid">
        <label className="field">
          <span>Name</span>
          <input
            value={props.activeCard.name}
            onChange={(event) => props.updateActiveCard({ name: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Summary</span>
          <input
            value={props.activeCard.summary}
            onChange={(event) => props.updateActiveCard({ summary: event.target.value })}
          />
        </label>
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={props.activeCard.mapEnabled}
          onChange={(event) => props.updateActiveCard({ mapEnabled: event.target.checked })}
        />
        <span>Show map/image panel in runtime</span>
      </label>
      <div className="instruction-grid">
        <label className="field">
          <span>Character name</span>
          <input
            value={props.activeCard.characterName}
            onChange={(event) => props.updateActiveCard({ characterName: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Greeting</span>
          <textarea
            value={props.activeCard.greeting}
            onChange={(event) => props.updateActiveCard({ greeting: event.target.value })}
            rows={3}
          />
        </label>
      </div>
      <label className="field">
        <span>Description</span>
        <textarea
          value={props.activeCard.characterDescription}
          onChange={(event) => props.updateActiveCard({ characterDescription: event.target.value })}
          rows={4}
        />
      </label>
      <label className="field">
        <span>Scenario</span>
        <textarea
          value={props.activeCard.scenario}
          onChange={(event) => props.updateActiveCard({ scenario: event.target.value })}
          rows={4}
        />
      </label>
      <label className="field">
        <span>Example dialogs</span>
        <textarea
          value={props.activeCard.exampleDialogs}
          onChange={(event) => props.updateActiveCard({ exampleDialogs: event.target.value })}
          rows={6}
        />
      </label>
      <label className="field">
        <span>In-depth character definition / system prompt</span>
        <textarea
          value={props.activeCard.systemPrompt}
          onChange={(event) => props.updateActiveCard({ systemPrompt: event.target.value })}
          rows={5}
        />
      </label>
      <div className="instruction-grid">
        <label className="field">
          <span>Pre-history instructions</span>
          <textarea
            value={props.activeCard.preHistoryInstructions}
            onChange={(event) => props.updateActiveCard({ preHistoryInstructions: event.target.value })}
            rows={6}
          />
        </label>
        <label className="field">
          <span>Post-history instructions</span>
          <textarea
            value={props.activeCard.postHistoryInstructions}
            onChange={(event) => props.updateActiveCard({ postHistoryInstructions: event.target.value })}
            rows={6}
          />
        </label>
      </div>
      <ImportedMetadataBlock activeCard={props.activeCard} updateActiveCard={props.updateActiveCard} />
    </section>
  );
}

function ImportedMetadataBlock(props: {
  activeCard: RuntimeCard;
  updateActiveCard: (patch: Partial<RuntimeCard>) => void;
}) {
  const { creator, characterVersion, creatorNotes, importSource } = props.activeCard;
  const tags = props.activeCard.tags ?? [];
  const alternateGreetings = props.activeCard.alternateGreetings ?? [];
  const hasMetadata =
    Boolean(creator || characterVersion || creatorNotes || importSource) ||
    tags.length > 0 ||
    alternateGreetings.length > 0;
  if (!hasMetadata) {
    return null;
  }

  return (
    <section className="card-import-meta" aria-label="Imported card metadata">
      <div className="section-subtitle">
        <strong>Imported metadata</strong>
        {importSource ? <span className="tag-pill">{importSource}</span> : null}
      </div>
      {creator || characterVersion ? (
        <p className="import-meta-line">
          {creator ? <span>Creator: {creator}</span> : null}
          {characterVersion ? <span>Version: {characterVersion}</span> : null}
        </p>
      ) : null}
      {tags.length > 0 ? (
        <div className="import-meta-tags">
          {tags.map((tag) => (
            <span className="tag-pill" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      {creatorNotes ? (
        <label className="field">
          <span>Creator notes</span>
          <textarea value={creatorNotes} rows={3} readOnly />
        </label>
      ) : null}
      {alternateGreetings.length > 0 ? (
        <div className="alt-greetings">
          <span className="field-label">Alternate greetings ({alternateGreetings.length})</span>
          {alternateGreetings.map((greeting, index) => (
            <article className="alt-greeting" key={`${index}-${greeting.slice(0, 16)}`}>
              <p>{greeting.length > 240 ? `${greeting.slice(0, 240)}...` : greeting}</p>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => props.updateActiveCard({ greeting })}
              >
                Use as greeting
              </button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function RulesPanel(props: {
  activeCard: RuntimeCard;
  compiledPrompt: string;
  compiledPromptResult: CompiledPrompt;
  updateActiveCard: (patch: Partial<RuntimeCard>) => void;
}) {
  const [newRule, setNewRule] = useState<NewPlayerRule>(defaultNewPlayerRule);
  const enabledRuleCount = getEnabledPlayerRules(props.activeCard).length;

  function updateRule(ruleId: string, patch: Partial<PlayerRule>) {
    props.updateActiveCard({
      playerRules: props.activeCard.playerRules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch } : rule,
      ),
    });
  }

  function addRule() {
    const title = newRule.title.trim();
    const description = newRule.description.trim();
    if (!title && !description) {
      return;
    }

    props.updateActiveCard({
      playerRules: [
        ...props.activeCard.playerRules,
        createCustomPlayerRule(description || title, title || "Custom player rule"),
      ],
    });
    setNewRule(defaultNewPlayerRule);
  }

  return (
    <section className="tab-panel" aria-label="Card rules">
      <div className="section-title">
        <ClipboardList size={17} />
        <h3>Rules for this card only</h3>
      </div>
      <div className="rule-summary">
        <strong>{enabledRuleCount}</strong>
        <span>enabled player rules</span>
      </div>
      <div className="rule-editor-list">
        {props.activeCard.playerRules.map((rule) => (
          <article className={`rule-editor ${rule.enabled ? "enabled" : "disabled"}`} key={rule.id}>
            <label className="toggle-row rule-toggle">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}
              />
              <span>{rule.enabled ? `${rule.title} enabled` : `${rule.title} disabled`}</span>
            </label>
            <label className="field">
              <span>Player rule title</span>
              <input
                value={rule.title}
                onChange={(event) => updateRule(rule.id, { title: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Card enforcement text</span>
              <textarea
                value={rule.description}
                onChange={(event) => updateRule(rule.id, { description: event.target.value })}
                rows={3}
              />
            </label>
            <span className="enforcement-chip">{formatEnforcementLabel(rule.enforcement)}</span>
          </article>
        ))}
      </div>
      <div className="rule-add-panel">
        <div className="section-title">
          <Plus size={17} />
          <h3>Add Player Rule</h3>
        </div>
        <label className="field">
          <span>Rule title</span>
          <input
            value={newRule.title}
            onChange={(event) => setNewRule({ ...newRule, title: event.target.value })}
            placeholder="No metagame shortcuts"
          />
        </label>
        <label className="field">
          <span>Card enforcement text</span>
          <textarea
            value={newRule.description}
            onChange={(event) => setNewRule({ ...newRule, description: event.target.value })}
            rows={3}
            placeholder="The player cannot use knowledge or actions their character could not plausibly access."
          />
        </label>
        <button className="secondary-button compact-button" type="button" onClick={addRule}>
          <Plus size={16} />
          Add player rule
        </button>
      </div>
      <div className="prompt-debugger" aria-label="Prompt debugger">
        <div className="section-title">
          <Layers3 size={17} />
          <h3>Prompt Debugger</h3>
        </div>
        <div className="prompt-layer-audit" aria-label="Prompt layer audit">
          <span>{props.compiledPromptResult.includedLayers.length} layers included</span>
          <span>{props.compiledPromptResult.omittedLayers.length} omitted</span>
          <span>{props.compiledPromptResult.tokenEstimate} estimated tokens</span>
        </div>
        <pre>{props.compiledPrompt}</pre>
      </div>
    </section>
  );
}

export function LorebooksPanel(props: {
  activeCard: RuntimeCard;
  activeLorebookEntries: LorebookEntry[];
  updateActiveLorebook: (lorebookId: string, patch: Partial<Omit<Lorebook, "id" | "entries">>) => void;
  addLorebookEntry: (lorebookId: string, entry: NewLorebookEntry) => boolean;
  lorebookEntryError: string | null;
}) {
  const [entryDraft, setEntryDraft] = useState<NewLorebookEntry>(defaultNewLorebookEntry);
  const [lorebookSearch, setLorebookSearch] = useState("");
  const [lorebookSource, setLorebookSource] = useState("current-card");
  const [selectedLorebookId, setSelectedLorebookId] = useState("");
  const lorebooks = props.activeCard.lorebooks;
  const selectedLorebook = lorebooks.find((lorebook) => lorebook.id === selectedLorebookId) ?? lorebooks[0] ?? null;
  const filteredEntries = selectedLorebook ? filterLorebookEntries(selectedLorebook.entries, lorebookSearch) : [];

  useEffect(() => {
    if (!selectedLorebookId && lorebooks[0]) {
      setSelectedLorebookId(lorebooks[0].id);
      return;
    }
    if (selectedLorebookId && !lorebooks.some((lorebook) => lorebook.id === selectedLorebookId)) {
      setSelectedLorebookId(lorebooks[0]?.id ?? "");
    }
  }, [lorebooks, selectedLorebookId]);

  function submitEntry() {
    if (props.addLorebookEntry(selectedLorebook?.id ?? "", entryDraft)) {
      setEntryDraft(defaultNewLorebookEntry);
    }
  }

  return (
    <section className="tab-panel" aria-label="Lorebooks">
      <div className="section-title">
        <BookOpen size={17} />
        <h3>Lorebooks</h3>
      </div>

      <div className="lorebook-settings">
        <label className="field">
          <span>Lorebook</span>
          <select
            value={selectedLorebook?.id ?? ""}
            onChange={(event) => setSelectedLorebookId(event.target.value)}
          >
            {lorebooks.length === 0 ? <option value="">No Chub lorebook uploaded</option> : null}
            {lorebooks.map((lorebook) => (
              <option key={lorebook.id} value={lorebook.id}>
                {lorebook.name}
              </option>
            ))}
          </select>
        </label>
        {selectedLorebook ? (
          <>
            <label className="field">
              <span>Lorebook name</span>
              <input
                value={selectedLorebook.name}
                onChange={(event) => props.updateActiveLorebook(selectedLorebook.id, { name: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Scan depth</span>
              <input
                type="number"
                min={1}
                max={30}
                value={selectedLorebook.scanDepth}
                onChange={(event) =>
                  props.updateActiveLorebook(selectedLorebook.id, {
                    scanDepth: toBoundedNumber(event.target.value, 4, 1, 30),
                  })
                }
              />
            </label>
            <label className="field">
              <span>Token budget</span>
              <input
                type="number"
                min={100}
                max={12000}
                value={selectedLorebook.tokenBudget}
                onChange={(event) =>
                  props.updateActiveLorebook(selectedLorebook.id, {
                    tokenBudget: toBoundedNumber(event.target.value, 800, 100, 12_000),
                  })
                }
              />
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={selectedLorebook.enabled}
                onChange={(event) => props.updateActiveLorebook(selectedLorebook.id, { enabled: event.target.checked })}
              />
              <span>Enabled</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={selectedLorebook.recursiveScanning}
                onChange={(event) =>
                  props.updateActiveLorebook(selectedLorebook.id, { recursiveScanning: event.target.checked })
                }
              />
              <span>Recursive scanning</span>
            </label>
          </>
        ) : null}
      </div>

      <div className="lorebook-toolbar" aria-label="Lorebook search and export">
        <label className="field">
          <span>Search lorebook entries</span>
          <div className="search-input">
            <Search size={16} />
            <input
              value={lorebookSearch}
              onChange={(event) => setLorebookSearch(event.target.value)}
              placeholder="Filter by title, key, or content"
              type="search"
            />
          </div>
        </label>
        <label className="field">
          <span>Lorebook source</span>
          <select value={lorebookSource} onChange={(event) => setLorebookSource(event.target.value)}>
            <option value="current-card">Current card lorebook</option>
            <option value="chub-compatible">Chub-compatible export</option>
          </select>
        </label>
        <button
          className="secondary-button export-button"
          type="button"
          onClick={() => selectedLorebook ? exportLorebookAsChubJson(selectedLorebook, props.activeCard) : undefined}
          disabled={!selectedLorebook}
        >
          <Download size={16} />
          Export Chub JSON
        </button>
      </div>

      <div className="lorebook-active" aria-label="Active lorebook entries">
        <strong>{props.activeLorebookEntries.length}</strong>
        <span>active entries for the current draft/history</span>
      </div>

      <div className="lorebook-entry-form">
        <div className="section-title">
          <Plus size={17} />
          <h3>Add Lorebook Entry</h3>
        </div>
        <label className="field">
          <span>Entry title</span>
          <input
            value={entryDraft.title}
            onChange={(event) => setEntryDraft({ ...entryDraft, title: event.target.value })}
          />
        </label>
        <div className="instruction-grid">
          <label className="field">
            <span>Primary keys</span>
            <input
              value={entryDraft.keys}
              onChange={(event) => setEntryDraft({ ...entryDraft, keys: event.target.value })}
              placeholder={KEY_PLACEHOLDERS[entryDraft.matchMode]}
            />
          </label>
          <label className="field">
            <span>Secondary keys</span>
            <input
              value={entryDraft.secondaryKeys}
              onChange={(event) => setEntryDraft({ ...entryDraft, secondaryKeys: event.target.value })}
              placeholder="optional selective trigger"
            />
          </label>
        </div>
        <label className="field">
          <span>Key matching</span>
          <select
            value={entryDraft.matchMode}
            onChange={(event) => setEntryDraft({ ...entryDraft, matchMode: event.target.value as LoreMatchMode })}
          >
            <option value="literal">Literal text</option>
            <option value="wildcard">Wildcard (* and ?)</option>
            <option value="regex">Regular expression</option>
          </select>
        </label>
        <div className="instruction-grid compact-fields">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={entryDraft.caseSensitive}
              onChange={(event) => setEntryDraft({ ...entryDraft, caseSensitive: event.target.checked })}
            />
            <span>Case sensitive</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={entryDraft.wholeWord}
              disabled={entryDraft.matchMode === "regex"}
              onChange={(event) => setEntryDraft({ ...entryDraft, wholeWord: event.target.checked })}
            />
            <span>Whole word</span>
          </label>
        </div>
        <fieldset className="lore-scope-fieldset">
          <legend>Scan scopes</legend>
          {LORE_SCAN_SCOPES.map((scope) => (
            <label className="toggle-row" key={scope}>
              <input
                type="checkbox"
                checked={entryDraft.scanScopes.includes(scope)}
                onChange={(event) =>
                  setEntryDraft({
                    ...entryDraft,
                    scanScopes: event.target.checked
                      ? LORE_SCAN_SCOPES.filter((item) => item === scope || entryDraft.scanScopes.includes(item))
                      : entryDraft.scanScopes.filter((item) => item !== scope),
                  })
                }
              />
              <span>{SCOPE_LABELS[scope]}</span>
            </label>
          ))}
        </fieldset>
        <div className="instruction-grid compact-fields">
          <label className="field">
            <span>Insertion order</span>
            <input
              type="number"
              value={entryDraft.insertionOrder}
              onChange={(event) => setEntryDraft({ ...entryDraft, insertionOrder: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Priority</span>
            <input
              type="number"
              value={entryDraft.priority}
              onChange={(event) => setEntryDraft({ ...entryDraft, priority: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Probability</span>
            <input
              type="number"
              min={0}
              max={100}
              value={entryDraft.probability}
              onChange={(event) => setEntryDraft({ ...entryDraft, probability: event.target.value })}
            />
          </label>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={entryDraft.constant}
            onChange={(event) => setEntryDraft({ ...entryDraft, constant: event.target.checked })}
          />
          <span>Constant entry</span>
        </label>
        <label className="field">
          <span>Entry content</span>
          <textarea
            value={entryDraft.content}
            onChange={(event) => setEntryDraft({ ...entryDraft, content: event.target.value })}
            rows={5}
          />
        </label>
        {props.lorebookEntryError ? (
          <p className="rule-warning" role="alert">
            {props.lorebookEntryError}
          </p>
        ) : null}
        <button className="primary-button compact-button" type="button" onClick={submitEntry}>
          <Plus size={16} />
          Add lorebook entry
        </button>
      </div>

      <div className="lorebook-entry-list">
        {!selectedLorebook ? <p>No Chub lorebook uploaded.</p> : null}
        {selectedLorebook && selectedLorebook.entries.length === 0 ? <p>No lorebook entries yet.</p> : null}
        {selectedLorebook && selectedLorebook.entries.length > 0 && filteredEntries.length === 0 ? <p>No lorebook entries match this search.</p> : null}
        {filteredEntries.map((entry) => (
          <article className="lorebook-entry" key={entry.id}>
            <header>
              <strong>{entry.title}</strong>
              <span>{entry.constant ? "constant" : entry.keys.join(", ") || "manual"}</span>
            </header>
            <p>{entry.content}</p>
            <div className="lorebook-meta">
              <span>order {entry.insertionOrder}</span>
              <span>priority {entry.priority}</span>
              <span>{entry.probability}%</span>
              {entry.matchMode && entry.matchMode !== "literal" ? <span>{entry.matchMode}</span> : null}
              {entry.caseSensitive ? <span>case-sensitive</span> : null}
              {entry.wholeWord ? <span>whole-word</span> : null}
              <span>{getLoreScanScopes(entry).map((scope) => SCOPE_LABELS[scope]).join(", ")}</span>
              {props.activeLorebookEntries.some((activeEntry) => activeEntry.id === entry.id) ? (
                <span className="flag-on">
                  <CheckCircle2 size={14} />
                  active
                </span>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
