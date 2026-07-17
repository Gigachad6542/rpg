import {
  BookOpen,
  Eye,
  KeyRound,
  Layers3,
  MessageSquare,
  Moon,
  PenLine,
  Power,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";

import { APP_NAME } from "./productInfo";
import type { MainSection, RuntimeCard, Theme } from "./runtimeTypes";

type ActiveCardSummary = Pick<RuntimeCard, "name" | "kind" | "summary">;

interface AppSidebarProps {
  theme: Theme;
  section: MainSection;
  selectSection: (section: MainSection) => void;
  toggleTheme: () => void;
  saveStatus: string;
  repositoryStatus: string;
}

const NAV_ITEMS: ReadonlyArray<{
  section: MainSection;
  label: string;
  Icon: typeof MessageSquare;
}> = [
  { section: "runtime", label: "Runtime", Icon: MessageSquare },
  { section: "cards", label: "Cards", Icon: BookOpen },
  { section: "personas", label: "Personas", Icon: UserRound },
  { section: "lorebooks", label: "Lorebooks", Icon: Layers3 },
  { section: "providers", label: "API Keys", Icon: KeyRound },
  { section: "settings", label: "Settings", Icon: Settings2 },
];

export function AppSidebar({
  theme,
  section,
  selectSection,
  toggleTheme,
  saveStatus,
  repositoryStatus,
}: AppSidebarProps) {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <h1>{APP_NAME}</h1>
          <p>Private character and RPG play</p>
        </div>
      </div>

      <nav className="nav-list" aria-label="Main sections">
        {NAV_ITEMS.map(({ section: itemSection, label, Icon }) => (
          <button
            className={`nav-item ${section === itemSection ? "active" : ""}`}
            type="button"
            aria-current={section === itemSection ? "page" : undefined}
            onClick={() => selectSection(itemSection)}
            key={itemSection}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>

      <button className="secondary-button full-width" type="button" onClick={toggleTheme}>
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </button>

      <section className="storage-status" aria-label="Local storage status">
        <div className="section-title">
          <ShieldCheck size={16} />
          <h2>Storage</h2>
        </div>
        <dl className="compact-dl">
          <dt>Local save</dt>
          <dd>
            <span role="status" aria-live="polite">{saveStatus}</span>
          </dd>
          <dt>Repository</dt>
          <dd>
            <span role="status" aria-live="polite">{repositoryStatus}</span>
          </dd>
        </dl>
      </section>
    </aside>
  );
}

interface AppTopbarProps {
  section: MainSection;
  activeCard: ActiveCardSummary | null;
  runtimeRunning: boolean;
  editCard: () => void;
  openMemory: () => void;
  shutdownRuntime: () => void;
  startRuntime: () => void;
}

export function AppTopbar({
  section,
  activeCard,
  runtimeRunning,
  editCard,
  openMemory,
  shutdownRuntime,
  startRuntime,
}: AppTopbarProps) {
  return (
    <header className="topbar">
      <div className="title-stack">
        <p className="eyebrow">
          {activeCard
            ? activeCard.kind === "rpg"
              ? "RPG card active"
              : "Character card active"
            : "No card active"}
        </p>
        <h2>{activeCard?.name ?? "Open a saved card"}</h2>
        <p className="title-summary">
          {activeCard?.summary ?? "Your cards, chats, and lore stay on this device."}
        </p>
      </div>
      <div className="topbar-actions">
        {section === "runtime" && activeCard ? (
          <button className="secondary-button" type="button" onClick={editCard}>
            <PenLine size={17} />
            Edit card
          </button>
        ) : null}
        <button className="secondary-button" type="button" onClick={openMemory} disabled={!activeCard}>
          <Eye size={17} />
          Inspect memory
        </button>
        {runtimeRunning && activeCard ? (
          <button className="secondary-button danger-button" type="button" onClick={shutdownRuntime}>
            <Power size={17} />
            Shut down runtime
          </button>
        ) : activeCard ? (
          <button className="secondary-button" type="button" onClick={startRuntime}>
            <RotateCcw size={17} />
            Start runtime
          </button>
        ) : null}
      </div>
    </header>
  );
}
