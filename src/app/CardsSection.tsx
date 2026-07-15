import { useRef, useState, type KeyboardEvent } from "react";
import { Archive, ArchiveRestore, BookOpen, Download, Plus, Rocket, Search, Settings2, Star, Trash2 } from "lucide-react";
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
import { CREATION_TEMPLATES, applyCreationTemplate } from "./starterContent";
import { filterAndSortCards, getCardLibraryTags } from "./libraryControls";
import type { ReadinessItem } from "./readiness";

export function CardsSection(props: {
  cards: RuntimeCard[];
  activeCard: RuntimeCard | null;
  activeCardId: string;
  selectCard: (card: RuntimeCard) => void;
  editCard: (card: RuntimeCard) => void;
  deleteCard: (cardId: string) => void;
  updateCardLibraryState: (cardId: string, patch: Pick<RuntimeCard, "favorite" | "archived">) => void;
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
  readinessItems: ReadinessItem[];
  startMockDemo: () => void;
}) {
  const [isCreatingCard, setIsCreatingCard] = useState(false);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const totalRules = props.cards.reduce((total, card) => total + card.playerRules.length, 0);
  const totalLoreEntries = props.cards.reduce(
    (total, card) => total + card.lorebooks.reduce((entryTotal, lorebook) => entryTotal + lorebook.entries.length, 0),
    0,
  );
  const libraryTags = getCardLibraryTags(props.cards);
  const visibleCards = filterAndSortCards(props.cards, { query, tag, favoritesOnly, includeArchived });

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
        <label className="field">
          <span>Search cards</span>
          <div className="search-input">
            <Search size={16} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, summary, character, or tag"
            />
          </div>
        </label>
        <div className="settings-grid-two">
          <label className="field">
            <span>Tag</span>
            <select value={tag} onChange={(event) => setTag(event.target.value)}>
              <option value="">All tags</option>
              {libraryTags.map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
          <div className="field">
            <span>Visibility</span>
            <label className="toggle-row">
              <input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />
              <span>Favorites only</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />
              <span>Show archived</span>
            </label>
          </div>
        </div>
        <div className="card-list compact-card-list">
          {visibleCards.length === 0 ? <p className="status-line">No cards match these library filters.</p> : null}
          {visibleCards.map((card) => (
            <article
              key={card.id}
              className={`card-row compact-card-row ${props.activeCardId === card.id ? "selected" : ""}`}
            >
              <header className="card-row-header">
                <strong>{card.name}</strong>
                <span>
                  {card.favorite ? <Star size={14} aria-label="Favorite" fill="currentColor" /> : null}
                  <span className={`kind-pill ${card.kind}`}>{card.kind}</span>
                </span>
              </header>
              <p>{card.summary}</p>
              <small>
                {getEnabledPlayerRules(card).length}/{card.playerRules.length} rules / {card.lorebooks.reduce((total, lorebook) => total + lorebook.entries.length, 0)} lore entries
              </small>
              <div className="button-row">
                <button className="secondary-button compact-button" type="button" onClick={() => props.selectCard(card)}>
                  <BookOpen size={16} />
                  {card.id === "card_ashfall_crossing" ? "Play sample" : "Open"}
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
                  className="secondary-button compact-button"
                  type="button"
                  aria-pressed={card.favorite === true}
                  onClick={() => props.updateCardLibraryState(card.id, { favorite: !card.favorite })}
                >
                  <Star size={16} fill={card.favorite ? "currentColor" : "none"} />
                  {card.favorite ? "Unfavorite" : "Favorite"}
                </button>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={() => props.updateCardLibraryState(card.id, { archived: !card.archived })}
                >
                  {card.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                  {card.archived ? "Restore" : "Archive"}
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
        <section className="readiness-panel" aria-label="Readiness checklist">
          <div className="section-subtitle">
            <Rocket size={15} />
            <strong>Ready to play</strong>
          </div>
          <ul className="compact-list">
            {props.readinessItems.map((item) => (
              <li key={item.id}>
                <strong>{item.ready ? "Ready" : "Needs setup"}: {item.label}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
          <button className="primary-button full-width" type="button" onClick={props.startMockDemo}>
            <Rocket size={16} />
            Start mock demo
          </button>
          <p className="field-help">Uses the bundled sample and mock narrator. No network request or model call.</p>
        </section>
        <CardImportPanel onImportCard={props.onImportCard} />
        <div className="card-import-divider" role="separator">
          <span>or build from scratch</span>
        </div>
        {!isCreatingCard ? (
          <>
            <div className="creation-template-list" aria-label="Creation templates">
              {CREATION_TEMPLATES.map((template) => (
                <button
                  className="secondary-button full-width"
                  type="button"
                  key={template.id}
                  onClick={() => {
                    props.setNewCard(applyCreationTemplate(template.id));
                    setIsCreatingCard(true);
                  }}
                >
                  <span><strong>{template.name}</strong><small>{template.description}</small></span>
                </button>
              ))}
            </div>
            <button className="primary-button full-width" type="button" onClick={() => setIsCreatingCard(true)}>
              <Plus size={16} />
              Start creating card
            </button>
          </>
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
  const tabRefs = useRef<Partial<Record<CardTab, HTMLButtonElement | null>>>({});

  function selectAndFocusTab(tab: CardTab) {
    props.setCardTab(tab);
    tabRefs.current[tab]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: CardTab) {
    const currentIndex = tabs.indexOf(tab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    selectAndFocusTab(tabs[nextIndex]);
  }

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
            ref={(element) => {
              tabRefs.current[tab] = element;
            }}
            id={`card-editor-tab-${tab}`}
            role="tab"
            type="button"
            aria-selected={editorTab === tab}
            aria-controls={`card-editor-panel-${tab}`}
            tabIndex={editorTab === tab ? 0 : -1}
            className={editorTab === tab ? "active" : ""}
            onClick={() => props.setCardTab(tab)}
            onKeyDown={(event) => handleTabKeyDown(event, tab)}
          >
            {renderTabIcon(tab)}
            <span>{formatTabLabel(tab)}</span>
          </button>
        ))}
      </div>

      <div
        id={`card-editor-panel-${editorTab}`}
        role="tabpanel"
        aria-labelledby={`card-editor-tab-${editorTab}`}
      >
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
      </div>
    </section>
  );
}
