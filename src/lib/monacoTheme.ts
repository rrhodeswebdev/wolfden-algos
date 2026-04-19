import type { Monaco } from "@monaco-editor/react";

export const WOLF_DEN_THEME = "wolf-den-dark";

export const defineWolfDenTheme = (monaco: Monaco): void => {
  monaco.editor.defineTheme(WOLF_DEN_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "c792ea" },
      { token: "keyword.flow", foreground: "c792ea" },
      { token: "operator", foreground: "89ddff" },
      { token: "delimiter", foreground: "89ddff" },
      { token: "string", foreground: "c3e88d" },
      { token: "string.escape", foreground: "c3e88d" },
      { token: "number", foreground: "f78c6c" },
      { token: "comment", foreground: "546e7a", fontStyle: "italic" },
      { token: "type", foreground: "ffcb6b" },
      { token: "type.identifier", foreground: "ffcb6b" },
      { token: "identifier", foreground: "e0e0e8" },
      { token: "keyword.python", foreground: "c792ea" },
      { token: "function", foreground: "82aaff" },
      { token: "function.call", foreground: "82aaff" },
      { token: "identifier.function", foreground: "82aaff" },
    ],
    colors: {
      "editor.background": "#1a1a28",
      "editor.foreground": "#e0e0e8",
      "editorLineNumber.foreground": "#55556a",
      "editorLineNumber.activeForeground": "#e0e0e8",
      "editor.selectionBackground": "#4d9fff33",
      "editor.lineHighlightBackground": "#4d9fff0d",
      "editor.lineHighlightBorder": "#00000000",
      "editorCursor.foreground": "#4d9fff",
      "editorWidget.background": "#20202e",
      "editorWidget.border": "#2a2a3a",
      "editorIndentGuide.background": "#2a2a3a",
      "editorIndentGuide.activeBackground": "#3a3a4e",
      "editorBracketMatch.background": "#4d9fff26",
      "editorBracketMatch.border": "#4d9fff",
    },
  });
};
