import { type ChangeEvent, useState } from "react";
import { BookOpen, Download, Layers3, Search, Upload } from "lucide-react";
import type { Lorebook, RuntimeCard } from "./runtimeTypes";
import { getErrorMessage, readFileAsText } from "./appUtils";
import {
  MAX_LOREBOOK_IMPORT_JSON_CHARS,
  exportLorebookAsChubJson,
  parseCompatibleLorebookPayload,
} from "./lorebookIo";

export function GlobalLorebooksSection(props: {
  cards: RuntimeCard[];
  activeCardId: string;
  selectCard: (card: RuntimeCard) => void;
  updateLorebook: (cardId: string, lorebookId: string, lorebook: Lorebook) => void;
  importLorebookToActiveCard: (lorebook: Lorebook) => void;
}) {
  const [query, setQuery] = useState("");
  const [importDraft, setImportDraft] = useState("");
  const [importStatus, setImportStatus] = useState("Paste a SillyTavern, Chub, RisuAI, or Character Card lorebook JSON export.");
  const activeCard = props.cards.find((card) => card.id === props.activeCardId) ?? null;
  const allLorebooks = props.cards.flatMap((card) =>
    card.lorebooks.map((lorebook) => ({
      card,
      lorebook,
    })),
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredLorebooks = normalizedQuery
    ? allLorebooks.filter(({ card, lorebook }) =>
        [
          card.name,
          lorebook.name,
          lorebook.entries.map((entry) => `${entry.title} ${entry.keys.join(" ")} ${entry.content}`).join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : allLorebooks;
  const totalEntries = allLorebooks.reduce((total, item) => total + item.lorebook.entries.length, 0);

  function importLorebookJson() {
    if (!activeCard) {
      setImportStatus("Open a card before importing lorebooks.");
      return;
    }
    try {
      const lorebook = parseCompatibleLorebookPayload(importDraft);
      props.importLorebookToActiveCard(lorebook);
      setImportDraft("");
      setImportStatus(`Imported ${lorebook.name} into ${activeCard.name}.`);
    } catch (error) {
      setImportStatus(getErrorMessage(error));
    }
  }

  async function importChubFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      if (file.size > MAX_LOREBOOK_IMPORT_JSON_CHARS) {
        throw new Error("Lorebook file is too large (maximum 2 MB).");
      }
      const text = await readFileAsText(file);
      setImportDraft(text);
      setImportStatus(`Loaded ${file.name}.`);
    } catch (error) {
      setImportStatus(getErrorMessage(error));
    } finally {
      input.value = "";
    }
  }

  return (
    <div className="workspace-grid lorebook-grid">
      <section className="panel lorebook-library-panel" aria-label="Stored lorebooks">
        <div className="section-title">
          <Layers3 size={17} />
          <h3>Lorebook Library</h3>
        </div>
        <div className="card-library-stats" aria-label="Lorebook stats">
          <span>
            <strong>{allLorebooks.length}</strong>
            lorebooks
          </span>
          <span>
            <strong>{totalEntries}</strong>
            entries
          </span>
          <span>
            <strong>{props.cards.length}</strong>
            cards
          </span>
        </div>
        <label className="field">
          <span>Search stored lorebooks</span>
          <div className="search-input">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find by card, title, key, or content"
              type="search"
            />
          </div>
        </label>
        <div className="lorebook-entry-list">
          {filteredLorebooks.length === 0 ? (
            <p>
              {query.trim()
                ? "No stored lorebooks match this search."
                : "No lorebooks stored yet. Open a card and add lorebook entries to build its world."}
            </p>
          ) : null}
          {filteredLorebooks.map(({ card, lorebook }) => (
            <article className="lorebook-entry" key={`${card.id}:${lorebook.id}`}>
              <header>
                <strong>{lorebook.name}</strong>
                <span>{card.name}</span>
              </header>
              <div className="lorebook-meta">
                <span>{lorebook.entries.length} entries</span>
                <span>scan depth {lorebook.scanDepth}</span>
                <span>{lorebook.enabled ? "enabled" : "disabled"}</span>
                {lorebook.recursiveScanning ? <span>recursive</span> : null}
              </div>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={lorebook.enabled}
                  onChange={(event) =>
                    props.updateLorebook(card.id, lorebook.id, {
                      ...lorebook,
                      enabled: event.target.checked,
                    })
                  }
                />
                <span>Enabled for {card.name}</span>
              </label>
              <div className="lorebook-entry-preview">
                {lorebook.entries.slice(0, 4).map((entry) => (
                  <span key={entry.id}>{entry.title || entry.keys.join(", ") || "Untitled"}</span>
                ))}
                {lorebook.entries.length > 4 ? <span>+{lorebook.entries.length - 4} more</span> : null}
                {lorebook.entries.length === 0 ? <span>No entries yet</span> : null}
              </div>
              <div className="button-row">
                <button className="secondary-button compact-button" type="button" onClick={() => props.selectCard(card)}>
                  <BookOpen size={16} />
                  Open card
                </button>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={() => exportLorebookAsChubJson(lorebook, card)}
                >
                  <Download size={16} />
                  Export Chub JSON
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel lorebook-import-panel" aria-label="Import compatible lorebook">
        <div className="section-title">
          <Upload size={17} />
          <h3>Import Lorebook</h3>
        </div>
        <p>
          {activeCard
            ? (
                <>
                  Imported lorebooks are stored on the active card: <strong>{activeCard.name}</strong>.
                </>
              )
            : "Open a card from the library before importing a lorebook."}
        </p>
        <label className="field">
          <span>Upload lorebook JSON</span>
          <input aria-label="Upload Chub lorebook file or compatible export" type="file" accept=".json,application/json" onChange={(event) => void importChubFile(event)} />
        </label>
        <label className="field">
          <span>Compatible lorebook JSON</span>
          <textarea
            aria-label="Chub lorebook JSON and compatible imports"
            value={importDraft}
            onChange={(event) => setImportDraft(event.target.value)}
            rows={14}
            placeholder='{"name":"World Lore","entries":[{"keys":["gate"],"content":"The old gate remembers every oath."}]}'
          />
        </label>
        <button className="primary-button full-width" type="button" onClick={importLorebookJson} disabled={!activeCard}>
          <Upload size={16} />
          Import to active card
        </button>
        <p className="field-help">Supports SillyTavern World Info, Chub, RisuAI-style entries, and Character Card V2/V3 embedded books. Imported text stays inert and local.</p>
        <p className="status-line">{importStatus}</p>
      </section>
    </div>
  );
}
