import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

class AppErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("TrunkScope UI error", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="login-shell"><section className="page-card error-card"><p className="eyebrow">TRUNKSCOPE UI</p><h1>Console recovery</h1><p>The console hit a rendering error. Your receiver and recordings are unaffected.</p><pre>{this.state.error.message}</pre><button className="primary" onClick={() => window.location.reload()}>RELOAD CONSOLE</button></section></main>;
  }
}

createRoot(document.getElementById("root")!).render(<StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>);

if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js");
