import { KeyRound, Library, MessageSquareText, Rocket, Sparkles } from "lucide-react";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

type OnboardingStep = {
  icon: JSX.Element;
  title: string;
  detail: string;
};

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    icon: <KeyRound size={18} />,
    title: "Add your API key",
    detail: "This runtime is bring-your-own-key. Your key is stored in the OS keychain and transmitted only to the provider you configure when making requests.",
  },
  {
    icon: <Library size={18} />,
    title: "Open a card",
    detail: "Cards hold a world, characters, lore, and rules. Open the starter RPG card or create your own.",
  },
  {
    icon: <MessageSquareText size={18} />,
    title: "Play a turn",
    detail: "Describe what you do and press Send. Enable dice in Settings to roll with /roll 2d6+3.",
  },
];

export function OnboardingOverlay(props: {
  onAddApiKey: () => void;
  onOpenCards: () => void;
  onDismiss: () => void;
  onStartMockDemo?: () => void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLDivElement>();
  return (
    <div ref={dialogRef} className="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-card">
        <div className="onboarding-heading">
          <span className="onboarding-badge">
            <Sparkles size={16} />
            First run
          </span>
          <h2 id="onboarding-title">Welcome to Local-First RPG</h2>
          <p>Your runtime data stays local unless you use a hosted model provider. Chat, persona, memory, lore, and state needed for a response are sent to the provider you configure.</p>
        </div>
        <ol className="onboarding-steps">
          {ONBOARDING_STEPS.map((step, index) => (
            <li key={step.title} className="onboarding-step">
              <span className="onboarding-step-index" aria-hidden="true">
                {index + 1}
              </span>
              <span className="onboarding-step-icon" aria-hidden="true">
                {step.icon}
              </span>
              <span className="onboarding-step-body">
                <span className="onboarding-step-title">{step.title}</span>
                <span className="onboarding-step-detail">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="onboarding-actions">
          {props.onStartMockDemo ? (
            <button
              type="button"
              className="primary-button compact-button"
              onClick={() => {
                props.onStartMockDemo?.();
                props.onDismiss();
              }}
            >
              <Rocket size={16} />
              Start mock demo
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => {
              props.onAddApiKey();
              props.onDismiss();
            }}
          >
            <KeyRound size={16} />
            Add API key
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => {
              props.onOpenCards();
              props.onDismiss();
            }}
          >
            <Library size={16} />
            Browse cards
          </button>
          <button type="button" className="ghost-button compact-button" onClick={props.onDismiss}>
            Explore on my own
          </button>
        </div>
      </div>
    </div>
  );
}
