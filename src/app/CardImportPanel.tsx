import { type ChangeEvent, useState } from "react";
import { FileUp, Link2, Sparkles, Upload } from "lucide-react";
import { getErrorMessage } from "./appUtils";
import {
  type ImportedCard,
  fetchChubCharacterCard,
  importCardFromFile,
  importCardFromJsonText,
} from "./cardImport";

const IDLE_HINT =
  "Import a Tavern Card (.png or .json), paste card JSON, or pull a character from Chub.";

export function CardImportPanel(props: { onImportCard: (result: ImportedCard) => void }) {
  const [jsonDraft, setJsonDraft] = useState("");
  const [chubInput, setChubInput] = useState("");
  const [status, setStatus] = useState(IDLE_HINT);
  const [busy, setBusy] = useState(false);

  function announce(result: ImportedCard) {
    props.onImportCard(result);
    const summary = `Imported ${result.card.name}.`;
    setStatus(result.warnings.length > 0 ? `${summary} ${result.warnings.join(" ")}` : summary);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    setBusy(true);
    try {
      announce(await importCardFromFile(file));
    } catch (error) {
      setStatus(getErrorMessage(error));
    } finally {
      setBusy(false);
      input.value = "";
    }
  }

  function handleImportJson() {
    if (!jsonDraft.trim()) {
      setStatus("Paste character card JSON to import it.");
      return;
    }
    try {
      announce(importCardFromJsonText(jsonDraft));
      setJsonDraft("");
    } catch (error) {
      setStatus(getErrorMessage(error));
    }
  }

  async function handleChub() {
    if (!chubInput.trim()) {
      setStatus("Enter a Chub character URL or author/name path.");
      return;
    }
    setBusy(true);
    setStatus(`Fetching ${chubInput.trim()} from Chub...`);
    try {
      announce(await fetchChubCharacterCard(chubInput));
      setChubInput("");
    } catch (error) {
      setStatus(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-import" aria-label="Import character card">
      <div className="section-subtitle">
        <Sparkles size={15} />
        <strong>Import a card</strong>
      </div>

      <label className="field">
        <span>Upload Tavern Card (.png / .json)</span>
        <input
          type="file"
          accept=".png,.json,image/png,application/json"
          disabled={busy}
          onChange={(event) => void handleFile(event)}
        />
      </label>

      <label className="field">
        <span>Paste character card JSON</span>
        <textarea
          value={jsonDraft}
          onChange={(event) => setJsonDraft(event.target.value)}
          rows={5}
          placeholder='{"spec":"chara_card_v2","data":{"name":"Aria","first_mes":"..."}}'
        />
      </label>
      <button className="secondary-button full-width" type="button" onClick={handleImportJson} disabled={busy}>
        <FileUp size={16} />
        Import from JSON
      </button>

      <label className="field">
        <span>Chub URL or author/name</span>
        <input
          value={chubInput}
          onChange={(event) => setChubInput(event.target.value)}
          placeholder="https://chub.ai/characters/author/name"
        />
      </label>
      <button className="secondary-button full-width" type="button" onClick={() => void handleChub()} disabled={busy}>
        <Link2 size={16} />
        Fetch from Chub
      </button>
      <p className="import-hint">Chub fetch works in the desktop app; the browser preview may be blocked by CORS.</p>

      <div className="card-import-status">
        <Upload size={14} />
        <span className="status-line">{status}</span>
      </div>
    </section>
  );
}
