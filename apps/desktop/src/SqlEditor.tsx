import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import "monaco-editor/esm/vs/editor/browser/coreCommands";
import "monaco-editor/esm/vs/editor/browser/widget/codeEditor/codeEditorWidget";
import "monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching";
import "monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard";
import "monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu";
import "monaco-editor/esm/vs/editor/contrib/cursorUndo/browser/cursorUndo";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding";
import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution";
import "monaco-editor/esm/vs/editor/contrib/indentation/browser/indentation";
import "monaco-editor/esm/vs/editor/contrib/lineSelection/browser/lineSelection";
import "monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations";
import "monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor";
import "monaco-editor/esm/vs/editor/contrib/snippet/browser/snippetController2";
import "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController";
import "monaco-editor/esm/vs/editor/contrib/tokenization/browser/tokenization";
import "monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter";
import "monaco-editor/esm/vs/editor/contrib/wordOperations/browser/wordOperations";
import "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import type { QueryTab } from "./store";

(
  self as typeof self & { MonacoEnvironment: { getWorker: () => Worker } }
).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export interface SqlCompletion {
  label: string;
  detail: string;
  kind: "schema" | "table" | "column";
}

export interface SqlEditorHandle {
  focus: () => void;
  runSelectionOrDocument: () => void;
}

interface SqlEditorProps {
  tabs: QueryTab[];
  activeTabId: string;
  completions: SqlCompletion[];
  onChange: (sql: string) => void;
  onRun: (sql: string) => void;
  onCursorChange: (
    line: number,
    column: number,
    selectedCharacters: number,
  ) => void;
}

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(
  function SqlEditor(
    { tabs, activeTabId, completions, onChange, onRun, onCursorChange },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>());
    const activeTabIdRef = useRef(activeTabId);
    const syncingRef = useRef(false);
    const callbacksRef = useRef({ onChange, onRun, onCursorChange });
    const completionsRef = useRef(completions);
    activeTabIdRef.current = activeTabId;
    callbacksRef.current = { onChange, onRun, onCursorChange };
    completionsRef.current = completions;

    const runSelectionOrDocument = () => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model) return;
      const selection = editor.getSelection();
      const selectedSql = selection
        ? model.getValueInRange(selection).trim()
        : "";
      callbacksRef.current.onRun(selectedSql || model.getValue());
    };

    useImperativeHandle(ref, () => ({
      focus: () => editorRef.current?.focus(),
      runSelectionOrDocument,
    }));

    useEffect(() => {
      let disposeEditor: (() => void) | undefined;
      const initialization = window.setTimeout(() => {
        const container = containerRef.current;
        if (!container) return;
        monaco.editor.defineTheme("queryx-dark", {
          base: "vs-dark",
          inherit: true,
          rules: [
            { token: "keyword.sql", foreground: "B899FF", fontStyle: "bold" },
            { token: "string.sql", foreground: "A9C98E" },
            { token: "number.sql", foreground: "FFB86B" },
            { token: "comment.sql", foreground: "566270", fontStyle: "italic" },
          ],
          colors: {
            "editor.background": "#0D1014",
            "editor.foreground": "#C9D0D9",
            "editorLineNumber.foreground": "#47515D",
            "editorLineNumber.activeForeground": "#8A96A3",
            "editorCursor.foreground": "#E2FF67",
            "editor.selectionBackground": "#344123",
            "editor.inactiveSelectionBackground": "#252E20",
            "editorSuggestWidget.background": "#171C22",
            "editorSuggestWidget.border": "#303944",
            "editorSuggestWidget.selectedBackground": "#29362A",
          },
        });
        const initialTab =
          tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
        const initialModel = createModel(initialTab);
        modelsRef.current.set(initialTab.id, initialModel);
        const editor = monaco.editor.create(container, {
          model: initialModel,
          theme: "queryx-dark",
          automaticLayout: true,
          fontFamily: '"SFMono-Regular", "Cascadia Code", Consolas, monospace',
          fontSize: 12,
          lineHeight: 21,
          minimap: { enabled: true, maxColumn: 90, renderCharacters: false },
          padding: { top: 14, bottom: 14 },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorSmoothCaretAnimation: "on",
          roundedSelection: false,
          renderLineHighlight: "line",
          suggest: { showKeywords: true, showFields: true, showClasses: true },
          quickSuggestions: { other: true, comments: false, strings: false },
          tabSize: 2,
          wordWrap: "off",
        });
        editorRef.current = editor;
        const contentSubscription = editor.onDidChangeModelContent(() => {
          if (syncingRef.current) return;
          callbacksRef.current.onChange(editor.getValue());
        });
        const cursorSubscription = editor.onDidChangeCursorSelection(
          (event) => {
            callbacksRef.current.onCursorChange(
              event.selection.positionLineNumber,
              event.selection.positionColumn,
              editor.getModel()?.getValueInRange(event.selection).length ?? 0,
            );
          },
        );
        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
          runSelectionOrDocument,
        );
        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
          runSelectionOrDocument,
        );
        const completionSubscription =
          monaco.languages.registerCompletionItemProvider("sql", {
            triggerCharacters: [".", " "],
            provideCompletionItems(model, position) {
              const word = model.getWordUntilPosition(position);
              const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
              };
              return {
                suggestions: completionsRef.current.map((item) => ({
                  label: item.label,
                  detail: item.detail,
                  insertText: item.label,
                  kind: completionKind(item.kind),
                  range,
                })),
              };
            },
          });

        disposeEditor = () => {
          completionSubscription.dispose();
          cursorSubscription.dispose();
          contentSubscription.dispose();
          editor.dispose();
          editorRef.current = null;
          for (const model of modelsRef.current.values()) model.dispose();
          modelsRef.current.clear();
        };
      }, 0);
      return () => {
        window.clearTimeout(initialization);
        disposeEditor?.();
      };
    }, []);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      for (const tab of tabs) {
        let model = modelsRef.current.get(tab.id);
        if (!model) {
          model = createModel(tab);
          modelsRef.current.set(tab.id, model);
        } else if (model.getValue() !== tab.sql) {
          syncingRef.current = true;
          model.setValue(tab.sql);
          syncingRef.current = false;
        }
      }
      const activeModel = modelsRef.current.get(activeTabId);
      if (activeModel && editor.getModel() !== activeModel)
        editor.setModel(activeModel);
      const liveIds = new Set(tabs.map((tab) => tab.id));
      for (const [id, model] of modelsRef.current) {
        if (!liveIds.has(id)) {
          model.dispose();
          modelsRef.current.delete(id);
        }
      }
      editor.focus();
    }, [activeTabId, tabs]);

    return (
      <div className="monaco-host" ref={containerRef} aria-label="SQL editor" />
    );
  },
);

function createModel(tab: QueryTab): monaco.editor.ITextModel {
  return monaco.editor.createModel(
    tab.sql,
    "sql",
    monaco.Uri.parse(`inmemory://queryx/${encodeURIComponent(tab.id)}.sql`),
  );
}

function completionKind(
  kind: SqlCompletion["kind"],
): monaco.languages.CompletionItemKind {
  if (kind === "schema") return monaco.languages.CompletionItemKind.Module;
  if (kind === "table") return monaco.languages.CompletionItemKind.Class;
  return monaco.languages.CompletionItemKind.Field;
}
