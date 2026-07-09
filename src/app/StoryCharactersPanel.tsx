import { useState } from "react";
import { Eye, Maximize2, RotateCcw, Trash2, UserRound } from "lucide-react";
import { type StoryEntity } from "../runtime/hiddenContinuity";
import type { GeneratedMapArtifact, MediaPreviewArtifact } from "./runtimeTypes";
import { findCharacterPortraitForEntity, toGeneratedImageSrc } from "./generatedImages";
import { hasStoryEntityDetails, isDefaultPlayerStoryEntity, orderStoryEntitiesForDisplay } from "./cardNormalization";

export function StoryCharactersPanel(props: {
  entities: StoryEntity[];
  portraits: GeneratedMapArtifact[];
  clearStoryCharacters: () => void;
  regeneratePortrait: (entity: StoryEntity, prompt: string) => void;
  buildPortraitPrompt: (entity: StoryEntity) => string;
  openMediaPreview: (preview: MediaPreviewArtifact) => void;
}) {
  const entities = orderStoryEntitiesForDisplay(props.entities);
  const [expandedEntityId, setExpandedEntityId] = useState<string | null>(null);
  const [portraitPromptDrafts, setPortraitPromptDrafts] = useState<Record<string, string>>({});
  const hasTrackedCharacters = entities.some((entity) => !isDefaultPlayerStoryEntity(entity) || hasStoryEntityDetails(entity));

  return (
    <section
      className="media-section story-characters-section"
      id="media-panel-characters"
      role="region"
      aria-label="Story characters"
    >
      <div className="section-title">
        <UserRound size={17} />
        <h3>Characters</h3>
        <button
          className="secondary-button danger-button compact-button story-clear-button"
          type="button"
          onClick={() => {
            setExpandedEntityId(null);
            props.clearStoryCharacters();
          }}
          disabled={!hasTrackedCharacters}
          aria-label="Clear tracked characters"
        >
          <Trash2 size={15} />
          Clear roster
        </button>
      </div>
      <div className="story-entity-list">
        {entities.map((entity) => {
          const portrait = findCharacterPortraitForEntity(props.portraits, "", entity);
          return (
            <div className={`story-entity-item ${entity.kind}`} key={entity.id}>
              <div className="story-entity-main">
                <CharacterPortrait
                  entity={entity}
                  portrait={portrait}
                  openMediaPreview={props.openMediaPreview}
                />
                <div className="story-entity-copy">
                  {hasStoryEntityDetails(entity) || !isDefaultPlayerStoryEntity(entity) ? (
                    <button
                      className="secondary-button compact-button story-details-button"
                      type="button"
                      onClick={() => setExpandedEntityId((current) => (current === entity.id ? null : entity.id))}
                      aria-expanded={expandedEntityId === entity.id}
                      aria-label={`${expandedEntityId === entity.id ? "Hide" : "Show"} details for ${entity.name}`}
                    >
                      <Eye size={15} />
                      {expandedEntityId === entity.id ? "Hide details" : "Show details"}
                    </button>
                  ) : null}
                </div>
              </div>
              {expandedEntityId === entity.id ? (
                <div className="story-entity-details">
                  {entity.summary ? <p>{entity.summary}</p> : null}
                  {entity.knownFacts.length > 0 ? (
                    <div className="story-knowledge-block">
                      <strong>Knows</strong>
                      <ul>
                        {entity.knownFacts.map((fact) => (
                          <li key={fact}>{fact}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {entity.doesNotKnow.length > 0 ? (
                    <div className="story-knowledge-block">
                      <strong>Does not know</strong>
                      <ul>
                        {entity.doesNotKnow.map((fact) => (
                          <li key={fact}>{fact}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <label className="field">
                    <span>Portrait prompt</span>
                    <textarea
                      aria-label={`Portrait prompt for ${entity.name}`}
                      rows={3}
                      value={portraitPromptDrafts[entity.id] ?? portrait?.prompt ?? props.buildPortraitPrompt(entity)}
                      onChange={(event) =>
                        setPortraitPromptDrafts((current) => ({ ...current, [entity.id]: event.target.value }))
                      }
                    />
                  </label>
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    onClick={() =>
                      props.regeneratePortrait(
                        entity,
                        portraitPromptDrafts[entity.id] ?? portrait?.prompt ?? props.buildPortraitPrompt(entity),
                      )
                    }
                  >
                    <RotateCcw size={15} />
                    Regenerate portrait
                  </button>
                  {portrait?.status === "error" && portrait.error ? (
                    <p className="field-help">{portrait.error}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CharacterPortrait(props: {
  entity: StoryEntity;
  portrait: GeneratedMapArtifact | null;
  openMediaPreview: (preview: MediaPreviewArtifact) => void;
}) {
  const label = `Character portrait for ${props.entity.name}`;
  const statusLabel = props.portrait
    ? props.portrait.status === "generated"
      ? "Portrait generated"
      : props.portrait.status === "error"
        ? "Portrait needs attention"
        : "Portrait prompt ready"
    : "Portrait pending";

  return (
    <div className="story-portrait" aria-label={label}>
      {props.portrait?.imageUrl ? (
        <div className="story-portrait-image-frame">
          <img
            className="story-portrait-image"
            src={toGeneratedImageSrc(props.portrait)}
            alt={`${props.entity.name} portrait`}
          />
          <button
            className="icon-button image-maximize-button story-portrait-maximize"
            type="button"
            onClick={() =>
              props.openMediaPreview({
                artifact: props.portrait as GeneratedMapArtifact,
                label: `${props.entity.name} portrait`,
              })
            }
            aria-label={`Maximize portrait for ${props.entity.name}`}
            title={`Maximize portrait for ${props.entity.name}`}
          >
            <Maximize2 size={15} />
          </button>
        </div>
      ) : (
        <div className="story-portrait-placeholder">
          <UserRound size={24} />
        </div>
      )}
      <span className={`story-portrait-status ${props.portrait?.status ?? "pending"}`}>
        {statusLabel}
      </span>
      {props.portrait?.error ? <span className="story-portrait-error">{props.portrait.error}</span> : null}
    </div>
  );
}

