import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

// The app had zero error boundaries anywhere — any uncaught render error
// unmounts the whole React tree, which shows as the app "going blank" with
// no clue why. This wraps the whole app (see main.tsx) so a crash shows the
// actual error instead, and logs it to the console for real debugging.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex items-center justify-center h-screen bg-bg-primary p-8">
        <div className="flex flex-col gap-3 max-w-[560px]">
          <h1 className="text-text-primary">Something went wrong</h1>
          <pre className="text-danger text-[0.85em] whitespace-pre-wrap break-words bg-bg-secondary border border-border rounded-md p-3">
            {this.state.error.message}
          </pre>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
