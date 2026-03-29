import React from "react";
import ReactDOM from "react-dom/client";
import { GuideView } from "./views/GuideView";
import { TitleBar } from "./components/TitleBar";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <TitleBar title="Guide" />
      <div className="flex flex-1 min-h-0">
        <GuideView />
      </div>
    </div>
  </React.StrictMode>,
);
