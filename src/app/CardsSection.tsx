import { useState } from "react";
import { BookOpen, Download, Plus, Settings2, Trash2 } from "lucide-react";
import { type CompiledPrompt } from "../runtime/promptCompiler";
import type { LoreTriggerProvenance } from "../runtime/loreTriggerEngine";
import type {
  CardKind,
  CardTab,
  Lorebook,
  LorebookEntry,
  NewLorebookEntry,
  RpgCardState,
  RuntimeCard,
} from "./runtimeTypes";
import { getEnabledPlayerRules } from "./cardNormalization";
import { defaultNewCard } from "./appDefaults";
import { formatTabLabel, renderTabIcon } from "./RuntimeSection";
import { InstructionsPanel, LorebooksPanel, RulesPanel } from "./CardEditorPanels";
import { RpgStatePanel } from "./RpgStatePanel";
import { CardImportPanel } from "./CardImportPanel";
import type { ImportedCard } from "./cardImport";
import { exportRuntimeCard } from "./cardExport";

export function CardsSection(props: {
  cards: RuntimeCard[];
  activeCard: RuntimeCard | null;
  activeCardId: string;
  selectCard: (card: RuntimeCard) => void;
  editCard: (card: RuntimeCard) => void;
  deleteCard: (cardId: string) => void;
  pendingDeleteCardId: string | null;
  newCard: typeof defaultNewCard;
  setNewCard: (card: typeof defaultNewCard) => void;
  newCardError: string | null;
  createCard: () => boolean;
  onImportCard: (result: ImportedCard) => void;
  cardTab: CardTab;
  setCardTab: (tab: CardTab) => void;
  compiledPrompt: string;
  compiledPromptResult: CompiledPrompt;
  activeLorebookEntries: LorebookEntry[];
  activeLoreTriggers: LoreTriggerProvenance[];
  updateActiveCard: (patch: Partial<RuntimeCard>) => void;
  updateRpgState: (patch: Partial<RpgCardState>) => void;
  updateActiveLorebook: (lorebookId: string, patch: Partial<Omit<Lorebook, "id" | "entries">>) => void;
  addLorebookEntry: (lorebookId: string, entry: NewLorebookEntry) => boolean;
  lorebookEntryError: string | null;
}) {
  const [isCreatingCard, setIsCreatingCard] = useState(false);
  const totalRules = props.cards.reduce((total, card) => total + card.playerRules.length, 0);
  const totalLoreEntries = props.cards.reduce(
    (total, card) => total + card.lorebooks.reduce((entryTotal, lorebook) => entryTotal + lorebook.entries.length, 0),
    0,
  );

  function submitCreateCard() {
    if (props.createCard()) {
      setIsCreatingCard(false);
    }
  }

  return (
    <div className="workspace-grid cards-grid">
      <section className="panel card-library-panel" aria-label="Card library">
        <div className="section-title">
          <BookOpen size={17} />
          <h3>Card Library</h3>
        </div>
        <div className="card-library-hero" aria-label="Card library profile">
          <span className="brand-mark brand-mark-large" aria-hidden="true" />
          <div>
            <strong>Local-first runtime</strong>
            <span>Cards, rules, memory, lorebooks, and maps stay scoped to the active card.</span>
          </div>
        </div>
        <div className="card-library-stats" aria-label="Card library stats">
          <span>
            <strong>{props.cards.length}</strong>
            cards
          </span>
          <span>
            <strong>{totalRules}</strong>
            rules
          </span>
          <span>
            <strong>{totalLoreEntries}</strong>
            lore entries
          </span>
        </div>
        <div className="card-list compact-card-list">
          {props.cards.map((card) => (
            <article
              key={card.id}
              className={`card-row compact-card-row ${props.activeCardId === card.id ? "selected" : ""}`}
            >
              <header className="card-row-header">
                <strong>{card.name}</strong>
                <span className={`kind-pill ${card.kind}`}>{card.kind}</span>
              </header>
              <p>{card.summary}</p>
              <small>
                {getEnabledPlayerRules(card).length}/{card.playerRules.length} rules / {card.lorebooks.reduce((total, lorebook) => total + lorebook.entries.length, 0)} lore entries
              </small>
              <div className="button-row">
                <button className="secondary-button compact-button" type="button" onClick={() => props.selectCard(card)}>
                  <BookOpen size={16} />
                  Open
                </button>
                <button className="secondary-button compact-button" type="button" onClick={() => props.editCard(card)}>
                  <Settings2 size={16} />
                  Edit
                </button>
                <button className="secondary-button compact-button" type="button" onClick={() => exportRuntimeCard(card, "json")}>
                  <Download size={16} />
                  Export JSON
                </button>
                <button className="secondary-button compact-button" type="button" onClick={() => exportRuntimeCard(card, "png")}>
                  <Download size={16} />
                  Export PNG
                </button>
                <button
                  className="secondary-button danger-button compact-button"
                  type="button"
                  onClick={() => props.deleteCard(card.id)}
                  disabled={props.cards.length <= 1}
                >
                  <Trash2 size={16} />
                  {props.pendingDeleteCardId === card.id ? `Confirm delete ${card.name}` : "Delete"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel create-card-panel" aria-label="Create card">
        <div className="section-title">
          <Plus size={17} />
          <h3>Create Card</h3>
        </div>
        <CardImportPanel onImportCard={props.onImportCard} />
        <div className="card-import-divider" role="separator">
          <span>or build from scratch</span>
        </div>
        {!isCreatingCard ? (
          <button className="primary-button full-width" type="button" onClick={() => setIsCreatingCard(true)}>
            <Plus size={16} />
            Start creating card
          </button>
        ) : (
          <>
        <label className="field">
          <span>Name</span>
          <input
            value={props.newCard.name}
            onChange={(event) => props.setNewCard({ ...props.newCard, name: event.target.value })}
            placeholder="New card name"
          />
        </label>
        {props.newCardError ? (
          <p className="rule-warning" role="alert">
            {props.newCardError}
          </p>
        ) : null}
        <label className="field">
          <span>Card type</span>
          <select
            value={props.newCard.kind}
            onChange={(event) =>
              props.setNewCard({
                ...props.newCard,
                kind: event.target.value as CardKind,
                mapEnabled: event.target.value === "rpg" ? true : props.newCard.mapEnabled,
              })
            }
          >
            <option value="character">Character</option>
            <option value="rpg">RPG</option>
          </select>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={props.newCard.mapEnabled}
            onChange={(event) => props.setNewCard({ ...props.newCard, mapEnabled: event.target.checked })}
          />
          <span>Enable map/image panel for this card</span>
        </label>
        <label className="field">
          <span>Summary</span>
          <input
            value={props.newCard.summary}
            onChange={(event) => props.setNewCard({ ...props.newCard, summary: event.target.value })}
            placeholder="What this card is for"
          />
        </label>
        <label className="field">
          <span>Character name</span>
          <input
            value={props.newCard.characterName}
            onChange={(event) => props.setNewCard({ ...props.newCard, characterName: event.target.value })}
            placeholder="Name used inside the card"
          />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            value={props.newCard.characterDescription}
            onChange={(event) => props.setNewCard({ ...props.newCard, characterDescription: event.target.value })}
            rows={4}
          />
        </label>
        <label className="field">
          <span>Scenario</span>
          <textarea
            value={props.newCard.scenario}
            onChange={(event) => props.setNewCard({ ...props.newCard, scenario: event.target.value })}
            rows={4}
          />
        </label>
        <label className="field">
          <span>Greeting</span>
          <textarea
            value={props.newCard.greeting}
            onChange={(event) => props.setNewCard({ ...props.newCard, greeting: event.target.value })}
            rows={3}
          />
        </label>
        <label className="field">
          <span>Example dialogs</span>
          <textarea
            value={props.newCard.exampleDialogs}
            onChange={(event) => props.setNewCard({ ...props.newCard, exampleDialogs: event.target.value })}
            rows={5}
          />
        </label>
        <label className="field">
          <span>In-depth character definition / system prompt</span>
          <textarea
            value={props.newCard.systemPrompt}
            onChange={(event) => props.setNewCard({ ...props.newCard, systemPrompt: event.target.value })}
            rows={4}
          />
        </label>
        <label className="field">
          <span>Pre-history instructions</span>
          <textarea
            value={props.newCard.preHistoryInstructions}
            onChange={(event) =>
              props.setNewCard({ ...props.newCard, preHistoryInstructions: event.target.value })
            }
            rows={4}
          />
        </label>
        <label className="field">
          <span>Post-history instructions</span>
          <textarea
            value={props.newCard.postHistoryInstructions}
            onChange={(event) =>
              props.setNewCard({ ...props.newCard, postHistoryInstructions: event.target.value })
            }
            rows={4}
          />
        </label>
        <label className="field">
          <span>Additional player rules, one per line</span>
          <textarea
            value={props.newCard.playerRules}
            onChange={(event) => props.setNewCard({ ...props.newCard, playerRules: event.target.value })}
            rows={5}
          />
        </label>
        <label className="field">
          <span>Lorebook name</span>
          <input
            value={props.newCard.lorebookName}
            onChange={(event) => props.setNewCard({ ...props.newCard, lorebookName: event.target.value })}
          />
        </label>
        <button className="primary-button full-width" type="button" onClick={submitCreateCard}>
          <Plus size={16} />
          Create card
        </button>
          </>
        )}
      </section>

      {props.activeCard ? (
        <SelectedCardEditorPanel
          activeCard={props.activeCard}
          cardTab={props.cardTab}
          setCardTab={props.setCardTab}
          compiledPrompt={props.compiledPrompt}
          compiledPromptResult={props.compiledPromptResult}
          activeLorebookEntries={props.activeLorebookEntries}
          activeLoreTriggers={props.activeLoreTriggers}
          updateActiveCard={props.updateActiveCard}
          updateRpgState={props.updateRpgState}
          updateActiveLorebook={props.updateActiveLorebook}
          addLorebookEntry={props.addLorebookEntry}
          lorebookEntryError={props.lorebookEntryError}
        />
      ) : null}
    </div>
  );
}

export function SelectedCardEditorPanel(props: {
  activeCard: RuntimeCard;
  cardTab: CardTab;
  setCardTab: (tab: CardTab) => void;
  compiledPrompt: string;
  compiledPromptResult: CompiledPrompt;
  activeLorebookEntries: LorebookEntry[];
  activeLoreTriggers: LoreTriggerProvenance[];
  updateActiveCard: (patch: Partial<RuntimeCard>) => void;
  updateRpgState: (patch: Partial<RpgCardState>) => void;
  updateActiveLorebook: (lorebookId: string, patch: Partial<Omit<Lorebook, "id" | "entries">>) => void;
  addLorebookEntry: (lorebookId: string, entry: NewLorebookEntry) => boolean;
  lorebookEntryError: string | null;
}) {
  const editorTab = props.cardTab === "chat" || props.cardTab === "map" ? "instructions" : props.cardTab;
  const tabs: CardTab[] =
    props.activeCard.kind === "rpg" ? ["instructions", "rules", "lorebooks", "rpg"] : ["instructions", "rules", "lorebooks"];

  return (
    <section className="panel selected-card-panel" aria-label="Selected card editor">
      <div className="section-title">
        <Settings2 size={17} />
        <h3>Edit Selected Card</h3>
      </div>
      <div className="tab-strip" role="tablist" aria-label="Card editor tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={editorTab === tab}
            className={editorTab === tab ? "active" : ""}
            onClick={() => props.setCardTab(tab)}
          >
            {renderTabIcon(tab)}
            <span>{formatTabLabel(tab)}</span>
          </button>
        ))}
      </div>

      {editorTab === "instructions" ? (
        <InstructionsPanel activeCard={props.activeCard} updateActiveCard={props.updateActiveCard} />
      ) : null}
      {editorTab === "rules" ? (
        <RulesPanel
          activeCard={props.activeCard}
          compiledPrompt={props.compiledPrompt}
          compiledPromptResult={props.compiledPromptResult}
          updateActiveCard={props.updateActiveCard}
        />
      ) : null}
      {editorTab === "lorebooks" ? (
        <LorebooksPanel
          activeCard={props.activeCard}
          activeLorebookEntries={props.activeLorebookEntries}
          activeLoreTriggers={props.activeLoreTriggers}
          updateActiveLorebook={props.updateActiveLorebook}
          addLorebookEntry={props.addLorebookEntry}
          lorebookEntryError={props.lorebookEntryError}
        />
      ) : null}
      {editorTab === "rpg" && props.activeCard.rpg ? (
        <RpgStatePanel rpg={props.activeCard.rpg} updateRpgState={props.updateRpgState} />
      ) : null}
    </section>
  );
}
