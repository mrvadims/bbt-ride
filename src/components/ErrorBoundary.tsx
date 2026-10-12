// Last-resort screen for a render error (e.g. an app opened before a deploy meeting a newer API): offer a reload
// instead of a blank page.
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main>
        <section className="panel empty">
          <p>
            <b>Something went wrong.</b> The app may have just been updated.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </section>
      </main>
    );
  }
}
