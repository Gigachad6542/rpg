import { parseAssistantMessageDisplay } from "./assistantMessageParsing";
import { renderNarrativeMarkup } from "./turnPromptBuilders";
import type { Message } from "./runtimeTypes";

export function MessageContent(props: { message: Message }) {
  if (props.message.role !== "assistant") {
    return <p className="message-paragraph">{props.message.content}</p>;
  }

  const display = parseAssistantMessageDisplay(props.message.content);

  return (
    <div className="message-content">
      <div className="message-prose">
        {display.paragraphs.map((paragraph, index) => (
          <p className="message-paragraph" key={`${paragraph}-${index}`}>
            {renderNarrativeMarkup(paragraph)}
          </p>
        ))}
      </div>
      {display.statusItems.length > 0 ? (
        <dl className="message-status-footer" aria-label="Scene status">
          {display.statusItems.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
