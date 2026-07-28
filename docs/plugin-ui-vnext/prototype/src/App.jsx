import { useEffect, useRef, useState } from "react";
import {
  IconAdjustments,
  IconAccessible,
  IconAlertCircle,
  IconArrowDown,
  IconBolt,
  IconBox,
  IconBrandLinkedin,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconDots,
  IconDownload,
  IconExternalLink,
  IconFileDescription,
  IconFolder,
  IconHelpCircle,
  IconInfoCircle,
  IconKey,
  IconLayoutGrid,
  IconLink,
  IconMoon,
  IconMinus,
  IconPuzzle,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSun,
  IconTrash,
  IconTypography,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import DesignSystemView from "./design-system/DesignSystemView";

const creationNavItems = [
  { id: "component", label: "Generate component docs", icon: IconFileDescription },
  { id: "foundations", label: "Generate foundation docs", icon: IconLayoutGrid },
];

const libraryNavItem = { id: "library", label: "Library", icon: IconFolder };

const utilityItems = [
  { id: "settings", label: "Settings", icon: IconSettings },
  { id: "subscription", label: "License", icon: IconKey },
];

const initialDocs = [
  {
    id: "buttonText",
    name: "buttonText",
    source: "Components · Button / Text",
    status: "update",
    age: "12d ago",
    changes: ["Variants changed", "Measurements changed"],
    changeDetails: [
      { label: "Variants", items: ["Added: icon-left, icon-right", "Removed: icon-only"] },
      { label: "Measurements", items: ["Height 40 → 44", "Padding X 16 → 20", "Gap 8 → 12"] },
    ],
  },
  {
    id: "inputField",
    name: "inputField",
    source: "Components · Input / Field",
    status: "update",
    age: "8d ago",
    changes: ["States changed", "Token mapping changed"],
    changeDetails: [
      { label: "States", items: ["Added: read-only"] },
      { label: "Tokens", items: ["Border: neutral-300 → neutral-400", "Focus: action-500 → focus-ring"] },
    ],
  },
  {
    id: "radio",
    name: "radio",
    source: "Components · Input / Radio",
    status: "update",
    age: "7d ago",
    changes: ["Variants changed"],
    changeDetails: [],
  },
  { id: "checkbox", name: "checkbox", source: "Components · Input / Checkbox", status: "sync", age: "2d ago" },
  { id: "buttonIcon", name: "buttonIcon", source: "Components · Button / Icon", status: "sync", age: "3d ago" },
  { id: "buttonPrimary", name: "buttonPrimary", source: "Components · Button / Primary", status: "sync", age: "3d ago" },
  { id: "buttonSegmented", name: "buttonSegmented", source: "Components · Button / Segmented", status: "sync", age: "3d ago" },
  { id: "mappedColors", name: "Mapped Colors", source: "Foundations · Mapped Colors", status: "sync", age: "5d ago" },
  { id: "typography", name: "Foundation · typography", source: "Foundations · Typography", status: "sync", age: "5d ago" },
];

const foundationSeed = [
  { id: "colors", name: "Mapped Colors", detail: "138 variables · 3 modes", selected: true },
  { id: "foundation", name: "Foundation", detail: "178 variables · 1 mode · 5 frames", selected: true },
  { id: "density", name: "Mapped Density", detail: "24 variables · 3 modes", selected: true },
  { id: "radius", name: "Mapped Radius", detail: "7 variables · 4 modes", selected: true },
  { id: "text", name: "Text styles", detail: "21 styles", selected: true },
];

const frameThemeOptions = ["default", "editorial", "tech", "warm", "custom"];

const measurementOptions = [
  { id: "size", label: "Height & width" },
  { id: "padding", label: "Inner padding" },
  { id: "spacing", label: "Children & spacing" },
];

const customThemeColorFields = [
  ["header", "Header background"],
  ["accent", "Accent"],
  ["body", "Body text"],
  ["table", "Table header"],
];

const licenseStates = new Set([
  "free",
  "checking",
  "pro",
  "expired",
  "inactive",
  "unknown",
  "invalid",
  "disabled",
  "device-limit",
  "unreachable",
  "removing",
  "removed",
]);

const storedLicenseStates = new Set([
  "pro",
  "expired",
  "inactive",
  "unknown",
  "removing",
]);

const licenseStatusMessages = {
  expired: {
    tone: "warning",
    title: "Your Pro subscription has expired",
    detail: "You’re on the free plan for now. Renew Pro to restore unlimited access.",
  },
  inactive: {
    tone: "warning",
    title: "This key isn’t connected to this device",
    detail: "Activate it again to reconnect this Figma plugin.",
  },
  unknown: {
    tone: "neutral",
    title: "Your Pro key is saved",
    detail: "We couldn’t verify it right now. Your key stays connected while you retry.",
  },
  invalid: {
    tone: "danger",
    title: "We couldn’t find that key",
    detail: "Double-check it against your purchase email and try again.",
  },
  disabled: {
    tone: "danger",
    title: "This key has been turned off",
    detail: "Contact support if that’s unexpected.",
  },
  "device-limit": {
    tone: "danger",
    title: "This key has reached its device limit",
    detail: "Free up a device in Manage subscription, then try again.",
  },
  unreachable: {
    tone: "neutral",
    title: "Couldn’t reach the license server",
    detail: "Your current plan hasn’t changed. Try again in a minute.",
  },
  removed: {
    tone: "success",
    title: "Key removed from this device",
    detail: "This plugin is back on the free plan.",
  },
};

function getInitialLicenseState() {
  const requestedState = new URLSearchParams(window.location.search).get("license-state");
  return licenseStates.has(requestedState) ? requestedState : "free";
}

function getInitialView() {
  const requestedView = new URLSearchParams(window.location.search).get("view");
  const viewAliases = {
    component: "component",
    foundations: "foundations",
    library: "library",
    settings: "settings",
    license: "subscription",
    system: "design-system",
    "design-system": "design-system",
  };
  return viewAliases[requestedView] ?? "library";
}

function getInitialAiEnabled() {
  return new URLSearchParams(window.location.search).get("ai") !== "off";
}

function IconButton({ icon: Icon, label, onClick, active = false, badge }) {
  return (
    <button
      className={`icon-button ${active ? "is-active" : ""}`}
      onClick={onClick}
      aria-label={label}
      data-label={label}
      type="button"
    >
      <Icon size={19} stroke={1.8} />
      {badge ? <span className="nav-badge">{badge}</span> : null}
    </button>
  );
}

function SidebarLink({ icon: Icon, label, href }) {
  return (
    <a
      className="icon-button sidebar-external-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      data-label={label}
    >
      <Icon size={18} stroke={1.8} />
    </a>
  );
}

function Sidebar({ activeView, onNavigate, updateCount }) {
  return (
    <aside className="sidebar" aria-label="Plugin navigation">
      <nav className="nav-group" aria-label="Create documentation">
        {creationNavItems.map(({ id, label, icon }) => (
          <IconButton
            key={id}
            icon={icon}
            label={label}
            active={activeView === id}
            onClick={() => onNavigate(id)}
          />
        ))}
      </nav>
      <div className="sidebar-divider" />
      <nav className="nav-group" aria-label="Library maintenance">
        <IconButton
          icon={libraryNavItem.icon}
          label={libraryNavItem.label}
          active={activeView === libraryNavItem.id}
          badge={updateCount || undefined}
          onClick={() => onNavigate(libraryNavItem.id)}
        />
      </nav>
      <div className="sidebar-divider" />
      <nav className="nav-group" aria-label="Plugin settings">
        {utilityItems.map(({ id, label, icon }) => (
          <IconButton
            key={id}
            icon={icon}
            label={label}
            active={activeView === id}
            onClick={() => onNavigate(id)}
          />
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-bottom">
        <div className="sidebar-divider" />
        <div className="nav-group">
          <SidebarLink icon={IconWorld} label="Spec Layer website" href="https://spec-layer.com/" />
          <SidebarLink icon={IconBrandLinkedin} label="Spec Layer on LinkedIn" href="https://www.linkedin.com/in/alexkurchev/" />
          <IconButton icon={IconHelpCircle} label="Help & feedback" onClick={() => onNavigate("help")} />
        </div>
      </div>
    </aside>
  );
}

function PageHeader({ title, subtitle, actions, eyebrow }) {
  const titleId = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-title`;
  return (
    <header className="page-header">
      <div className="page-heading-copy">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1 id={titleId}>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

function HeaderSearch({ onOpen, buttonRef }) {
  return (
    <button
      ref={buttonRef}
      className="header-search-trigger"
      type="button"
      onClick={onOpen}
      aria-label="Open quick search"
    >
      <IconSearch size={15} />
      <span>Search</span>
      <kbd>⌘K</kbd>
    </button>
  );
}

function HeaderQuota({ remaining, limit, onOpen, plan = "free" }) {
  const isPro = plan === "pro";
  const isUnknown = plan === "unknown";
  const state = isPro ? "pro" : isUnknown ? "unknown" : remaining === 0 ? "empty" : remaining === 1 ? "low" : "available";
  const title = "AI writing";
  const detail = isPro
    ? "Unlimited with Pro"
    : isUnknown
      ? "Plan status unavailable"
    : state === "empty"
      ? "No free uses left"
      : remaining === 1
        ? "1 free use left"
        : `${remaining} of ${limit} free uses left`;
  const ariaLabel = isPro
    ? "AI writing is unlimited with Pro. Open subscription."
    : isUnknown
      ? "AI writing plan status is unavailable. Open license."
    : state === "empty"
      ? "AI writing: no free uses remaining. Open subscription."
      : `AI writing: ${remaining} of ${limit} free uses remaining. Open subscription.`;
  const usedPercent = isPro ? 100 : isUnknown ? 0 : Math.round(((limit - remaining) / limit) * 100);

  return (
    <button
      type="button"
      className={`header-quota is-${state}`}
      onClick={onOpen}
      aria-label={ariaLabel}
    >
      <span
        className="header-quota-ring"
        style={{ "--quota-used": `${usedPercent}%` }}
        aria-hidden="true"
      />
      <span className="header-quota-copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span
        className={`header-quota-cta${isPro ? " is-active" : ""}`}
        aria-hidden="true"
      >
        {isPro ? "Active" : isUnknown ? "Check" : "Upgrade"}
      </span>
    </button>
  );
}

function GlobalSearch({ docs, onClose, onNavigate, showToast }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const normalized = query.trim().toLowerCase();
  const workflows = [
    { id: "component", label: "Component docs", detail: "Document the current Figma selection", icon: IconFileDescription },
    { id: "library", label: "Library", detail: "Maintain connected documentation", icon: IconFolder },
    { id: "foundations", label: "Foundation docs", detail: "Generate system documentation", icon: IconLayoutGrid },
    { id: "settings", label: "Settings", detail: "Output, AI, and appearance", icon: IconSettings },
    { id: "subscription", label: "License", detail: "Plan and license", icon: IconKey },
  ];
  const workflowResults = workflows.filter((item) => (
    !normalized || `${item.label} ${item.detail}`.toLowerCase().includes(normalized)
  ));
  const matchingDocs = docs.filter((doc) => (
    !normalized || `${doc.name} ${doc.source}`.toLowerCase().includes(normalized)
  ));
  const docResults = matchingDocs.slice(0, normalized ? 8 : 4);
  const results = [
    ...workflowResults.map((item) => ({ kind: "workflow", item })),
    ...docResults.map((item) => ({ kind: "document", item })),
  ];
  const selectedIndex = results.length ? Math.min(activeIndex, results.length - 1) : 0;

  const goToWorkflow = (id) => {
    onNavigate(id);
    onClose();
  };

  const openDoc = (doc) => {
    onNavigate("library");
    showToast(`Opening ${doc.name} in Figma`);
    onClose();
  };

  const activateResult = (result) => {
    if (!result) return;
    if (result.kind === "workflow") goToWorkflow(result.item.id);
    else openDoc(result.item);
  };

  const handleInputKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(results.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activateResult(results[selectedIndex]);
    }
  };

  const handleDialogKeyDown = (event) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll("input:not([disabled]), button:not([disabled])"),
    ).filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    document.getElementById(`global-search-result-${selectedIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  let resultIndex = -1;

  return (
    <div className="global-search-layer" role="dialog" aria-modal="true" aria-label="Quick search" onKeyDown={handleDialogKeyDown}>
      <div className="global-search-scrim" onClick={onClose} aria-hidden="true" />
      <div className="global-search-panel">
        <div className="global-search-input">
          <IconSearch size={17} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search workflows and library…"
            aria-label="Search workflows and library"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="global-search-results"
            aria-activedescendant={results.length ? `global-search-result-${selectedIndex}` : undefined}
          />
          {query ? (
            <button className="global-search-clear" type="button" onClick={() => setQuery("")}>
              Clear
            </button>
          ) : null}
          <button className="global-search-close" type="button" onClick={onClose} aria-label="Close quick search">
            <IconX size={15} />
          </button>
        </div>
        <div className="global-search-results" id="global-search-results" role="listbox" aria-label="Search results">
          {workflowResults.length ? (
            <section>
              <h2>Workflows</h2>
              {workflowResults.map((item) => {
                const Icon = item.icon;
                resultIndex += 1;
                const index = resultIndex;
                return (
                  <button
                    type="button"
                    role="option"
                    id={`global-search-result-${index}`}
                    aria-selected={selectedIndex === index}
                    className={selectedIndex === index ? "is-active" : ""}
                    key={item.id}
                    onClick={() => goToWorkflow(item.id)}
                    onMouseEnter={() => setActiveIndex(index)}
                    onFocus={() => setActiveIndex(index)}
                  >
                    <span className="search-result-icon"><Icon size={15} /></span>
                    <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                    <IconChevronRight size={14} />
                  </button>
                );
              })}
            </section>
          ) : null}
          {docResults.length ? (
            <section>
              <h2>Library</h2>
              {docResults.map((doc) => {
                resultIndex += 1;
                const index = resultIndex;
                return (
                  <button
                    type="button"
                    role="option"
                    id={`global-search-result-${index}`}
                    aria-selected={selectedIndex === index}
                    className={selectedIndex === index ? "is-active" : ""}
                    key={doc.id}
                    onClick={() => openDoc(doc)}
                    onMouseEnter={() => setActiveIndex(index)}
                    onFocus={() => setActiveIndex(index)}
                  >
                    <span className="search-result-icon is-source"><IconPuzzle size={15} /></span>
                    <span><strong>{doc.name}</strong><small>{doc.source}</small></span>
                    <IconChevronRight size={14} />
                  </button>
                );
              })}
            </section>
          ) : null}
          {!workflowResults.length && !docResults.length ? (
            <div className="global-search-empty">
              <IconSearch size={18} />
              <strong>No matches for “{query.trim()}”</strong>
              <small>Try a component, source, or workflow name.</small>
              <button type="button" onClick={() => setQuery("")}>Clear search</button>
            </div>
          ) : null}
        </div>
        <div className="global-search-footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}

const quotaPreviewStates = [
  { id: "available", label: "Free · Available", note: "Default state", remaining: 4, plan: "free" },
  { id: "low", label: "Free · Low", note: "One free use left", remaining: 1, plan: "free" },
  { id: "empty", label: "Free · Exhausted", note: "Upgrade prompt", remaining: 0, plan: "free" },
  { id: "pro", label: "Pro · Unlimited", note: "Unlimited AI writing", remaining: 5, plan: "pro" },
];

function QuotaStatesShowcase() {
  return (
    <main className="quota-showcase-stage">
      <section className="quota-showcase" aria-label="AI quota header states">
        <header className="quota-showcase-heading">
          <span>
            <strong>AI writing states</strong>
            <small>Header treatment at the native 480px plugin width</small>
          </span>
          <a href="/">Back to plugin</a>
        </header>
        <div className="quota-showcase-list">
          {quotaPreviewStates.map((state) => (
            <article className="quota-state-card" key={state.id}>
              <div className="quota-state-meta">
                <strong>{state.label}</strong>
                <small>{state.note}</small>
              </div>
              <div className="topbar quota-preview-bar">
                <HeaderQuota remaining={state.remaining} limit={5} plan={state.plan} onOpen={() => {}} />
                <a className="header-icon-link" href="https://spec-layer.com/" target="_blank" rel="noreferrer" aria-label={`Visit Spec Layer website in ${state.label} preview`}><IconWorld size={16} /></a>
                <a className="header-icon-link" href="https://www.linkedin.com/in/alexkurchev/" target="_blank" rel="noreferrer" aria-label={`Visit Spec Layer on LinkedIn in ${state.label} preview`}><IconBrandLinkedin size={16} /></a>
                <button className="header-theme-button" type="button" aria-label={`Theme switcher in ${state.label} preview`}><IconSun size={16} /></button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function Status({ type }) {
  const isUpdate = type === "update";
  return (
    <span className={`status ${isUpdate ? "status-update" : "status-sync"}`}>
      <span className="status-dot" />
      {isUpdate ? "Update available" : "In sync"}
    </span>
  );
}

function EmptyState({ title, body, action, onAction }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><IconCircleCheck size={22} /></span>
      <strong>{title}</strong>
      <p>{body}</p>
      {action ? <button className="button button-secondary" onClick={onAction}>{action}</button> : null}
    </div>
  );
}

function LibraryView({ docs, setDocs, showToast }) {
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState("buttonText");
  const [openMenu, setOpenMenu] = useState(null);
  const [updating, setUpdating] = useState(null);

  const updates = docs.filter((doc) => doc.status === "update");
  const visibleDocs = filter === "all"
    ? docs
    : docs.filter((doc) => (filter === "updates" ? doc.status === "update" : doc.status === "sync"));

  const updateDoc = (id) => {
    setOpenMenu(null);
    setUpdating(id);
    window.setTimeout(() => {
      setDocs((current) => current.map((doc) => (
        doc.id === id ? { ...doc, status: "sync", age: "just now" } : doc
      )));
      setUpdating(null);
      setExpanded(null);
      showToast("Documentation updated", "success");
    }, 700);
  };

  const updateAll = () => {
    setUpdating("all");
    window.setTimeout(() => {
      setDocs((current) => current.map((doc) => (
        doc.status === "update" ? { ...doc, status: "sync", age: "just now" } : doc
      )));
      setUpdating(null);
      setExpanded(null);
      showToast(`${updates.length} documentation frames updated`, "success");
    }, 900);
  };

  const refreshLibrary = () => {
    setUpdating("refresh");
    window.setTimeout(() => {
      setUpdating(null);
      showToast("Library refreshed", "success");
    }, 700);
  };

  const runMenuAction = (action, doc) => {
    setOpenMenu(null);
    if (action === "changes") {
      setExpanded((current) => current === doc.id ? null : doc.id);
      return;
    }
    if (action === "update") {
      updateDoc(doc.id);
      return;
    }
    if (action === "remove") {
      showToast("Remove connection would ask for confirmation");
      return;
    }
    const messages = {
      frame: `Opening ${doc.name} documentation in Figma`,
      source: `Locating ${doc.name} source component`,
      reconnect: `Reconnecting ${doc.name}`,
    };
    showToast(messages[action]);
  };

  return (
    <section className="screen library-screen" aria-labelledby="library-title">
      <PageHeader title="Library" />
      <div className="segmented filter-tabs" role="tablist" aria-label="Library filters">
        <button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>All <span className="filter-count">{docs.length + 7}</span></button>
        <button className={`updates-tab ${filter === "updates" ? "selected" : ""}`} onClick={() => setFilter("updates")}>Updates <span className="filter-count">{updates.length}</span></button>
        <button className={filter === "sync" ? "selected" : ""} onClick={() => setFilter("sync")}>In sync <span className="filter-count">{docs.filter((doc) => doc.status === "sync").length + 7}</span></button>
      </div>
      <div className="list-scroll" key={filter}>
        {visibleDocs.length ? (
          <div className="doc-list">
            {visibleDocs.map((doc) => {
              const isExpanded = expanded === doc.id;
              return (
                <article className={`doc-row ${isExpanded ? "is-expanded" : ""}`} key={doc.id}>
                  <div className="doc-summary">
                    <button
                      type="button"
                      className="doc-jump"
                      onClick={() => showToast(`Opening ${doc.name} in Figma`)}
                      aria-label={`Open ${doc.name} in Figma`}
                    >
                      <span className="source-icon"><IconPuzzle size={17} stroke={1.9} /></span>
                      <span className="doc-identity">
                        <strong>{doc.name}</strong>
                        <small>{doc.source}</small>
                      </span>
                    </button>
                    {doc.status === "update" ? (
                      <button
                        className="update-status-button"
                        onClick={() => setExpanded(isExpanded ? null : doc.id)}
                        aria-expanded={isExpanded}
                        aria-label={`Review changes for ${doc.name}`}
                      >
                        <Status type={doc.status} />
                        <IconChevronDown className={isExpanded ? "rotated" : ""} size={14} />
                      </button>
                    ) : (
                      <Status type={doc.status} />
                    )}
                    <time>{doc.age}</time>
                    <button
                      className="row-menu-button"
                      onClick={() => setOpenMenu(openMenu === doc.id ? null : doc.id)}
                      aria-label={`Actions for ${doc.name}`}
                      aria-expanded={openMenu === doc.id}
                    >
                      <IconDots size={17} />
                    </button>
                  </div>
                  <div className="doc-details" aria-hidden={!isExpanded}>
                    <div className="details-inner">
                      <div className="changes-heading">
                        <span>Changes</span>
                      </div>
                      <div className="detected-changes">
                        {doc.changeDetails?.length ? doc.changeDetails.map((group) => (
                          <section className="change-group" key={group.label}>
                            <div className="change-group-heading">
                              <strong>{group.label}</strong>
                            </div>
                            <ul>
                              {group.items.map((item) => <li key={item}>{item}</li>)}
                            </ul>
                          </section>
                        )) : (
                          <div className="change-fallback">
                            <IconAlertCircle size={16} />
                            <span>
                              <strong>Source changed</strong>
                              <small>A detailed comparison isn't available. Review the source from the row menu.</small>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {openMenu === doc.id ? (
                    <>
                      <button className="menu-scrim" aria-label="Close actions menu" onClick={() => setOpenMenu(null)} />
                      <div className="row-overflow-menu" role="menu" aria-label={`Actions for ${doc.name}`}>
                        {doc.status === "update" ? (
                          <>
                            <button role="menuitem" onClick={() => runMenuAction("changes", doc)}><IconAdjustments size={15} />{isExpanded ? "Hide detected changes" : "Review detected changes"}</button>
                            <button role="menuitem" onClick={() => runMenuAction("update", doc)} disabled={updating !== null}><IconRefresh size={15} />Update documentation</button>
                            <span className="menu-separator" />
                          </>
                        ) : null}
                        <button role="menuitem" onClick={() => runMenuAction("frame", doc)}><IconExternalLink size={15} />Open documentation frame</button>
                        <button role="menuitem" onClick={() => runMenuAction("source", doc)}><IconLink size={15} />View source component</button>
                        <button role="menuitem" onClick={() => runMenuAction("reconnect", doc)}><IconRefresh size={15} />Reconnect</button>
                        <span className="menu-separator" />
                        <button className="danger" role="menuitem" onClick={() => runMenuAction("remove", doc)}><IconTrash size={15} />Remove connection</button>
                      </div>
                    </>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState title="Everything is in sync" body="There are no documentation updates waiting." action="View all docs" onAction={() => setFilter("all")} />
        )}
      </div>
      <footer className="screen-footer library-footer">
        <button className="button button-secondary" onClick={refreshLibrary} disabled={updating !== null}>
          <IconRefresh size={16} />
          {updating === "refresh" ? "Refreshing…" : "Refresh library"}
        </button>
        <button className="button button-primary batch-button" onClick={updateAll} disabled={!updates.length || updating !== null}>
          <IconRefresh size={16} />
          {updating === "all" ? "Updating…" : updates.length ? `Update all ${updates.length}` : "Up to date"}
        </button>
      </footer>
    </section>
  );
}

function CheckRow({ label, checked, onChange, trailing, children }) {
  return (
    <div className={`check-row ${children ? "has-details" : ""}`}>
      <button
        className="check-summary"
        onClick={onChange}
        type="button"
        aria-pressed={checked}
        aria-label={`${checked ? "Remove" : "Include"} ${label} ${checked ? "from" : "in"} docs`}
      >
        <InclusionCheckbox checked={checked} />
        <span>{label}</span>
        {trailing ? <span className="row-trailing">{trailing}</span> : null}
      </button>
      {children ? <div className="check-details">{children}</div> : null}
    </div>
  );
}

function InclusionCheckbox({ checked, mixed = false }) {
  return (
    <span className={`check-box ${checked ? "checked" : ""} ${mixed ? "mixed" : ""}`} aria-hidden="true">
      {checked ? <IconCheck size={13} stroke={3} /> : mixed ? <IconMinus size={12} stroke={3} /> : null}
    </span>
  );
}

function ComponentView({ showToast, aiEnabled, setAiEnabled, quotaRemaining, onConsumeQuota }) {
  const [selected, setSelected] = useState({
    overview: true,
    variants: true,
    dos: true,
    related: false,
    anatomy: true,
    measurements: true,
    configuration: true,
    states: true,
    tokens: true,
    interactions: true,
    contentConsiderations: true,
    accessibility: true,
  });
  const [open, setOpen] = useState(() => {
    const requestedSection = new URLSearchParams(window.location.search).get("section");
    return ["content", "specs", "a11y"].includes(requestedSection) ? requestedSection : "content";
  });
  const [anatomy, setAnatomy] = useState("diagram");
  const [measurementSelections, setMeasurementSelections] = useState({
    size: true,
    padding: true,
    spacing: true,
  });
  const [created, setCreated] = useState(false);
  const toggle = (key) => setSelected((current) => ({ ...current, [key]: !current[key] }));
  const toggleMeasurement = (key) => {
    setMeasurementSelections((current) => ({ ...current, [key]: !current[key] }));
  };
  const usageCount = ["overview", "variants", "dos", "related"].filter((key) => selected[key]).length;
  const specificationsCount = ["anatomy", "measurements", "configuration", "states", "tokens"].filter((key) => selected[key]).length;
  const accessibilityCount = ["interactions", "contentConsiderations", "accessibility"].filter((key) => selected[key]).length;
  const aiLabel = aiEnabled
    ? <span className="ai-row-badge" aria-label="AI layer">AI</span>
    : null;
  const createDocs = () => {
    if (aiEnabled && quotaRemaining === 0) {
      showToast("No free AI writing uses left. Turn AI off or upgrade.");
      return;
    }
    if (aiEnabled) onConsumeQuota();
    setCreated(true);
    showToast("Documentation frame created", "success");
  };

  return (
    <section className="screen component-screen">
      <PageHeader
        title="buttonPrimary"
        eyebrow="Selected component"
      />
      <div className={`ai-control-panel ${aiEnabled ? "is-enabled" : ""}`}>
        <span className="ai-control-copy">
          <strong>AI writing</strong>
          <span className="ai-help">
            <button
              type="button"
              className="ai-help-button"
              aria-label="How AI writing works"
              aria-describedby="ai-writing-tooltip"
            >
              <IconInfoCircle size={14} />
            </button>
            <span className="ai-tooltip" id="ai-writing-tooltip" role="tooltip">
              AI can assist sections labeled AI. Component data, measurements, states, and tokens still come directly from Figma. Creating docs uses one free AI writing use when this is on.
            </span>
          </span>
        </span>
        <button
          className={`switch-button ${aiEnabled ? "on" : ""}`}
          onClick={() => setAiEnabled(!aiEnabled)}
          role="switch"
          aria-checked={aiEnabled}
          aria-label="AI writing"
        >
          <i />
        </button>
      </div>
      <div className="component-scroll">
        <div className="component-selection-intro">
          <strong>Sections to include</strong>
        </div>
        <div className="section-group">
          <button className="section-header" onClick={() => setOpen(open === "content" ? "" : "content")}>
            <span><IconFileDescription size={17} />Usage</span>
            <small>{usageCount} of 4 included</small>
            <IconChevronDown className={open === "content" ? "rotated" : ""} size={16} />
          </button>
          <div className={`section-body ${open === "content" ? "visible" : ""}`}>
            <CheckRow label="Overview" checked={selected.overview} onChange={() => toggle("overview")} trailing={aiLabel} />
            <CheckRow label="Variants" checked={selected.variants} onChange={() => toggle("variants")} trailing={aiLabel} />
            <CheckRow label="Do’s & Don’ts" checked={selected.dos} onChange={() => toggle("dos")} trailing={aiLabel} />
            <CheckRow label="Related components" checked={selected.related} onChange={() => toggle("related")} />
          </div>
        </div>
        <div className="section-group">
          <button className="section-header" onClick={() => setOpen(open === "specs" ? "" : "specs")}>
            <span><IconBox size={17} />Specifications</span>
            <small>{specificationsCount} of 5 included</small>
            <IconChevronDown className={open === "specs" ? "rotated" : ""} size={16} />
          </button>
          <div className={`section-body ${open === "specs" ? "visible" : ""}`}>
            <CheckRow label="Anatomy" checked={selected.anatomy} onChange={() => toggle("anatomy")}>
              <div className="inline-control">
                <small>Show as</small>
                <div className="segmented mini-segmented">
                  {["diagram", "table", "both"].map((value) => (
                    <button key={value} className={anatomy === value ? "selected" : ""} onClick={(event) => { event.stopPropagation(); setAnatomy(value); }}>
                      {value[0].toUpperCase() + value.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </CheckRow>
            <CheckRow label="Measurements" checked={selected.measurements} onChange={() => toggle("measurements")}>
              <div className="measure-options" role="group" aria-label="Measurements to include">
                {measurementOptions.map(({ id, label }) => {
                  const isSelected = measurementSelections[id];
                  return (
                    <button
                      className={`measure-chip ${isSelected ? "selected" : ""}`}
                      key={id}
                      type="button"
                      aria-pressed={isSelected}
                      disabled={!selected.measurements}
                      onClick={() => toggleMeasurement(id)}
                    >
                      <span className="measure-chip-check" aria-hidden="true">
                        {isSelected ? <IconCheck size={12} stroke={2.4} /> : null}
                      </span>
                      {label}
                    </button>
                  );
                })}
              </div>
            </CheckRow>
            <CheckRow label="Configuration" checked={selected.configuration} onChange={() => toggle("configuration")} />
            <CheckRow label="States" checked={selected.states} onChange={() => toggle("states")} />
            <CheckRow label="Tokens used" checked={selected.tokens} onChange={() => toggle("tokens")} />
          </div>
        </div>
        <div className="section-group">
          <button className="section-header" onClick={() => setOpen(open === "a11y" ? "" : "a11y")}>
            <span><IconAccessible size={17} />Accessibility</span>
            <small>{accessibilityCount} of 3 included</small>
            <IconChevronDown className={open === "a11y" ? "rotated" : ""} size={16} />
          </button>
          <div className={`section-body ${open === "a11y" ? "visible" : ""}`}>
            <CheckRow label="Interactions" checked={selected.interactions} onChange={() => toggle("interactions")} trailing={aiLabel} />
            <CheckRow label="Content considerations" checked={selected.contentConsiderations} onChange={() => toggle("contentConsiderations")} trailing={aiLabel} />
            <CheckRow label="Semantics & focus" checked={selected.accessibility} onChange={() => toggle("accessibility")} trailing={aiLabel} />
          </div>
        </div>
      </div>
      <footer className="screen-footer component-footer">
        {created ? <span className="component-created-status"><IconCircleCheck size={15} />Docs created</span> : null}
        {created ? <button className="button button-quiet" onClick={() => showToast("Documentation downloaded", "success")}><IconDownload size={16} />Download</button> : null}
        <button className="button button-primary" onClick={createDocs}>
          <IconFileDescription size={15} />
          Create docs
        </button>
      </footer>
    </section>
  );
}

function UpdatesView({ docs, setDocs, showToast }) {
  const updates = docs.filter((doc) => doc.status === "update");
  const [checked, setChecked] = useState(() => updates.map((doc) => doc.id));
  const [running, setRunning] = useState(false);
  const toggle = (id) => setChecked((current) => (
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
  ));

  const runUpdates = () => {
    setRunning(true);
    window.setTimeout(() => {
      setDocs((current) => current.map((doc) => (
        checked.includes(doc.id) ? { ...doc, status: "sync", age: "just now" } : doc
      )));
      setRunning(false);
      showToast(`${checked.length} selected docs updated`, "success");
    }, 1000);
  };

  return (
    <section className="screen updates-screen">
      <PageHeader
        title="Update queue"
        subtitle="Review source changes before updating connected docs."
        actions={<button className="compact-action" aria-label="More update actions"><IconDots size={18} /></button>}
      />
      <div className="queue-toolbar">
        <button className="select-all" onClick={() => setChecked(checked.length === updates.length ? [] : updates.map((doc) => doc.id))}>
          <span className={`check-box ${checked.length === updates.length ? "checked" : ""}`}>{checked.length === updates.length ? <IconCheck size={13} /> : null}</span>
          Select all
        </button>
        <span>{checked.length} selected</span>
      </div>
      <div className="queue-list">
        {updates.length ? updates.map((doc) => (
          <article className={`queue-row ${checked.includes(doc.id) ? "selected" : ""}`} key={doc.id}>
            <button className="queue-main" onClick={() => toggle(doc.id)} aria-pressed={checked.includes(doc.id)}>
              <span className={`check-box ${checked.includes(doc.id) ? "checked" : ""}`}>{checked.includes(doc.id) ? <IconCheck size={13} /> : null}</span>
              <span className="source-icon"><IconPuzzle size={17} /></span>
              <span>
                <strong>{doc.name}</strong>
                <small>{doc.source}</small>
              </span>
              <Status type="update" />
            </button>
            <div className="queue-changes">
              {doc.changes.map((change) => <span key={change}>{change}</span>)}
              <button>Review <IconChevronRight size={14} /></button>
            </div>
          </article>
        )) : <EmptyState title="Queue is clear" body="All connected documentation is up to date." />}
      </div>
      <footer className="screen-footer">
        <span className="footer-summary"><IconAlertCircle size={14} />Updates only change generated frames</span>
        <button className="button button-primary" disabled={!checked.length || running || !updates.length} onClick={runUpdates}>
          <IconRefresh size={16} />
          {running ? "Updating…" : `Update ${checked.length || ""} selected`}
        </button>
      </footer>
    </section>
  );
}

function FoundationsView({ showToast, quotaRemaining, onConsumeQuota }) {
  const [items, setItems] = useState(foundationSeed);
  const selectedCount = items.filter((item) => item.selected).length;
  const allSelected = selectedCount === items.length;
  const partiallySelected = selectedCount > 0 && !allSelected;
  const frameCount = items.filter((item) => item.selected).reduce((sum, item) => sum + (item.id === "foundation" ? 5 : 1), 0);
  const toggle = (id) => setItems((current) => current.map((item) => (
    item.id === id ? { ...item, selected: !item.selected } : item
  )));
  const toggleAll = () => setItems((current) => current.map((item) => ({ ...item, selected: !allSelected })));
  const createFoundations = () => {
    if (quotaRemaining === 0) {
      showToast("AI quota reached. Upgrade to create foundation documents.");
      return;
    }
    onConsumeQuota();
    showToast(`${frameCount} foundation frames created`, "success");
  };

  return (
    <section className="screen foundations-screen">
      <PageHeader title="Foundation documents" />
      <div className="foundation-toolbar">
        <span aria-live="polite">{selectedCount} of {items.length} included</span>
        <button
          className="foundation-bulk-toggle"
          type="button"
          onClick={toggleAll}
          aria-label={`${allSelected ? "Clear" : "Select"} all foundation sources`}
        >
          <InclusionCheckbox checked={allSelected} mixed={partiallySelected} />
          <span>{allSelected ? "Clear all" : "Select all"}</span>
        </button>
      </div>
      <div className="foundation-list">
        {items.map((item) => (
          <article className="foundation-row" key={item.id}>
            <button
              className="foundation-summary"
              type="button"
              onClick={() => toggle(item.id)}
              aria-label={`${item.selected ? "Remove" : "Include"} ${item.name} ${item.selected ? "from" : "in"} docs`}
              aria-pressed={item.selected}
            >
                <InclusionCheckbox checked={item.selected} />
                <span className="source-icon"><IconPuzzle size={17} /></span>
                <span className="foundation-title">
                  <strong>{item.name}</strong>
                  <small>{item.detail}</small>
                </span>
            </button>
          </article>
        ))}
      </div>
      <footer className="screen-footer">
        <button className="button button-primary foundation-create-button" disabled={!frameCount} onClick={createFoundations}>
          {frameCount ? `Create ${frameCount} frames` : "Select sources to continue"}
        </button>
      </footer>
    </section>
  );
}

function StylesView({ showToast }) {
  const styles = [
    ["Display / Large", "48 / 56 · Semibold"],
    ["Heading / H1", "32 / 40 · Semibold"],
    ["Heading / H2", "24 / 32 · Semibold"],
    ["Body / Regular", "16 / 24 · Regular"],
    ["Body / Small", "14 / 20 · Regular"],
    ["Label / Medium", "12 / 16 · Medium"],
  ];
  return (
    <section className="screen styles-screen">
      <PageHeader title="Text styles" subtitle="21 local styles · 6 groups" actions={<button className="compact-action" aria-label="Search text styles"><IconSearch size={17} /></button>} />
      <div className="styles-list">
        {styles.map(([name, meta]) => (
          <button className="style-row" key={name}>
            <span className="type-sample">Ag</span>
            <span><strong>{name}</strong><small>{meta}</small></span>
            <IconChevronRight size={15} />
          </button>
        ))}
      </div>
      <footer className="screen-footer">
        <span className="footer-summary">21 styles selected</span>
        <button className="button button-primary" onClick={() => showToast("Text style frame created", "success")}>Create frame</button>
      </footer>
    </section>
  );
}

function LicenseStatusMessage({ state }) {
  const message = licenseStatusMessages[state];
  if (!message) return null;
  const Icon = message.tone === "success"
    ? IconCircleCheck
    : message.tone === "neutral"
      ? IconInfoCircle
      : IconAlertCircle;

  return (
    <div className={`license-status-message is-${message.tone}`} role={message.tone === "danger" ? "alert" : "status"}>
      <Icon size={16} />
      <span>
        <strong>{message.title}</strong>
        <small>{message.detail}</small>
      </span>
    </div>
  );
}

function LicenseView({
  licenseState,
  setLicenseState,
  licenseKey,
  setLicenseKey,
  quotaRemaining,
  quotaLimit,
  showToast,
}) {
  const [licenseInput, setLicenseInput] = useState(licenseKey);
  const isPro = licenseState === "pro" || licenseState === "removing";
  const isUnknown = licenseState === "unknown";
  const hasStoredKey = storedLicenseStates.has(licenseState);
  const isChecking = licenseState === "checking";
  const isRemoving = licenseState === "removing";
  const canActivate = licenseInput.trim().length > 0 && !isChecking;

  const activateLicense = () => {
    const key = licenseInput.trim();
    if (!key || isChecking) return;
    setLicenseState("checking");
    window.setTimeout(() => {
      const normalized = key.toUpperCase();
      if (normalized.includes("EXPIRED")) {
        setLicenseKey(key);
        setLicenseState("expired");
      } else if (normalized.includes("SAVED")) {
        setLicenseKey(key);
        setLicenseState("unknown");
      } else if (normalized.includes("INACTIVE")) {
        setLicenseKey(key);
        setLicenseState("inactive");
      } else if (normalized.includes("DISABLED")) {
        setLicenseState("disabled");
      } else if (normalized.includes("DEVICE")) {
        setLicenseState("device-limit");
      } else if (normalized.includes("OFFLINE")) {
        setLicenseState("unreachable");
      } else if (normalized.startsWith("SPEC-PRO")) {
        setLicenseKey(key);
        setLicenseState("pro");
        showToast("Pro plan activated", "success");
      } else {
        setLicenseState("invalid");
      }
    }, 700);
  };

  const removeLicense = () => {
    if (isRemoving) return;
    setLicenseState("removing");
    window.setTimeout(() => {
      setLicenseKey("");
      setLicenseInput("");
      setLicenseState("removed");
      showToast("License removed from this device", "success");
    }, 650);
  };

  const reconnectLicense = () => {
    setLicenseInput(licenseKey);
    setLicenseState("inactive");
  };

  return (
    <section className="screen settings-screen license-screen">
      <PageHeader title="License" />
      <div className="settings-scroll license-scroll">
        <section className={`license-plan-card ${isPro ? "is-pro" : ""}`}>
          <div className="license-plan-heading">
            <span className="plan-icon"><IconBolt size={17} /></span>
            <span>
              <strong>{isPro ? "Pro plan" : isUnknown ? "Pro key saved" : "Free plan"}</strong>
              <small>{isPro ? "Unlimited documentation maintenance" : isUnknown ? "Verification is temporarily unavailable" : "For lighter AI-assisted documentation"}</small>
            </span>
            <span className="license-plan-badge">
              {isUnknown ? <IconInfoCircle size={12} /> : <IconCheck size={12} />}
              {isPro ? "Active" : isUnknown ? "Unverified" : "Current"}
            </span>
          </div>

          {isPro ? (
            <div className="license-pro-benefits">
              <span><IconCheck size={13} />Unlimited AI writing</span>
              <span><IconCheck size={13} />Unlimited library maintenance</span>
            </div>
          ) : isUnknown ? (
            <div className="license-unknown-note">
              <IconInfoCircle size={14} />
              Your saved key stays connected until verification succeeds.
            </div>
          ) : (
            <div className="license-usage">
              <div className="license-usage-copy">
                <span><strong>AI writing</strong><small>Resets August 1</small></span>
                <span>{quotaRemaining} of {quotaLimit} free uses left</span>
              </div>
              <span className="license-usage-track" aria-hidden="true">
                <i style={{ width: `${Math.round((quotaRemaining / quotaLimit) * 100)}%` }} />
              </span>
            </div>
          )}

          <div className="license-plan-actions">
            {isPro ? (
              <button className="button button-secondary" type="button">
                Manage subscription <IconExternalLink size={14} />
              </button>
            ) : isUnknown ? null : (
              <button className="button button-primary" type="button">
                Upgrade to Pro <IconExternalLink size={14} />
              </button>
            )}
          </div>
        </section>

        <section className="license-activation-section">
          {isPro ? (
            <>
              <div className="settings-section-heading">
                <h2>Connected license</h2>
                <p>This key is active on this Figma plugin.</p>
              </div>
              <div className="connected-license">
                <span className="connected-license-icon"><IconKey size={16} /></span>
                <span>
                  <strong>•••• •••• •••• {licenseKey.slice(-4).toUpperCase()}</strong>
                  <small>Figma plugin · This device</small>
                </span>
                <span className="connected-license-status">
                  {isRemoving ? <IconRefresh className="license-spinner" size={14} /> : <IconCircleCheck size={14} />}
                  {isRemoving ? "Disconnecting" : "Connected"}
                </span>
              </div>
              <div className="connected-license-actions">
                <button className="button button-quiet is-danger" type="button" onClick={removeLicense} disabled={isRemoving}>
                  {isRemoving ? "Removing…" : "Remove key"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="settings-section-heading">
                <h2>{hasStoredKey ? "Saved license" : "Activate Pro"}</h2>
                <p>{hasStoredKey ? "Reconnect or manage the license saved on this device." : "Paste the key from your purchase email."}</p>
              </div>

              {!["removed", "unknown"].includes(licenseState) ? <LicenseStatusMessage state={licenseState} /> : null}

              {hasStoredKey && licenseState === "unknown" ? (
                <div className="saved-license-row">
                  <span><IconKey size={15} /><strong>•••• •••• •••• {licenseKey.slice(-4).toUpperCase()}</strong></span>
                  <button className="button button-secondary" type="button" onClick={reconnectLicense}>Retry</button>
                </div>
              ) : (
                <form
                  className="license-activation-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    activateLicense();
                  }}
                >
                  <label className="license-field">
                    <span className="sr-only">Pro license key</span>
                    <IconKey size={15} />
                    <input
                      type="password"
                      value={licenseInput}
                      placeholder="XXXXXXXX-XXXX-XXXX-XXXX"
                      autoComplete="off"
                      onChange={(event) => {
                        setLicenseInput(event.target.value);
                        if (["invalid", "disabled", "device-limit", "unreachable", "removed"].includes(licenseState)) {
                          setLicenseState("free");
                        }
                      }}
                      disabled={isChecking || isRemoving}
                    />
                  </label>
                  <button className="button button-primary" type="submit" disabled={!canActivate}>
                    {isChecking ? <><IconRefresh className="license-spinner" size={14} />Checking…</> : hasStoredKey ? "Reconnect" : "Activate"}
                  </button>
                </form>
              )}

              {licenseState === "removed" ? <LicenseStatusMessage state="removed" /> : null}

              <div className="license-support-actions">
                {licenseState === "expired" ? (
                  <button className="button button-secondary" type="button">
                    Renew Pro <IconExternalLink size={14} />
                  </button>
                ) : null}
                {["expired", "device-limit", "unknown"].includes(licenseState) ? (
                  <button className="button button-quiet" type="button">Manage subscription</button>
                ) : null}
                {licenseState === "disabled" ? <button className="button button-quiet" type="button">Contact support</button> : null}
                {hasStoredKey ? (
                  <button className="button button-quiet is-danger" type="button" onClick={removeLicense} disabled={isRemoving}>
                    {isRemoving ? <><IconRefresh className="license-spinner" size={14} />Removing…</> : "Remove key from this device"}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function SettingsView({ showToast }) {
  const [theme, setTheme] = useState("tech");
  const [customTheme, setCustomTheme] = useState({
    header: "#0f172a",
    accent: "#2563eb",
    body: "#334155",
    table: "#f8fafc",
    headingFont: "Inter",
    bodyFont: "Inter",
  });
  const [logoAttached, setLogoAttached] = useState(false);
  const updateCustomTheme = (field, value) => {
    setCustomTheme((current) => ({ ...current, [field]: value }));
  };

  return (
    <section className="screen settings-screen">
      <PageHeader title="Settings" subtitle="Generated frame appearance" />
      <div className="settings-scroll">
        <div className="settings-section frame-theme-section">
            <div className="settings-section-heading">
              <h2>Frame theme</h2>
              <p>Choose a theme for generated documentation frames.</p>
            </div>
            <div className="theme-grid" role="group" aria-label="Frame theme">
              {frameThemeOptions.map((item) => (
                <button
                  key={item}
                  className={theme === item ? "selected" : ""}
                  type="button"
                  aria-pressed={theme === item}
                  aria-label={`${item[0].toUpperCase() + item.slice(1)} frame theme`}
                  onClick={() => setTheme(item)}
                >
                  <span className={`theme-preview ${item}`}>
                    {item === "custom" ? <IconAdjustments size={16} /> : "Ag"}
                  </span>
                  {item[0].toUpperCase() + item.slice(1)}
                  {theme === item ? <IconCheck size={12} /> : null}
                </button>
              ))}
            </div>

            {theme === "custom" ? (
              <div className="custom-theme-controls">
                <h3>Customize</h3>
                <div className="theme-color-grid">
                  {customThemeColorFields.map(([field, label]) => (
                    <label key={field}>
                      <span>{label}</span>
                      <span className="theme-color-input">
                        <i style={{ background: customTheme[field] }} />
                        <input
                          aria-label={`${label} color`}
                          value={customTheme[field]}
                          onChange={(event) => updateCustomTheme(field, event.target.value)}
                        />
                      </span>
                    </label>
                  ))}
                </div>
                <div className="theme-font-grid">
                  <label>
                    <span>Heading font</span>
                    <input
                      value={customTheme.headingFont}
                      onChange={(event) => updateCustomTheme("headingFont", event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Body font</span>
                    <input
                      value={customTheme.bodyFont}
                      onChange={(event) => updateCustomTheme("bodyFont", event.target.value)}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            <div className="logo-setting">
              <h3>Logo</h3>
              <p>Optional. Appears in the header of generated frames.</p>
              <div className="logo-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    setLogoAttached(true);
                    showToast("Logo captured from selected node", "success");
                  }}
                >
                  {logoAttached ? "Replace with selected node" : "Use selected node as logo"}
                </button>
                {logoAttached ? (
                  <button className="button button-quiet" type="button" onClick={() => setLogoAttached(false)}>Remove</button>
                ) : null}
                {logoAttached ? <span className="logo-status"><IconCheck size={13} />Logo added</span> : null}
              </div>
            </div>
        </div>
      </div>
    </section>
  );
}

function MessageView({ onBack }) {
  return (
    <section className="screen message-screen">
      <div className="message-card">
        <span className="message-icon"><IconHelpCircle size={24} /></span>
        <h1>Help & feedback</h1>
        <p>Find documentation, contact support, or see what’s planned.</p>
        <button className="button button-primary" onClick={onBack}>Back to Library</button>
      </div>
    </section>
  );
}

export function App() {
  const showQuotaStates = new URLSearchParams(window.location.search).get("showcase") === "quota-states";
  const [activeView, setActiveView] = useState(getInitialView);
  const [docs, setDocs] = useState(initialDocs);
  const [toast, setToast] = useState(null);
  const [isLight, setIsLight] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(getInitialAiEnabled);
  const [quotaRemaining, setQuotaRemaining] = useState(4);
  const [licenseState, setLicenseState] = useState(getInitialLicenseState);
  const [licenseKey, setLicenseKey] = useState(() => (
    storedLicenseStates.has(getInitialLicenseState()) ? "SPEC-PRO-DEMO-64PN" : ""
  ));
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTriggerRef = useRef(null);
  const quotaLimit = 5;

  const showToast = (message, tone = "default") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 2600);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    window.requestAnimationFrame(() => searchTriggerRef.current?.focus());
  };

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((current) => {
          if (current) window.requestAnimationFrame(() => searchTriggerRef.current?.focus());
          return !current;
        });
      }
      if (event.key === "Escape") {
        setSearchOpen((current) => {
          if (current) window.requestAnimationFrame(() => searchTriggerRef.current?.focus());
          return false;
        });
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  if (showQuotaStates) return <QuotaStatesShowcase />;

  const renderScreen = () => {
    switch (activeView) {
      case "component":
        return (
          <ComponentView
            showToast={showToast}
            aiEnabled={aiEnabled}
            setAiEnabled={setAiEnabled}
            quotaRemaining={quotaRemaining}
            onConsumeQuota={() => setQuotaRemaining((current) => Math.max(0, current - 1))}
          />
        );
      case "foundations":
        return (
          <FoundationsView
            showToast={showToast}
            quotaRemaining={quotaRemaining}
            onConsumeQuota={() => setQuotaRemaining((current) => Math.max(0, current - 1))}
          />
        );
      case "settings":
        return (
          <SettingsView
            showToast={showToast}
          />
        );
      case "subscription":
        return (
          <LicenseView
            licenseState={licenseState}
            setLicenseState={setLicenseState}
            licenseKey={licenseKey}
            setLicenseKey={setLicenseKey}
            quotaRemaining={quotaRemaining}
            quotaLimit={quotaLimit}
            showToast={showToast}
          />
        );
      case "design-system":
        return <DesignSystemView isLight={isLight} />;
      case "help":
        return <MessageView onBack={() => setActiveView("library")} />;
      case "library":
      default:
        return <LibraryView docs={docs} setDocs={setDocs} showToast={showToast} />;
    }
  };

  return (
    <main className={`app-stage ${isLight ? "light-theme" : ""}`}>
      <div className="plugin-shell" data-testid="plugin-shell">
        <header className="topbar">
          <HeaderSearch buttonRef={searchTriggerRef} onOpen={() => setSearchOpen(true)} />
          <HeaderQuota
            remaining={quotaRemaining}
            limit={quotaLimit}
            plan={licenseState === "pro" || licenseState === "removing" ? "pro" : licenseState === "unknown" ? "unknown" : "free"}
            onOpen={() => setActiveView("subscription")}
          />
          <div className="header-utilities" aria-label="Plugin utilities">
            <button
              className="header-theme-button"
              type="button"
              aria-label={`Switch to ${isLight ? "dark" : "light"} theme`}
              title={`Switch to ${isLight ? "dark" : "light"} theme`}
              onClick={() => setIsLight((value) => !value)}
            >
              {isLight ? <IconMoon size={16} /> : <IconSun size={16} />}
            </button>
          </div>
        </header>
        <Sidebar
          activeView={activeView}
          onNavigate={setActiveView}
          updateCount={docs.filter((doc) => doc.status === "update").length}
        />
        <div className="main-panel">
          <div className="screen-slot" key={activeView}>{renderScreen()}</div>
        </div>
        {toast ? (
          <div className={`toast ${toast.tone === "success" ? "success" : ""}`}>
            {toast.tone === "success" ? <IconCircleCheck size={16} /> : <IconInfoCircle size={16} />}
            {toast.message}
          </div>
        ) : null}
        {searchOpen ? (
          <GlobalSearch
            docs={docs}
            onClose={closeSearch}
            onNavigate={setActiveView}
            showToast={showToast}
          />
        ) : null}
      </div>
    </main>
  );
}
