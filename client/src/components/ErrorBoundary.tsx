import { Component, type ReactNode } from 'react';
import { browserOf, errorFrame, errorKind, type ClientErrorReport, type ClientErrorWhere } from '../../../shared/clientError';

const sent = new Set<string>(); let count = 0;
/** Classified crash report (no message/stack text/URL/names; see shared/clientError.ts). Once per signature, max 3 per page. */
export function reportClientError(where: ClientErrorWhere, e: unknown): void {
  try {
    const r: ClientErrorReport = { where, kind: errorKind(e), frame: errorFrame(e instanceof Error ? e.stack : ''), browser: browserOf(navigator.userAgent) };
    const sig = `${r.where}|${r.kind}|${r.frame}`; if (sent.has(sig) || count >= 3) return; sent.add(sig); count++;
    const body = JSON.stringify(r);
    if (navigator.sendBeacon?.('/api/client-error', new Blob([body], { type: 'application/json' }))) return;
    void fetch('/api/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* never throw from the reporter */ }
}
export const resetClientErrorReportsForTest = () => { sent.clear(); count = 0; };

/**
 * Contains a render crash. 'app': the whole tree failed -> a readable screen with Reload (instead of React unmounting
 * everything to the bare page background, the "green screen"). 'panel': only that overlay is replaced by a small card
 * whose Close remounts it fresh, so the rest of the page stays usable. This boundary never touches storage or the session.
 */
export class ErrorBoundary extends Component<{ where: ClientErrorWhere; kind: 'app' | 'panel'; children?: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error(`[${this.props.where}]`, err); reportClientError(this.props.where, err); }
  render() {
    if (!this.state.err) return this.props.children;
    if (this.props.kind === 'panel') {
      return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" data-testid={`crash-${this.props.where}`}>
        <div role="alertdialog" aria-label="Something went wrong" className="modal-shell w-full max-w-sm">
          <div className="modal-shell-head">
            <h2 className="modal-shell-title">Something went wrong</h2>
            <button type="button" className="modal-shell-x" aria-label="Close" onClick={() => this.setState({ err: null })} data-testid="crash-close">✕</button>
          </div>
          <div className="modal-shell-body">
            <p className="text-sm">This window hit an error and was closed. Close this message and open it again to retry.</p>
            <button type="button" className="mt-3 min-h-[44px] rounded-lg bg-white/10 px-4" onClick={() => this.setState({ err: null })}>Close</button>
          </div>
        </div>
      </div>;
    }
    return <div role="alertdialog" aria-label="Something went wrong" className="fixed inset-0 z-[90] flex items-center justify-center p-6 text-center text-cream" data-testid="crash-app">
      <div><p className="text-lg font-bold">Something went wrong.</p><p className="mt-1 text-sm opacity-80">Reload to try again. Your saved sign-in details have not been cleared.</p>
        <button type="button" className="mt-4 min-h-[44px] rounded-lg bg-white/10 px-5" onClick={() => location.reload()} data-testid="crash-reload">Reload</button></div>
    </div>;
  }
}
