import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// Monaco creates Web Workers for syntax highlighting and language services.
// With Vite's ?worker import, the worker is emitted as a same-origin bundle,
// so the installed app's CSP never needs to reach cdn.jsdelivr.net.
self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

// Hand the already-imported monaco namespace to @monaco-editor/react so it
// skips its default AMD loader (which would otherwise fetch monaco from
// cdn.jsdelivr.net and get blocked by the Tauri production CSP).
loader.config({ monaco });
