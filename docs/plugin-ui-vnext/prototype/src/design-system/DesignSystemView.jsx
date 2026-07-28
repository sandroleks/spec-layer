import { useEffect, useRef, useState } from "react";
import {
  IconAccessible,
  IconAlertTriangle,
  IconArrowRight,
  IconBell,
  IconBook2,
  IconCheck,
  IconCircleCheck,
  IconDots,
  IconExternalLink,
  IconFileDescription,
  IconFolder,
  IconHelp,
  IconInfoCircle,
  IconLayoutGrid,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  IconButton,
  Radio,
  SearchField,
  Segmented,
  Select,
  Skeleton,
  Status,
  Switch,
  TextField,
} from "./components";
import "./tokens.css";
import "./design-system.css";

const catalogTabs = [
  ["foundations", "Foundations"],
  ["actions", "Actions"],
  ["inputs", "Inputs"],
  ["navigation", "Navigation"],
  ["feedback", "Feedback"],
  ["patterns", "Patterns"],
];

const swatches = [
  ["Canvas", "var(--sl-color-canvas)", "#1F1F1F", "#F7F7F8"],
  ["Surface", "var(--sl-color-surface)", "#292929", "#F0F1F2"],
  ["Raised", "var(--sl-color-surface-raised)", "#303030", "#FFFFFF"],
  ["Text", "var(--sl-color-text)", "#F3F3F3", "#1D1F22"],
  ["Muted", "var(--sl-color-text-muted)", "#ADADAD", "#5D6268"],
  ["Accent", "var(--sl-color-accent)", "#0B99FF", "#0875C1"],
  ["Success", "var(--sl-color-success)", "#73D66D", "#338A39"],
  ["Warning", "var(--sl-color-warning)", "#E2A64F", "#94600D"],
  ["Danger", "var(--sl-color-danger)", "#FF716C", "#C33F3A"],
];

function getInitialCatalogTab() {
  const requested = new URLSearchParams(window.location.search).get("catalog");
  return catalogTabs.some(([id]) => id === requested) ? requested : "foundations";
}

function Sample({ title, note, children, className = "" }) {
  return (
    <section className={`ds-sample ${className}`}>
      <div className="ds-sample-heading">
        <h2>{title}</h2>
        {note ? <p>{note}</p> : null}
      </div>
      <div className="ds-sample-body">{children}</div>
    </section>
  );
}

function FoundationsCatalog({ isLight }) {
  return (
    <>
      <Sample title="Semantic color" note="Roles adapt with the plugin theme.">
        <div className="ds-swatch-grid">
          {swatches.map(([name, color, darkHex, lightHex]) => (
            <div className="ds-swatch" key={name}>
              <i style={{ background: color }} />
              <span><strong>{name}</strong><small>{isLight ? lightHex : darkHex}</small></span>
            </div>
          ))}
        </div>
      </Sample>
      <Sample title="Typography" note="A compact scale for dense plugin workflows.">
        <div className="ds-type-list">
          {[
            ["Page title", "16 / 1.15", "sl-type-title"],
            ["Section title", "14 / 1.15", "sl-type-section"],
            ["Body", "12 / 1.4", "sl-type-body"],
            ["Control", "11 / 1.15", "sl-type-control"],
            ["Supporting", "10 / 1.4", "sl-type-support"],
            ["Micro", "9 / 1.15", "sl-type-micro"],
          ].map(([name, value, className]) => (
            <div className="ds-type-row" key={name}>
              <span className={className}>{name}</span>
              <code>{value}</code>
            </div>
          ))}
        </div>
      </Sample>
      <Sample title="Spacing & shape">
        <div className="ds-token-columns">
          <div>
            <h3>Spacing</h3>
            {[4, 8, 12, 16, 24, 32].map((value) => (
              <div className="ds-space-row" key={value}><i style={{ width: value }} /><span>{value}</span></div>
            ))}
          </div>
          <div>
            <h3>Radius</h3>
            <div className="ds-radius-list">
              {[[4, "Small"], [7, "Medium"], [10, "Large"], [999, "Pill"]].map(([value, name]) => (
                <span key={name} style={{ borderRadius: value }}>{name}<small>{value === 999 ? "Full" : value}</small></span>
              ))}
            </div>
          </div>
        </div>
      </Sample>
      <Sample title="Motion" note="Fast feedback, quiet transitions, no layout jumps.">
        <div className="ds-motion-list">
          <span><i className="is-fast" />Fast <small>120ms</small></span>
          <span><i className="is-standard" />Standard <small>180ms</small></span>
          <span><i className="is-slow" />Slow <small>260ms</small></span>
        </div>
      </Sample>
    </>
  );
}

function ActionsCatalog() {
  const [loading, setLoading] = useState(false);
  const triggerLoading = () => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1200);
  };
  return (
    <>
      <Sample title="Buttons" note="Use one primary action per surface.">
        <div className="ds-action-grid">
          <Button onClick={triggerLoading} loading={loading}>Create docs</Button>
          <Button tone="secondary" icon={IconRefresh}>Refresh</Button>
          <Button tone="quiet">Cancel</Button>
          <Button tone="danger" icon={IconTrash}>Remove</Button>
          <Button disabled>Disabled</Button>
          <Button tone="secondary" size="small">Small action</Button>
        </div>
      </Sample>
      <Sample title="Icon actions" note="Always pair with an accessible label or tooltip.">
        <div className="ds-inline">
          <IconButton icon={IconSearch} label="Search" />
          <IconButton icon={IconSettings} label="Settings" />
          <IconButton icon={IconBell} label="Notifications" selected />
          <IconButton icon={IconDots} label="More actions" />
          <IconButton icon={IconHelp} label="Help" disabled />
        </div>
      </Sample>
      <Sample title="Action hierarchy">
        <div className="ds-footer-demo">
          <Button tone="secondary">Back</Button>
          <Button icon={IconArrowRight}>Continue</Button>
        </div>
      </Sample>
    </>
  );
}

function InputsCatalog() {
  const [query, setQuery] = useState("");
  const [license, setLicense] = useState("");
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState("diagram");
  const [ai, setAi] = useState(true);
  const [segments, setSegments] = useState("diagram");
  const [chips, setChips] = useState(["size", "spacing"]);
  const toggleChip = (id) => setChips((current) => (
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
  ));
  return (
    <>
      <Sample title="Text fields">
        <div className="ds-stack">
          <SearchField placeholder="Search library…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <TextField label="License key" placeholder="SPEC-PRO-…" value={license} onChange={(event) => setLicense(event.target.value)} hint="Paste the key from your purchase email." />
          <TextField label="Frame name" value="Untitled" error="This name is already in use." readOnly />
        </div>
      </Sample>
      <Sample title="Selection">
        <div className="ds-stack">
          <Checkbox label="Overview" checked={checked} onChange={() => setChecked((value) => !value)} />
          <Checkbox label="Mixed group" checked={false} mixed onChange={() => {}} />
          <Checkbox label="Unavailable" description="Requires a component set." disabled checked={false} onChange={() => {}} />
          <Radio name="anatomy" label="Diagram" checked={radio === "diagram"} onChange={() => setRadio("diagram")} />
          <Radio name="anatomy" label="Table" checked={radio === "table"} onChange={() => setRadio("table")} />
          <Switch label="AI writing" checked={ai} onChange={() => setAi((value) => !value)} />
        </div>
      </Sample>
      <Sample title="Segmented control & select">
        <div className="ds-stack">
          <Segmented
            label="Show anatomy as"
            items={[
              { label: "Diagram", value: "diagram" },
              { label: "Table", value: "table" },
              { label: "Both", value: "both" },
            ]}
            value={segments}
            onChange={setSegments}
          />
          <Select label="Frame theme" defaultValue="tech">
            <option value="default">Default</option>
            <option value="editorial">Editorial</option>
            <option value="tech">Tech</option>
            <option value="warm">Warm</option>
            <option value="custom">Custom</option>
          </Select>
        </div>
      </Sample>
      <Sample title="Selectable chips" note="Use for independent, optional subchoices.">
        <div className="ds-inline ds-inline--wrap">
          <Chip selected={chips.includes("size")} onClick={() => toggleChip("size")}>Height & width</Chip>
          <Chip selected={chips.includes("padding")} onClick={() => toggleChip("padding")}>Inner padding</Chip>
          <Chip selected={chips.includes("spacing")} onClick={() => toggleChip("spacing")}>Children & spacing</Chip>
          <Chip disabled>Unavailable</Chip>
        </div>
      </Sample>
    </>
  );
}

function NavigationCatalog() {
  const [tab, setTab] = useState("updates");
  const [activeNav, setActiveNav] = useState("library");
  return (
    <>
      <Sample title="Sidebar navigation" note="Selected state uses fill plus icon color—never color alone.">
        <div className="ds-nav-demo">
          {[
            [IconFileDescription, "component", "Component docs"],
            [IconLayoutGrid, "foundation", "Foundation docs"],
            [IconFolder, "library", "Library"],
            [IconSettings, "settings", "Settings"],
          ].map(([Icon, id, label]) => (
            <button
              key={id}
              className={activeNav === id ? "is-selected" : ""}
              type="button"
              onClick={() => setActiveNav(id)}
              aria-label={label}
              aria-pressed={activeNav === id}
            >
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
        </div>
      </Sample>
      <Sample title="Tabs">
        <div className="sl-tabs" role="tablist" aria-label="Library status">
          {[
            ["all", "All", 16],
            ["updates", "Updates", 3],
            ["sync", "In sync", 13],
          ].map(([id, label, count]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-selected" : ""} onClick={() => setTab(id)}>
              {label}<span>{count}</span>
            </button>
          ))}
        </div>
      </Sample>
      <Sample title="Section anatomy">
        <div className="ds-section-demo">
          <div><Checkbox label="Specifications" checked onChange={() => {}} /><Badge>5/5</Badge></div>
          <p>Short dividers organize related choices without turning every group into a card.</p>
        </div>
      </Sample>
      <Sample title="Tooltip">
        <div className="ds-tooltip-demo">
          <IconButton icon={IconHelp} label="Help" />
          <span role="tooltip">Help & feedback</span>
        </div>
      </Sample>
    </>
  );
}

function FeedbackCatalog() {
  const [toast, setToast] = useState(false);
  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  return (
    <>
      <Sample title="Badges & status">
        <div className="ds-inline ds-inline--wrap">
          <Badge>AI</Badge>
          <Badge tone="accent">Pro</Badge>
          <Badge tone="success">Current</Badge>
          <Badge tone="warning">Low usage</Badge>
          <Badge tone="danger">Expired</Badge>
        </div>
        <div className="ds-inline ds-inline--wrap ds-status-row">
          <Status tone="accent">Update available</Status>
          <Status tone="success">In sync</Status>
          <Status tone="warning">Check needed</Status>
        </div>
      </Sample>
      <Sample title="Inline messages">
        <div className="ds-stack">
          <div className="sl-alert sl-alert--info"><IconInfoCircle size={16} /><span><strong>Heads up</strong><small>AI writing uses one free use when docs are created.</small></span></div>
          <div className="sl-alert sl-alert--success"><IconCircleCheck size={16} /><span><strong>Library refreshed</strong><small>All connected frames were checked.</small></span></div>
          <div className="sl-alert sl-alert--warning"><IconAlertTriangle size={16} /><span><strong>Check source</strong><small>Some Figma changes may need manual review.</small></span></div>
        </div>
      </Sample>
      <Sample title="Loading & empty states">
        <div className="ds-skeleton-card">
          <Skeleton width="42%" /><Skeleton width="76%" /><Skeleton width="60%" />
        </div>
        <div className="ds-empty">
          <IconFolder size={20} />
          <strong>No connected docs</strong>
          <small>Create component docs to start your library.</small>
        </div>
      </Sample>
      <Sample title="Toast">
        <Button tone="secondary" onClick={() => setToast(true)}>Show confirmation</Button>
        {toast ? <div className="sl-toast"><IconCircleCheck size={15} />Settings saved</div> : null}
      </Sample>
    </>
  );
}

function QuotaPattern() {
  return (
    <div className="ds-quota-pattern">
      <span className="ds-quota-ring" aria-hidden="true" />
      <span><strong>AI writing</strong><small>4 of 5 free uses left</small></span>
      <button type="button">Upgrade</button>
    </div>
  );
}

function LibraryPattern() {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className={`ds-library-pattern${expanded ? " is-expanded" : ""}`}>
      <button className="ds-library-main" type="button">
        <IconFolder size={18} />
        <span><strong>buttonText</strong><small>Components · Button / Text</small></span>
      </button>
      <Status tone="accent">Update</Status>
      <button className="ds-disclosure" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span>{expanded ? "Hide changes" : "Show changes"}</span>
      </button>
      <IconButton icon={IconDots} label="More actions" />
      {expanded ? (
        <div className="ds-library-changes">
          <strong>Changes</strong>
          <span>Variants</span>
          <ul><li>Added: icon-left</li><li>Removed: icon-only</li></ul>
          <a href="#source">Review source <IconExternalLink size={12} /></a>
        </div>
      ) : null}
    </div>
  );
}

function PatternsCatalog() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [foundation, setFoundation] = useState(true);
  const menuRef = useRef(null);
  useEffect(() => {
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    if (!dialogOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setDialogOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dialogOpen]);
  return (
    <>
      <Sample title="AI allowance">
        <QuotaPattern />
      </Sample>
      <Sample title="Library item" note="Row navigation, change disclosure, and maintenance actions remain separate.">
        <LibraryPattern />
      </Sample>
      <Sample title="Foundation selection">
        <div className="ds-foundation-pattern">
          <Checkbox label="Mapped Colors" description="138 variables · 3 modes" checked={foundation} onChange={() => setFoundation((value) => !value)} />
        </div>
      </Sample>
      <Sample title="Overflow menu">
        <div className="ds-menu-stage" ref={menuRef}>
          <IconButton icon={IconDots} label="Open document actions" onClick={() => setMenuOpen((value) => !value)} selected={menuOpen} />
          {menuOpen ? (
            <div className="sl-menu" role="menu">
              <button type="button" role="menuitem"><IconRefresh size={14} />Update doc</button>
              <button type="button" role="menuitem"><IconExternalLink size={14} />Open in Figma</button>
              <i />
              <button type="button" role="menuitem" className="is-danger"><IconTrash size={14} />Disconnect</button>
            </div>
          ) : null}
        </div>
      </Sample>
      <Sample title="Dialog">
        <Button tone="secondary" onClick={() => setDialogOpen(true)}>Open dialog</Button>
        {dialogOpen ? (
          <div className="sl-dialog-backdrop" role="presentation">
            <div className="sl-dialog" role="dialog" aria-modal="true" aria-labelledby="ds-dialog-title" aria-describedby="ds-dialog-description">
              <div className="sl-dialog-heading">
                <span><strong id="ds-dialog-title">Disconnect documentation?</strong><small id="ds-dialog-description">The generated frame will stay in Figma.</small></span>
                <IconButton icon={IconX} label="Close dialog" autoFocus onClick={() => setDialogOpen(false)} />
              </div>
              <div className="sl-dialog-actions">
                <Button tone="secondary" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button tone="danger" onClick={() => setDialogOpen(false)}>Disconnect</Button>
              </div>
            </div>
          </div>
        ) : null}
      </Sample>
      <Sample title="Sticky action footer">
        <div className="ds-footer-demo">
          <Button tone="secondary" icon={IconRefresh}>Refresh library</Button>
          <Button>Update all 3</Button>
        </div>
      </Sample>
    </>
  );
}

const catalogs = {
  foundations: FoundationsCatalog,
  actions: ActionsCatalog,
  inputs: InputsCatalog,
  navigation: NavigationCatalog,
  feedback: FeedbackCatalog,
  patterns: PatternsCatalog,
};

export default function DesignSystemView({ isLight = false }) {
  const [activeTab, setActiveTab] = useState(getInitialCatalogTab);
  const ActiveCatalog = catalogs[activeTab];
  return (
    <section className="screen design-system-screen" aria-labelledby="design-system-title">
      <header className="ds-catalog-header">
        <div>
          <span>Spec Layer UI</span>
          <h1 id="design-system-title">Plugin system</h1>
        </div>
        <Badge tone="accent">v0.1</Badge>
      </header>
      <div className="ds-catalog-tabs" role="tablist" aria-label="Design system categories">
        {catalogTabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={activeTab === id ? "is-selected" : ""}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ds-catalog-scroll" role="tabpanel" tabIndex={0}>
        <ActiveCatalog isLight={isLight} />
        <div className="ds-catalog-end">
          <IconAccessible size={16} />
          <span><strong>Accessible by default</strong><small>Every control keeps a name, keyboard path, visible focus, and non-color state cue.</small></span>
        </div>
      </div>
    </section>
  );
}
