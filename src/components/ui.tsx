import { useEffect } from "react";
import type { ReactNode } from "react";
import { STAGES } from "../domain";
import type { Stage } from "../domain";

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal${wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function ErrorBox({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <div className="error-box" role="alert">
      <strong>无法提交：</strong>
      <ul>
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

export function Stepper({ stage }: { stage: Stage }) {
  const cur = STAGES.findIndex((s) => s.id === stage);
  return (
    <ol className="stepper">
      {STAGES.map((s, i) => (
        <li key={s.id} className={`${i < cur ? "done" : ""} ${i === cur ? "current" : ""}`}>
          <span className="dot">{i < cur ? "✓" : i + 1}</span>
          <span className="lbl">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`stage-badge stage-${stage}`}>{STAGES.find((s) => s.id === stage)?.label}</span>;
}

export function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required ? <em>*</em> : null}
        {hint ? <small>{hint}</small> : null}
      </span>
      {children}
    </label>
  );
}

export const inputCls = "ctrl";
