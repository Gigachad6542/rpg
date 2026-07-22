import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  GitBranch,
  Image,
  Map,
  Layers3,
  Maximize2,
  MessageSquare,
  PenLine,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  Wand2,
} from "lucide-react";
import { matchSlashCommands } from "../runtime/slashCommands";
import { type StoryEntity } from "../runtime/hiddenContinuity";
import type {
  CardTab,
  ChatSession,
  GeneratedMapArtifact,
  MediaPreviewArtifact,
  Message,
  Persona,
  PromptRun,
  RuntimeCard,
} from "./runtimeTypes";
import { customImagePresetPrompt } from "./appDefaults";
import { toGeneratedImageSrc } from "./generatedImages";
import { getActivePersona } from "./personas";
import { MessageContent } from "./ChatMessage";
import { TurnDeltaPanel } from "./TurnDeltaPanel";
import type { ModelReasoningTraceMap } from "./reasoningTraces";
import { StoryCharactersPanel } from "./StoryCharactersPanel";

export function RuntimeSection(props: {
  activeCard: RuntimeCard;
  activeChat?: ChatSession;
  cardChats: ChatSession[];
  archivedChats: ChatSession[];
  selectChat: (chatId: string) => void;
  startNewChat: () => void;
  branchChat: () => void;
  deleteChat: () => void;
  cancelDeleteChat: () => void;
  renameChat: (title: string) => void;
  archiveChat: () => void;
  restoreChat: (chatId: string) => void;
  exportChat: () => void;
  isDeleteChatPending: boolean;
  personas: Persona[];
  activePersonaId: string;
  selectPersona: (personaId: string) => void;
  messages: Message[];
  editMessage: (messageId: string, content: string) => void;
  regenerateLastReply: () => Promise<void>;
  swipeMessageVariant: (messageId: string, direction: -1 | 1) => void;
  undoTurnEffects: (messageId: string) => void;
  draft: string;
  setDraft: (draft: string) => void;
  sendMessage: () => Promise<void>;
  writeForMe: () => void;
  runtimeRunning: boolean;
  startRuntime: () => void;
  isGenerating: boolean;
  stopGeneration: () => void;
  streamingReply: string;
  reasoningTraces: ModelReasoningTraceMap;
  promptRuns: PromptRun[];
  ruleWarning: string | null;
  mapPrompt: string | null;
  mapArtifact: GeneratedMapArtifact | null;
  imagePromptDraft: string;
  setImagePromptDraft: (value: string) => void;
  imageNegativePromptDraft: string;
  setImageNegativePromptDraft: (value: string) => void;
  photoSpecDraft: string;
  setPhotoSpecDraft: (value: string) => void;
  photoPrompt: string;
  photoArtifact: GeneratedMapArtifact | null;
  characterPortraits: GeneratedMapArtifact[];
  isDraftingMapPrompt: boolean;
  isGeneratingMapImage: boolean;
  isGeneratingPhoto: boolean;
  prepareImagePrompt: () => Promise<void>;
  generateMapImage: () => Promise<void>;
  resetMapPrompt: () => void;
  deleteCurrentMap: () => void;
  generateCustomImageFromRequest: () => Promise<void>;
  resetCustomImageRequest: () => void;
  deleteCurrentPhoto: () => void;
  clearStoryCharacters: () => void;
  regeneratePortrait: (entity: StoryEntity, prompt: string) => void;
  buildPortraitPrompt: (entity: StoryEntity) => string;
  openMediaPreview: (preview: MediaPreviewArtifact) => void;
}) {
  const showMapPanel = props.activeCard.mapEnabled;
  const showMediaPanel = true;
  const isMapBusy = props.isDraftingMapPrompt || props.isGeneratingMapImage;
  const isRpgAerialImage = props.activeCard.kind === "rpg";
  const mediaPrimaryLabel = isRpgAerialImage ? "Aerial image" : "Image";
  const promptButtonLabel = isRpgAerialImage ? "Draft aerial image prompt" : "Draft image prompt";
  const generateMapButtonLabel = props.mapArtifact
    ? isRpgAerialImage
      ? "Regenerate aerial image"
      : "Regenerate image"
    : isRpgAerialImage
      ? "Generate aerial image"
      : "Generate image";
  const mapPromptDraft = props.imagePromptDraft.trim();
  const negativePromptDraft = props.imageNegativePromptDraft.trim();
  const mapArtifactMatchesDraft =
    props.mapArtifact &&
    props.mapArtifact.prompt.trim() === mapPromptDraft &&
    (props.mapArtifact.negativePrompt ?? "").trim() === negativePromptDraft;
  const hasPendingMapPromptDraft = Boolean(
    mapPromptDraft && (!props.mapArtifact || !mapArtifactMatchesDraft),
  );
  const openingText = getCardOpeningText(
    props.activeCard,
    getActivePersona(props.personas, props.activePersonaId) !== null,
  );
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const cancelDeleteChatRef = useRef<HTMLButtonElement | null>(null);
  const [messageWindowSize, setMessageWindowSize] = useState(120);
  const [autoFollow, setAutoFollow] = useState(true);
  const [isRenamingChat, setIsRenamingChat] = useState(false);
  const [chatTitleDraft, setChatTitleDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const lastMessage = props.messages[props.messages.length - 1];
  const regenerableMessageId =
    lastMessage?.role === "assistant" && props.runtimeRunning && !props.isGenerating ? lastMessage.id : null;

  const windowedMessages = props.messages.slice(-messageWindowSize);
  const hiddenMessageCount = props.messages.length - windowedMessages.length;

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript || !autoFollow) {
      return;
    }
    transcript.scrollTop = transcript.scrollHeight;
  }, [props.messages.length, props.streamingReply, props.isGenerating, props.activeChat?.id, autoFollow]);

  useEffect(() => {
    if (props.isDeleteChatPending) {
      cancelDeleteChatRef.current?.focus();
    }
  }, [props.isDeleteChatPending]);

  function jumpToLatest() {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
    setAutoFollow(true);
  }

  return (
    <div className={`runtime-chat-layout ${showMediaPanel ? "" : "no-map"}`}>
      <section className="chat-shell" aria-label="Runtime chat">
        <div className="chat-session-bar" aria-label="Chat controls">
          <label className="field chat-select">
            <span>Chat</span>
            <select
              aria-label="Active chat"
              value={props.activeChat?.id ?? ""}
              disabled={props.isGenerating}
              onChange={(event) => {
                setMessageWindowSize(120);
                setAutoFollow(true);
                setIsRenamingChat(false);
                props.selectChat(event.target.value);
              }}
            >
              {props.cardChats.map((chat) => (
                <option value={chat.id} key={chat.id}>
                  {chat.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field chat-select">
            <span>Persona</span>
            <select
              aria-label="Active persona"
              value={props.activePersonaId}
              disabled={props.isGenerating}
              onChange={(event) => props.selectPersona(event.target.value)}
            >
              {props.personas.map((persona) => (
                <option value={persona.id} key={persona.id}>
                  {persona.name}
                </option>
              ))}
            </select>
          </label>
          <div className="chat-actions">
            <button className="secondary-button compact-button" type="button" onClick={props.startNewChat} disabled={props.isGenerating}>
              <Plus size={16} />
              New chat
            </button>
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={props.branchChat}
              disabled={!props.activeChat || props.messages.length === 0 || props.isGenerating}
            >
              <GitBranch size={16} />
              Branch chat
            </button>
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={() => {
                setChatTitleDraft(props.activeChat?.title ?? "");
                setIsRenamingChat((current) => !current);
              }}
              disabled={!props.activeChat || props.isGenerating}
            >
              <PenLine size={16} />
              Rename
            </button>
            <button className="secondary-button compact-button" type="button" onClick={props.exportChat} disabled={!props.activeChat}>
              <Download size={16} />
              Export
            </button>
            <button className="secondary-button compact-button" type="button" onClick={props.archiveChat} disabled={!props.activeChat || props.isGenerating}>
              <Archive size={16} />
              Archive
            </button>
            {props.isDeleteChatPending ? (
              <button
                ref={cancelDeleteChatRef}
                className="secondary-button compact-button"
                type="button"
                onClick={props.cancelDeleteChat}
              >
                Cancel delete chat
              </button>
            ) : null}
            <button className="secondary-button danger-button compact-button" type="button" onClick={props.deleteChat} disabled={!props.activeChat || props.isGenerating}>
              <Trash2 size={16} />
              {props.isDeleteChatPending ? "Confirm delete chat" : "Delete chat"}
            </button>
          </div>
        </div>

        {isRenamingChat ? (
          <form
            className="chat-rename-row"
            onSubmit={(event) => {
              event.preventDefault();
              props.renameChat(chatTitleDraft);
              if (chatTitleDraft.trim()) setIsRenamingChat(false);
            }}
          >
            <label className="field">
              <span>Chat name</span>
              <input value={chatTitleDraft} maxLength={120} onChange={(event) => setChatTitleDraft(event.target.value)} autoFocus disabled={props.isGenerating} />
            </label>
            <button className="primary-button compact-button" type="submit" disabled={props.isGenerating}>Save name</button>
          </form>
        ) : null}
        {props.archivedChats.length > 0 ? (
          <details className="archived-chat-list">
            <summary>Archived chats ({props.archivedChats.length})</summary>
            {props.archivedChats.map((chat) => (
              <button className="secondary-button compact-button" type="button" key={chat.id} onClick={() => props.restoreChat(chat.id)} disabled={props.isGenerating}>
                <ArchiveRestore size={15} />
                Restore {chat.title}
              </button>
            ))}
          </details>
        ) : null}

        <div
          className="message-stream chat-transcript"
          role="log"
          aria-label="Chat transcript"
          tabIndex={0}
          ref={transcriptRef}
          onScroll={(event) => {
            const transcript = event.currentTarget;
            const distanceFromBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
            setAutoFollow(distanceFromBottom < 80);
          }}
        >
          {hiddenMessageCount > 0 ? (
            <button
              className="secondary-button compact-button transcript-history-button"
              type="button"
              onClick={() => {
                setAutoFollow(false);
                setMessageWindowSize((current) => current + 120);
              }}
            >
              Show earlier messages ({hiddenMessageCount} hidden)
            </button>
          ) : null}
          {!autoFollow ? (
            <button className="secondary-button compact-button jump-latest-button" type="button" onClick={jumpToLatest}>
              Jump to latest
            </button>
          ) : null}
          {!props.runtimeRunning ? (
            <section className="runtime-stopped" aria-label="Runtime stopped">
              <Power size={26} />
              <h3>Runtime shut down</h3>
              <p>The card and chat are saved. Start the runtime to continue.</p>
              <button className="primary-button compact-button" type="button" onClick={props.startRuntime}>
                <RotateCcw size={16} />
                Start runtime
              </button>
            </section>
          ) : null}
          {openingText && props.runtimeRunning ? (
            <article className="message response preset-opening" aria-label="Card opening">
              <header>
                <span className="message-role">
                  <Sparkles size={14} />
                  {props.activeCard.name}
                </span>
              </header>
              <MessageContent
                message={{
                  id: `opening-${props.activeCard.id}`,
                  role: "assistant",
                  content: openingText,
                }}
              />
            </article>
          ) : null}
          {windowedMessages.map((message) => (
            <article
              key={message.id}
              className={`message ${message.role === "assistant" ? "response" : "user"}`}
            >
              <header>
                <span className="message-role">
                  {message.role === "assistant" ? <Sparkles size={14} /> : <UserRound size={14} />}
                  {message.role === "assistant" ? props.activeCard.name : "You"}
                </span>
                {editingMessageId === message.id ? null : (
                  <span className="message-actions">
                    {message.variants && message.variants.length > 1 ? (
                      <span className="message-swipe" aria-label="Alternate replies">
                        <button
                          type="button"
                          className="message-swipe-arrow"
                          aria-label="Previous reply"
                          onClick={() => props.swipeMessageVariant(message.id, -1)}
                          disabled={props.isGenerating}
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <span className="message-swipe-count">
                          {(message.activeVariantIndex ?? message.variants.length - 1) + 1}/{message.variants.length}
                        </span>
                        <button
                          type="button"
                          className="message-swipe-arrow"
                          aria-label="Next reply"
                          onClick={() => props.swipeMessageVariant(message.id, 1)}
                          disabled={props.isGenerating}
                        >
                          <ChevronRight size={14} />
                        </button>
                      </span>
                    ) : null}
                    {regenerableMessageId === message.id ? (
                      <button
                        type="button"
                        className="message-action"
                        aria-label="Regenerate reply"
                        onClick={() => void props.regenerateLastReply()}
                        disabled={props.isGenerating}
                      >
                        <RefreshCw size={13} />
                        Regenerate
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="message-action"
                      aria-label="Edit message"
                      disabled={props.isGenerating}
                      onClick={() => {
                        setEditingMessageId(message.id);
                        setEditDraft(message.content);
                      }}
                    >
                      <PenLine size={13} />
                      Edit
                    </button>
                  </span>
                )}
              </header>
              {editingMessageId === message.id ? (
                <div className="message-editor">
                  <textarea
                    aria-label="Edit message text"
                    value={editDraft}
                    onChange={(event) => setEditDraft(event.target.value)}
                    disabled={props.isGenerating}
                    rows={4}
                  />
                  <div className="message-editor-actions">
                    <button
                      type="button"
                      className="primary-button compact-button"
                      disabled={!editDraft.trim() || props.isGenerating}
                      onClick={() => {
                        props.editMessage(message.id, editDraft);
                        setEditingMessageId(null);
                        setEditDraft("");
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      onClick={() => {
                        setEditingMessageId(null);
                        setEditDraft("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <MessageContent message={message} />
              )}
              {message.role === "assistant" ? (() => {
                const activeVariantIndex = message.activeVariantIndex ?? Math.max((message.variants?.length ?? 1) - 1, 0);
                const runId = message.variants && message.variants.length > 1
                  ? message.variantRunIds?.[activeVariantIndex]
                  : message.promptRunId;
                const run = runId ? props.promptRuns.find((candidate) => candidate.id === runId) : undefined;
                if (!run) {
                  return null;
                }
                const commit = props.activeChat?.turnLineage?.ledger[message.id];
                const canUndo = Boolean(
                  commit?.variants.some((variant) => variant.variantIndex === activeVariantIndex),
                );
                const undone = message.undoneVariantIndices?.includes(activeVariantIndex) ?? false;
                return (
                  <TurnDeltaPanel
                    run={run}
                    reasoningTraces={props.reasoningTraces}
                    onUndo={() => props.undoTurnEffects(message.id)}
                    canUndo={canUndo && !props.isGenerating}
                    undone={undone}
                  />
                );
              })() : null}
            </article>
          ))}
          {props.runtimeRunning && props.isGenerating && props.streamingReply.trim() ? (
            <article className="message response streaming-reply" aria-label="Streaming reply">
              <header>
                <span className="message-role">
                  <Sparkles size={14} />
                  {props.activeCard.name}
                </span>
              </header>
              <MessageContent
                message={{ id: "streaming-reply", role: "assistant", content: props.streamingReply }}
              />
            </article>
          ) : null}
        </div>
        {props.ruleWarning ? (
          <p className="rule-warning" role="status" aria-live="polite">
            {props.ruleWarning}
          </p>
        ) : null}
        <form
          className="composer chat-composer"
          aria-label="Message composer"
          onSubmit={(event) => {
            event.preventDefault();
            void props.sendMessage();
          }}
        >
          <label>
            <span>Message</span>
            <textarea
              aria-label="Message input"
              value={props.draft}
              onChange={(event) => props.setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (props.runtimeRunning && !props.isGenerating) {
                    void props.sendMessage();
                  }
                }
              }}
              disabled={!props.runtimeRunning || props.isGenerating}
              rows={4}
              placeholder="Type what you want to say or do..."
            />
          </label>
          {(() => {
            const slashMatches = matchSlashCommands(props.draft);
            if (slashMatches.length === 0) {
              return null;
            }
            return (
              <ul className="slash-command-menu" role="listbox" aria-label="Slash commands">
                {slashMatches.map((command) => (
                  <li key={command.name}>
                    <button
                      type="button"
                      className="slash-command-option"
                      onClick={() => props.setDraft(`/${command.name} `)}
                    >
                      <span className="slash-command-name">/{command.name}</span>
                      <span className="slash-command-summary">{command.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}
          <div className="composer-actions">
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={props.writeForMe}
              disabled={!props.runtimeRunning || props.isGenerating}
            >
              <Wand2 size={16} />
              Write for me
            </button>
            {props.isGenerating ? (
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={props.stopGeneration}
                aria-label="Stop generation"
              >
                <Square size={15} />
                Stop
              </button>
            ) : (
              <button
                className="primary-button compact-button"
                type="submit"
                disabled={!props.runtimeRunning}
              >
                <Send size={16} />
                Send
              </button>
            )}
          </div>
        </form>
      </section>

      {showMediaPanel ? (
        <aside className="media-side-panel" aria-label="Image and story tools">
          {showMapPanel ? (
            <section
              className="media-section map-generator-section"
              id="media-panel-map"
              role="region"
              aria-label="Aerial image generator"
            >
              <div className="section-title">
                <Image size={17} />
                <h3>{mediaPrimaryLabel}</h3>
              </div>
              {hasPendingMapPromptDraft ? (
                <div className="map-output compact-map-output map-draft-output" role="region" aria-label="Aerial image prompt draft">
                  <div className="map-placeholder compact-placeholder">
                    <Image size={34} />
                    <span>
                      {props.mapArtifact
                        ? "Aerial image prompt draft ready. Select Generate aerial image to replace the current image."
                        : "Aerial image prompt draft ready. Select Generate aerial image to create the image."}
                    </span>
                  </div>
                </div>
              ) : null}
              {props.mapArtifact ? (
                <div className="map-output compact-map-output" role="region" aria-label="Generated aerial image">
                  {props.mapArtifact.imageUrl ? (
                    <div className="generated-image-frame">
                      <img className="generated-map-image" src={toGeneratedImageSrc(props.mapArtifact)} alt="Generated aerial scene" />
                      <button
                        className="icon-button image-maximize-button"
                        type="button"
                        onClick={() =>
                          props.openMediaPreview({
                            artifact: props.mapArtifact as GeneratedMapArtifact,
                            label: "Generated aerial image",
                          })
                        }
                        aria-label="Maximize aerial image"
                        title="Maximize aerial image"
                      >
                        <Maximize2 size={17} />
                      </button>
                    </div>
                  ) : (
                    <div className="map-placeholder compact-placeholder">
                      <Image size={34} />
                      <span>
                        {props.mapArtifact.status === "error"
                          ? "Aerial image generation needs attention"
                          : "Aerial image prompt ready for image provider"}
                      </span>
                    </div>
                  )}
                  <div className={`map-status ${props.mapArtifact.status}`}>
                    <strong>{props.mapArtifact.status}</strong>
                    <span>{props.mapArtifact.provider} / {props.mapArtifact.model}</span>
                  </div>
                  {props.mapArtifact.error ? <p className="rule-warning">{props.mapArtifact.error}</p> : null}
                </div>
              ) : props.mapPrompt && !hasPendingMapPromptDraft ? (
                <div className="map-output compact-map-output" role="region" aria-label="Aerial image prompt draft">
                  <div className="map-placeholder compact-placeholder">
                    <Image size={34} />
                    <span>Aerial image prompt ready to edit</span>
                  </div>
                </div>
              ) : null}
              <div className="button-row media-actions">
                <button
                  className="primary-button compact-button"
                  type="button"
                  onClick={() => void props.prepareImagePrompt()}
                  disabled={!props.runtimeRunning || isMapBusy}
                >
                  <Image size={16} />
                  {props.isDraftingMapPrompt ? "Drafting..." : promptButtonLabel}
                </button>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={() => void props.generateMapImage()}
                  disabled={!props.runtimeRunning || isMapBusy || !props.imagePromptDraft.trim()}
                >
                  <Play size={16} />
                  {props.isGeneratingMapImage ? "Generating image..." : generateMapButtonLabel}
                </button>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={props.resetMapPrompt}
                  disabled={!props.imagePromptDraft.trim() && !props.imageNegativePromptDraft.trim() && !props.mapPrompt}
                >
                  <RotateCcw size={16} />
                  Reset aerial prompt
                </button>
                <button
                  className="secondary-button danger-button compact-button"
                  type="button"
                  onClick={props.deleteCurrentMap}
                  disabled={!props.mapArtifact}
                >
                  <Trash2 size={16} />
                  Delete aerial image
                </button>
              </div>
              <label className="field">
                <span>Image prompt</span>
                <textarea
                  value={props.imagePromptDraft}
                  onChange={(event) => props.setImagePromptDraft(event.target.value)}
                  rows={5}
                  placeholder="Generate an overhead scene prompt from visible terrain, then edit it before sending."
                />
              </label>
              <label className="field">
                <span>Negative prompt</span>
                <textarea
                  value={props.imageNegativePromptDraft}
                  onChange={(event) => props.setImageNegativePromptDraft(event.target.value)}
                  rows={3}
                  placeholder="Things to avoid in the image"
                />
              </label>
            </section>
          ) : null}

          <StoryCharactersPanel
            entities={props.activeCard.storyEntities}
            portraits={props.characterPortraits}
            clearStoryCharacters={props.clearStoryCharacters}
            regeneratePortrait={props.regeneratePortrait}
            buildPortraitPrompt={props.buildPortraitPrompt}
            openMediaPreview={props.openMediaPreview}
          />

          <section
            className="media-section photo-generator-section"
            id="media-panel-image"
            role="region"
            aria-label="Image generator"
          >
            <div className="section-title">
              <Image size={17} />
              <h3>Image</h3>
            </div>
            <p className="field-help">
              Preset prompt: <strong>{customImagePresetPrompt}</strong>
            </p>
            <label className="field">
              <span>Image request</span>
              <textarea
                value={props.photoSpecDraft}
                onChange={(event) => props.setPhotoSpecDraft(event.target.value)}
                rows={5}
                placeholder="Vaguely describe the picture you want..."
              />
            </label>
            <div className="button-row media-actions">
              <button
                className="primary-button compact-button"
                type="button"
                onClick={() => void props.generateCustomImageFromRequest()}
                disabled={!props.photoSpecDraft.trim() || props.isGeneratingPhoto}
              >
                <Play size={16} />
                {props.isGeneratingPhoto ? "Generating..." : "Generate custom image"}
              </button>
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={props.resetCustomImageRequest}
                disabled={!props.photoSpecDraft.trim() && !props.photoPrompt}
              >
                <RotateCcw size={16} />
                Reset image request
              </button>
              <button
                className="secondary-button danger-button compact-button"
                type="button"
                onClick={props.deleteCurrentPhoto}
                disabled={!props.photoArtifact}
              >
                <Trash2 size={16} />
                Delete image
              </button>
            </div>
            {props.photoPrompt ? (
              <p className="compiled-image-prompt">
                {props.photoPrompt}
              </p>
            ) : null}
            {props.photoArtifact ? (
              <div className="map-output photo-output" role="region" aria-label="Generated custom image">
                {props.photoArtifact.imageUrl ? (
                  <div className="generated-image-frame">
                    <img
                      className="generated-photo-image"
                      src={toGeneratedImageSrc(props.photoArtifact)}
                      alt="Generated custom scene"
                    />
                    <button
                      className="icon-button image-maximize-button"
                      type="button"
                      onClick={() =>
                        props.openMediaPreview({
                          artifact: props.photoArtifact as GeneratedMapArtifact,
                          label: "Generated custom image",
                        })
                      }
                      aria-label="Maximize image"
                      title="Maximize image"
                    >
                      <Maximize2 size={17} />
                    </button>
                  </div>
                ) : (
                  <div className="map-placeholder photo-placeholder">
                    <Image size={42} />
                    <span>
                      {props.photoArtifact.status === "error"
                        ? "Image generation needs attention"
                        : "Custom image prompt ready for image provider"}
                    </span>
                  </div>
                )}
                <div className={`map-status ${props.photoArtifact.status}`}>
                  <strong>{props.photoArtifact.status}</strong>
                  <span>{props.photoArtifact.provider} / {props.photoArtifact.model}</span>
                </div>
                {props.photoArtifact.error ? <p className="rule-warning">{props.photoArtifact.error}</p> : null}
              </div>
            ) : null}
          </section>
        </aside>
      ) : null}
    </div>
  );
}

export function getCardOpeningText(card: RuntimeCard, hasActivePersona = false): string {
  const greeting = card.greeting.trim();
  if (greeting) {
    return greeting;
  }

  const scenario = card.scenario.trim();
  if (scenario) {
    return scenario;
  }

  if (card.kind === "rpg") {
    // With an active persona the player is already described, so the generic
    // "describe your character" nudge would be redundant.
    return hasActivePersona
      ? "Set the scene, or leave the message blank and press Send for a random opening."
      : "Describe your character, their surroundings, and what they are doing. Or leave the message blank and press Send for a random opening.";
  }

  return card.summary.trim() || `${card.name} is ready.`;
}

export function NoActiveCardRuntimePanel(props: { openCards: () => void }) {
  return (
    <section className="panel empty-chat no-active-card-panel" aria-label="No active card">
      <BookOpen size={30} />
      <h3>No card is open</h3>
      <p>Saved cards stay in the library until you open one for runtime chat.</p>
      <button className="primary-button compact-button" type="button" onClick={props.openCards}>
        <BookOpen size={16} />
        Open card library
      </button>
    </section>
  );
}

export function formatTabLabel(tab: CardTab): string {
  if (tab === "rpg") {
    return "RPG";
  }

  return tab[0].toUpperCase() + tab.slice(1);
}

export function renderTabIcon(tab: CardTab) {
  switch (tab) {
    case "chat":
      return <MessageSquare size={15} />;
    case "instructions":
      return <BookOpen size={15} />;
    case "rules":
      return <ClipboardList size={15} />;
    case "lorebooks":
      return <Layers3 size={15} />;
    case "rpg":
      return <Sparkles size={15} />;
    case "map":
      return <Map size={15} />;
  }
}
