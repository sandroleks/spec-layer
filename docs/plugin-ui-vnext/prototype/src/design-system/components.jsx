import { useEffect, useId, useRef } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconLoader2,
  IconMinus,
  IconSearch,
} from "@tabler/icons-react";

export function Button({
  children,
  tone = "primary",
  size = "medium",
  loading = false,
  icon: Icon,
  disabled = false,
  ...props
}) {
  return (
    <button
      className={`sl-button sl-button--${tone} sl-button--${size}`}
      type="button"
      disabled={loading || disabled}
      {...props}
    >
      {loading ? <IconLoader2 className="sl-spinner" size={15} aria-hidden="true" /> : Icon ? <Icon size={15} aria-hidden="true" /> : null}
      <span>{loading ? "Working…" : children}</span>
    </button>
  );
}

export function IconButton({ icon: Icon, label, selected = false, ...props }) {
  return (
    <button
      className={`sl-icon-button${selected ? " is-selected" : ""}`}
      type="button"
      aria-label={label}
      aria-pressed={selected || undefined}
      {...props}
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}

export function Checkbox({ label, description, checked, mixed = false, onChange, disabled = false }) {
  const id = useId();
  const inputRef = useRef(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <label className={`sl-choice${disabled ? " is-disabled" : ""}`} htmlFor={id}>
      <input
        id={id}
        ref={inputRef}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-checked={mixed ? "mixed" : checked}
      />
      <span className={`sl-checkbox${mixed ? " is-mixed" : ""}`} aria-hidden="true">
        {mixed ? <IconMinus size={13} /> : checked ? <IconCheck size={13} /> : null}
      </span>
      <span className="sl-choice-copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}

export function Radio({ name, label, description, checked, onChange, disabled = false }) {
  const id = useId();
  return (
    <label className={`sl-choice${disabled ? " is-disabled" : ""}`} htmlFor={id}>
      <input id={id} type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} />
      <span className="sl-radio" aria-hidden="true"><i /></span>
      <span className="sl-choice-copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}

export function Switch({ label, description, checked, onChange, disabled = false }) {
  const id = useId();
  return (
    <label className={`sl-switch-row${disabled ? " is-disabled" : ""}`} htmlFor={id}>
      <span className="sl-choice-copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="sl-switch" aria-hidden="true"><i /></span>
    </label>
  );
}

export function Chip({ children, selected = false, disabled = false, onClick }) {
  return (
    <button
      className={`sl-chip${selected ? " is-selected" : ""}`}
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      {selected ? <IconCheck size={12} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function TextField({
  label,
  hint,
  error,
  prefix,
  type = "text",
  ...props
}) {
  const id = useId();
  const supportingId = `${id}-supporting`;
  return (
    <label className={`sl-field${error ? " has-error" : ""}`} htmlFor={id}>
      {label ? <span className="sl-field-label">{label}</span> : null}
      <span className="sl-input-wrap">
        {prefix ? <span className="sl-input-prefix" aria-hidden="true">{prefix}</span> : null}
        <input
          id={id}
          type={type}
          aria-invalid={Boolean(error)}
          aria-describedby={hint || error ? supportingId : undefined}
          {...props}
        />
      </span>
      {hint || error ? <small id={supportingId} className="sl-field-help">{error || hint}</small> : null}
    </label>
  );
}

export function SearchField(props) {
  return <TextField prefix={<IconSearch size={14} />} aria-label="Search" {...props} />;
}

export function Select({ label, children, ...props }) {
  const id = useId();
  return (
    <label className="sl-field" htmlFor={id}>
      {label ? <span className="sl-field-label">{label}</span> : null}
      <span className="sl-select-wrap">
        <select id={id} {...props}>{children}</select>
        <IconChevronDown size={14} aria-hidden="true" />
      </span>
    </label>
  );
}

export function Segmented({ label, items, value, onChange }) {
  return (
    <div className="sl-segmented-field">
      {label ? <span className="sl-field-label">{label}</span> : null}
      <div className="sl-segmented" role="radiogroup" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={value === item.value}
            className={value === item.value ? "is-selected" : ""}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }) {
  return <span className={`sl-badge sl-badge--${tone}`}>{children}</span>;
}

export function Status({ children, tone = "neutral" }) {
  return (
    <span className={`sl-status sl-status--${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

export function Skeleton({ width = "100%" }) {
  return <span className="sl-skeleton" style={{ width }} aria-hidden="true" />;
}
