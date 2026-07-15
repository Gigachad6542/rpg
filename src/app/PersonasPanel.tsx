// Persona profile management: create, edit, delete, set default, and attach
// per-persona lorebooks. Rendered inside the Settings section.
import { type ChangeEvent, useState } from "react";
import { BookOpen, Check, PenLine, Plus, Star, Trash2, Upload, UserRound } from "lucide-react";
import type { Lorebook, Persona } from "./runtimeTypes";
import { getErrorMessage } from "./appUtils";
import { parseChubLorebookPayload } from "./lorebookIo";
import { buildEmbeddableAvatarDataUrl } from "./avatarImage";
import { DestructiveActionDialog } from "./DestructiveActionDialog";

export function PersonasPanel(props: {
  personas: Persona[];
  activePersonaId: string;
  selectPersona: (personaId: string) => void;
  addPersona: (name: string) => void;
  editPersona: (personaId: string, changes: Partial<Persona>) => void;
  removePersona: (personaId: string) => void;
  makePersonaDefault: (personaId: string) => void;
}) {
  const [newPersonaName, setNewPersonaName] = useState("");
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [pendingDeletePersona, setPendingDeletePersona] = useState<Persona | null>(null);
  const [personaStatus, setPersonaStatus] = useState(
    "Paste a Chub-compatible lorebook JSON to attach it to this persona.",
  );

  const editingPersona =
    props.personas.find((persona) => persona.id === editingPersonaId) ??
    props.personas.find((persona) => persona.id === props.activePersonaId) ??
    props.personas[0] ??
    null;
  const [lorebookImportDraft, setLorebookImportDraft] = useState("");

  function createPersona() {
    const name = newPersonaName.trim();
    if (!name) {
      return;
    }
    props.addPersona(name);
    setNewPersonaName("");
  }

  async function readAvatar(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || !editingPersona) {
      return;
    }
    try {
      const embedded = await buildEmbeddableAvatarDataUrl(file);
      if (!embedded) {
        setPersonaStatus("Avatar image is too large to store locally. Choose a smaller image.");
        return;
      }
      props.editPersona(editingPersona.id, { avatarDataUrl: embedded.dataUrl });
      setPersonaStatus(
        embedded.downscaled
          ? `Avatar downscaled to fit storage limits and updated for ${editingPersona.name}.`
          : `Avatar updated for ${editingPersona.name}.`,
      );
    } catch (error) {
      setPersonaStatus(getErrorMessage(error));
    } finally {
      input.value = "";
    }
  }

  function importPersonaLorebook() {
    if (!editingPersona) {
      return;
    }
    try {
      const lorebook = parseChubLorebookPayload(lorebookImportDraft);
      props.editPersona(editingPersona.id, { lorebooks: [...editingPersona.lorebooks, lorebook] });
      setLorebookImportDraft("");
      setPersonaStatus(`Attached ${lorebook.name} to ${editingPersona.name}.`);
    } catch (error) {
      setPersonaStatus(getErrorMessage(error));
    }
  }

  function updatePersonaLorebook(lorebookId: string, changes: Partial<Lorebook>) {
    if (!editingPersona) {
      return;
    }
    props.editPersona(editingPersona.id, {
      lorebooks: editingPersona.lorebooks.map((lorebook) =>
        lorebook.id === lorebookId ? { ...lorebook, ...changes } : lorebook,
      ),
    });
  }

  function removePersonaLorebook(lorebookId: string) {
    if (!editingPersona) {
      return;
    }
    props.editPersona(editingPersona.id, {
      lorebooks: editingPersona.lorebooks.filter((lorebook) => lorebook.id !== lorebookId),
    });
  }

  return (
    <>
      <section className="panel" aria-label="Persona profiles">
        <div className="section-title">
          <UserRound size={17} />
          <h3>Personas</h3>
        </div>
        <p className="panel-hint">
          The active persona describes who the player is. Its prompt and lorebooks are sent with every turn without the
          card speaking as you.
        </p>
        <ul className="persona-list">
          {props.personas.map((persona) => (
            <li className={`persona-row ${persona.id === props.activePersonaId ? "active" : ""}`} key={persona.id}>
              <button
                type="button"
                className="persona-select"
                aria-pressed={persona.id === editingPersona?.id}
                onClick={() => setEditingPersonaId(persona.id)}
              >
                {persona.avatarDataUrl ? (
                  <img className="persona-avatar" src={persona.avatarDataUrl} alt="" width={32} height={32} />
                ) : (
                  <span className="persona-avatar persona-avatar-fallback" aria-hidden="true">
                    <UserRound size={16} />
                  </span>
                )}
                <span className="persona-row-body">
                  <span className="persona-row-name">{persona.name}</span>
                  <span className="persona-row-meta">
                    {persona.isDefault ? "default" : "saved"}
                    {persona.lorebooks.length > 0 ? ` · ${persona.lorebooks.length} lorebooks` : ""}
                  </span>
                </span>
              </button>
              <div className="persona-row-actions">
                <button
                  type="button"
                  className="secondary-button compact-button"
                  onClick={() => props.selectPersona(persona.id)}
                  disabled={persona.id === props.activePersonaId}
                  aria-label={`Use ${persona.name}`}
                >
                  <Check size={15} />
                  Use
                </button>
                <button
                  type="button"
                  className="secondary-button compact-button"
                  onClick={() => props.makePersonaDefault(persona.id)}
                  disabled={persona.isDefault}
                  aria-label={`Make ${persona.name} the default persona`}
                >
                  <Star size={15} />
                  Default
                </button>
                <button
                  type="button"
                  className="secondary-button danger-button compact-button"
                  onClick={() => setPendingDeletePersona(persona)}
                  disabled={props.personas.length <= 1}
                  aria-label={`Delete ${persona.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <label className="field">
          <span>New persona name</span>
          <input
            value={newPersonaName}
            onChange={(event) => setNewPersonaName(event.target.value)}
            placeholder="Mara the cartographer"
          />
        </label>
        <button
          className="primary-button compact-button"
          type="button"
          onClick={createPersona}
          disabled={!newPersonaName.trim()}
        >
          <Plus size={16} />
          Create persona
        </button>
      </section>
      {pendingDeletePersona ? (
        <DestructiveActionDialog
          eyebrow="Delete persona"
          title={`Delete ${pendingDeletePersona.name}?`}
          cancelLabel="Cancel deletion"
          confirmLabel="Delete persona"
          cancel={() => setPendingDeletePersona(null)}
          confirm={() => {
            props.removePersona(pendingDeletePersona.id);
            setPendingDeletePersona(null);
          }}
        >
          <p>This removes the persona prompt, avatar, and attached lorebooks from the active runtime.</p>
          <p className="panel-hint">A local restore point is captured immediately before deletion.</p>
        </DestructiveActionDialog>
      ) : null}

      <section className="panel" aria-label="Persona editor">
        <div className="section-title">
          <PenLine size={17} />
          <h3>{editingPersona ? `Edit ${editingPersona.name}` : "Persona editor"}</h3>
        </div>
        {!editingPersona ? (
          <p className="empty-hint">Create a persona to edit it.</p>
        ) : (
          <>
            <label className="field">
              <span>Persona name</span>
              <input
                value={editingPersona.name}
                onChange={(event) => props.editPersona(editingPersona.id, { name: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Persona prompt</span>
              <textarea
                value={editingPersona.description}
                onChange={(event) => props.editPersona(editingPersona.id, { description: event.target.value })}
                rows={8}
                placeholder="Describe the user's persona, point of view, boundaries, or roleplay voice the card should account for."
              />
            </label>
            <label className="field">
              <span>Persona avatar</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void readAvatar(event)} />
            </label>
            {editingPersona.avatarDataUrl ? (
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => props.editPersona(editingPersona.id, { avatarDataUrl: undefined })}
              >
                <Trash2 size={15} />
                Remove avatar
              </button>
            ) : null}

            <div className="section-title">
              <BookOpen size={16} />
              <h4>Persona lorebooks</h4>
            </div>
            {editingPersona.lorebooks.length === 0 ? (
              <p className="empty-hint">No persona lorebooks yet. These fire alongside the card's lorebooks.</p>
            ) : (
              <ul className="persona-lorebook-list">
                {editingPersona.lorebooks.map((lorebook) => (
                  <li className="persona-lorebook-row" key={lorebook.id}>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={lorebook.enabled}
                        onChange={(event) => updatePersonaLorebook(lorebook.id, { enabled: event.target.checked })}
                      />
                      <span>
                        {lorebook.name} · {lorebook.entries.length} entries
                      </span>
                    </label>
                    <button
                      type="button"
                      className="secondary-button danger-button compact-button"
                      onClick={() => removePersonaLorebook(lorebook.id)}
                      aria-label={`Remove ${lorebook.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="field">
              <span>Chub lorebook JSON</span>
              <textarea
                value={lorebookImportDraft}
                onChange={(event) => setLorebookImportDraft(event.target.value)}
                rows={6}
                placeholder='{"name":"My history","entries":[{"keys":["home"],"content":"I grew up on the coast."}]}'
              />
            </label>
            <button
              className="primary-button compact-button"
              type="button"
              onClick={importPersonaLorebook}
              disabled={!lorebookImportDraft.trim()}
            >
              <Upload size={16} />
              Attach lorebook
            </button>
            <p className="status-line" role="status" aria-label="Persona status" aria-live="polite">
              {personaStatus}
            </p>
          </>
        )}
      </section>
    </>
  );
}
