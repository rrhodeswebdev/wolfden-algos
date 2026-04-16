import { Component, ErrorInfo, ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("React error boundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: '#ff4444', background: '#1a1a1a', height: '100vh', fontFamily: 'monospace' }}>
          <h1>Something went wrong</h1>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#ccc' }}>{this.state.error?.message}</pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, padding: '10px 20px', background: '#333', color: '#fff', border: '1px solid #555', cursor: 'pointer' }}
          >
            Reload Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
