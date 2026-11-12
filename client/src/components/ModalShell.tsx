import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { backdropDismiss, closeButton } from '@/lib/backdrop';

/** Nested-modal-safe body scroll lock. Always released on unmount or when `active` becomes false. */
let scrollLocks = 0;
let prevOverflow = '';
function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    if (scrollLocks === 0) prevOverflow = document.body.style.overflow;
    scrollLocks += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      scrollLocks = Math.max(0, scrollLocks - 1);
      if (scrollLocks === 0) document.body.style.overflow = prevOverflow;
    };
  }, [active]);
}

export const PANEL_LOAD_MS = 12_000;

/** Shared overlay shell: sticky header with ✕, scrolling body, Escape and backdrop close, optional load/error. */
export function ModalShell({
  open = true,
  title,
  labelledBy,
  onClose,
  children,
  testId,
  role = 'dialog',
  closeLabel = 'Close',
  closeTestId,
  className,
  backdropClassName,
  bodyClassName,
  headerExtra,
  footer,
  loading,
  error,
  onRetry,
  portal = true,
  escape = true,
  backdrop = true,
  closeDisabled = false,
  lockScroll = true,
}: {
  open?: boolean;
  title?: ReactNode;
  labelledBy?: string;
  onClose: () => void;
  children?: ReactNode;
  testId?: string;
  role?: 'dialog' | 'alertdialog';
  closeLabel?: string;
  closeTestId?: string;
  className?: string;
  backdropClassName?: string;
  bodyClassName?: string;
  headerExtra?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  portal?: boolean;
  escape?: boolean;
  backdrop?: boolean;
  closeDisabled?: boolean;
  lockScroll?: boolean;
}) {
  useBodyScrollLock(!!open && lockScroll);
  useEffect(() => {
    if (!open || !escape || closeDisabled) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, escape, closeDisabled, onClose]);
  if (!open) return null;
  const titleId = labelledBy ?? (title != null ? 'modal-shell-title' : undefined);
  const node = (
    <div
      className={`modal-backdrop${backdropClassName ? ` ${backdropClassName}` : ''}`}
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={testId}
      {...(backdrop && !closeDisabled ? backdropDismiss(onClose) : {})}
    >
      <div className={`modal-shell${className ? ` ${className}` : ''}`}>
        <div className="modal-shell-head">
          {title != null && (labelledBy ? title : <h2 id={titleId} className="modal-shell-title">{title}</h2>)}
          {headerExtra}
          <button
            type="button"
            className="modal-shell-x"
            aria-label={closeLabel}
            data-testid={closeTestId ?? (testId ? `${testId}-close` : 'modal-close')}
            disabled={closeDisabled}
            {...(closeDisabled ? {} : closeButton(onClose))}
          >✕</button>
        </div>
        <div className={`modal-shell-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>
          {loading && !error && <p className="modal-shell-status" data-testid="modal-loading">Loading…</p>}
          {error && (
            <div className="modal-shell-status" data-testid="modal-error" role="alert">
              <p>{error}</p>
              {onRetry && <button type="button" className="modal-shell-retry" onClick={onRetry} data-testid="modal-retry">Retry</button>}
            </div>
          )}
          {!loading && !error && children}
        </div>
        {footer && <div className="modal-shell-foot">{footer}</div>}
      </div>
    </div>
  );
  return portal ? createPortal(node, document.body) : node;
}

/** Closeable loading/error card used as a Suspense fallback and hang timeout. */
export function PanelLoading({
  label, onClose, onRetry, error, testId = 'panel-loading',
}: {
  label: string;
  onClose?: () => void;
  onRetry?: () => void;
  error?: string | null;
  testId?: string;
}) {
  return (
    <div className="world-deed map-sheet panel-loading" role="dialog" aria-modal="true" aria-label={label} data-testid={testId}>
      <header className="map-sheet-header">
        <h3>{label}</h3>
        {onClose && (
          <button type="button" className="world-deed-x" aria-label="Close" data-testid={`${testId}-close`} {...closeButton(onClose)}>✕</button>
        )}
      </header>
      <div className="map-sheet-body">
        {error ? (
          <div role="alert" data-testid={`${testId}-error`}>
            <p>{error}</p>
            {onRetry && <button type="button" className="modal-shell-retry" onClick={onRetry} data-testid={`${testId}-retry`}>Retry</button>}
          </div>
        ) : (
          <p className="modal-shell-status">{label}</p>
        )}
      </div>
    </div>
  );
}

/** Suspense with a closeable fallback and a timeout that surfaces Retry instead of spinning forever. */
export function TimedSuspense({
  label, onClose, children, timeout = PANEL_LOAD_MS, testId,
}: {
  label: string;
  onClose?: () => void;
  children: ReactNode;
  timeout?: number;
  testId?: string;
}) {
  const [gen, setGen] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setErr(null);
    const t = window.setTimeout(() => setErr('This menu is taking too long to open.'), timeout);
    return () => window.clearTimeout(t);
  }, [gen, timeout]);
  if (err) {
    return (
      <PanelLoading
        label={label}
        error={err}
        onClose={onClose}
        onRetry={() => { setErr(null); setGen((n) => n + 1); }}
        testId={testId}
      />
    );
  }
  return (
    <Suspense fallback={<PanelLoading label={label} onClose={onClose} testId={testId} />} key={gen}>
      {children}
    </Suspense>
  );
}
