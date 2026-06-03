// Text Comparison View Controller using Monaco Editor
import loader from '@monaco-editor/loader';
import type * as MonacoEditorType from 'monaco-editor';
import { HistoryManager } from './history';

type Monaco = typeof MonacoEditorType;
type IStandaloneDiffEditor = MonacoEditorType.editor.IStandaloneDiffEditor;
type ITextModel = MonacoEditorType.editor.ITextModel;
type ILineChange = MonacoEditorType.editor.ILineChange;

let monaco: Monaco | null = null;
let diffEditor: IStandaloneDiffEditor | null = null;
let originalModel: ITextModel | null = null;
let modifiedModel: ITextModel | null = null;
let currentLanguage = 'plaintext';
let originalDecorations: string[] = [];
let modifiedDecorations: string[] = [];

interface EditorSettings {
  theme: string;
  wordWrap: 'on' | 'off';
  minimap: boolean;
  ignoreTrimWhitespace: boolean;
}

// Settings state
let editorSettings: EditorSettings = {
  theme: 'vs-dark',
  wordWrap: 'on',
  minimap: true,
  ignoreTrimWhitespace: true,
};
let isColorblindMode = localStorage.getItem('colorblind_mode') === 'true';

export const TextDiffController = {
  async init(settings?: Partial<EditorSettings>): Promise<void> {
    if (settings) {
      editorSettings = { ...editorSettings, ...settings };
    }

    // Bind base event listeners
    this.bindDOMEvents();
  },

  updateSettings(newSettings: Partial<EditorSettings>): void {
    editorSettings = { ...editorSettings, ...newSettings };
    if (diffEditor) {
      diffEditor.updateOptions({
        wordWrap: editorSettings.wordWrap,
        minimap: { enabled: editorSettings.minimap },
        ignoreTrimWhitespace: editorSettings.ignoreTrimWhitespace,
      });
      this.applyTheme();
    }
  },

  applyTheme(): void {
    if (!monaco) return;
    let themeName = editorSettings.theme;
    if (isColorblindMode) {
      themeName = editorSettings.theme === 'vs-light' ? 'colorblind-light' : 'colorblind-dark';
    }
    monaco.editor.setTheme(themeName);
  },

  updateColorblindMode(checked: boolean): void {
    isColorblindMode = checked;
    this.applyTheme();
  },

  triggerLayout(): void {
    if (diffEditor) {
      diffEditor.layout();
    }
  },

  bindDOMEvents(): void {
    const compareBtn = document.getElementById('btn-compare');
    if (compareBtn) {
      compareBtn.addEventListener('click', () => this.runComparison());
    }

    const swapBtn = document.getElementById('text-swap');
    if (swapBtn) {
      swapBtn.addEventListener('click', () => this.swapContent());
    }

    const clearBtn = document.getElementById('text-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearContent());
    }

    const viewModeToggle = document.getElementById('text-view-mode') as HTMLInputElement | null;
    if (viewModeToggle) {
      viewModeToggle.addEventListener('change', (e) => {
        if (diffEditor) {
          diffEditor.updateOptions({
            renderSideBySide: (e.target as HTMLInputElement).checked,
          });
        }
      });
    }

    const saveBtn = document.getElementById('text-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveToHistory());
    }

    // Drag and Drop files setup
    this.setupDragAndDrop('upload-left', 'file-left', 'raw-text-left', 'left');
    this.setupDragAndDrop('upload-right', 'file-right', 'raw-text-right', 'right');
  },

  setupDragAndDrop(zoneId: string, inputId: string, textareaId: string, side: 'left' | 'right'): void {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const textarea = document.getElementById(textareaId) as HTMLTextAreaElement | null;

    if (!zone || !input || !textarea) return;

    zone.addEventListener('click', () => input.click());
    input.addEventListener('click', (e) => e.stopPropagation());

    input.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        this.readFile(file, textarea, side);
      }
    });

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = (e as DragEvent).dataTransfer?.files[0];
      if (file) {
        this.readFile(file, textarea, side);
      }
    });
  },

  readFile(file: File, textarea: HTMLTextAreaElement, side: 'left' | 'right'): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      textarea.value = text;

      // Auto-detect language
      const detectedLang = this.getLanguageFromFilename(file.name);
      currentLanguage = detectedLang;

      // Update upload zone label
      const label = document.querySelector<HTMLElement>(`#upload-${side} .upload-label span`);
      if (label) {
        label.textContent = `${file.name} (${detectedLang})`;
      }

      // If monaco is already active, sync
      if (diffEditor) {
        const originalText = (document.getElementById('raw-text-left') as HTMLTextAreaElement).value;
        const modifiedText = (document.getElementById('raw-text-right') as HTMLTextAreaElement).value;
        this.updateEditorModels(originalText, modifiedText, currentLanguage);
      }
    };
    reader.readAsText(file);
  },

  getLanguageFromFilename(filename: string): string {
    if (!filename) return 'plaintext';
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      json: 'json',
      html: 'html',
      htm: 'html',
      css: 'css',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      cs: 'csharp',
      go: 'go',
      rs: 'rust',
      md: 'markdown',
      xml: 'xml',
      yaml: 'yaml',
      yml: 'yaml',
      sh: 'shell',
      sql: 'sql',
      diff: 'diff',
      patch: 'diff',
    };
    return map[ext] ?? 'plaintext';
  },

  async runComparison(): Promise<void> {
    const textLeft = (document.getElementById('raw-text-left') as HTMLTextAreaElement).value;
    const textRight = (document.getElementById('raw-text-right') as HTMLTextAreaElement).value;

    const inputView = document.getElementById('text-input-view');
    const diffContainer = document.getElementById('monaco-diff-container');
    const compareBtn = document.getElementById('btn-compare');
    const statsContainer = document.getElementById('diff-stats');

    if (inputView) inputView.classList.add('hidden');
    if (diffContainer) diffContainer.classList.remove('hidden');
    if (statsContainer) statsContainer.classList.remove('hidden');
    if (compareBtn) compareBtn.textContent = 'Refresh View';

    if (!monaco) {
      // Show loading status inside container
      if (diffContainer) {
        diffContainer.innerHTML = `<div class="pdf-loading-overlay"><div class="spinner"></div><p>Loading Monaco Code Editor...</p></div>`;
      }

      monaco = await loader.init() as unknown as Monaco;

      if (diffContainer) diffContainer.innerHTML = '';

      // Register colorblind themes
      monaco.editor.defineTheme('colorblind-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'diffEditor.insertedTextBackground': '#004b8733',
          'diffEditor.removedTextBackground': '#cc440033',
        },
      });

      monaco.editor.defineTheme('colorblind-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'diffEditor.insertedTextBackground': '#60a5fa33',
          'diffEditor.removedTextBackground': '#fb923c33',
        },
      });

      const viewModeToggle = document.getElementById('text-view-mode') as HTMLInputElement | null;

      diffEditor = monaco.editor.createDiffEditor(diffContainer!, {
        originalEditable: true,
        renderSideBySide: viewModeToggle?.checked ?? true,
        wordWrap: editorSettings.wordWrap,
        minimap: { enabled: editorSettings.minimap },
        ignoreTrimWhitespace: editorSettings.ignoreTrimWhitespace,
        automaticLayout: true,
        folding: true,
        glyphMargin: true,
        diffAlgorithm: 'advanced',
        showMoves: true,
        scrollbar: {
          vertical: 'visible',
          horizontal: 'visible',
        },
      } as any);

      this.applyTheme();

      // Hook change listener on editors to sync stats
      const modifiedEditor = diffEditor.getModifiedEditor();
      const originalEditor = diffEditor.getOriginalEditor();

      modifiedEditor.onDidChangeModelContent(() => this.onContentChange());
      originalEditor.onDidChangeModelContent(() => this.onContentChange());

      // Hook mouse clicks on glyph margins for bidirectional merges
      // ORIGINAL SIDE click → merge this block into modified (push right →)
      originalEditor.onMouseDown((e) => {
        if (e.target.type === monaco!.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          const lineNum = e.target.position?.lineNumber;
          if (lineNum == null) return;
          const changes = diffEditor!.getLineChanges();
          if (changes) {
            // Find change that matches this line in original side
            const change = changes.find((c) => {
              const glyphLine = c.originalEndLineNumber > 0
                ? c.originalStartLineNumber
                : Math.max(1, c.originalStartLineNumber);
              return lineNum === glyphLine;
            });
            if (change) {
              this.mergeChangeRight(change);
            }
          }
        }
      });

      // MODIFIED SIDE click → merge this block back into original (pull left ←)
      modifiedEditor.onMouseDown((e) => {
        if (e.target.type === monaco!.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          const lineNum = e.target.position?.lineNumber;
          if (lineNum == null) return;
          const changes = diffEditor!.getLineChanges();
          if (changes) {
            const change = changes.find((c) => {
              const glyphLine = c.modifiedEndLineNumber > 0
                ? c.modifiedStartLineNumber
                : Math.max(1, c.modifiedStartLineNumber);
              return lineNum === glyphLine;
            });
            if (change) {
              this.mergeChangeLeft(change);
            }
          }
        }
      });

      diffEditor.onDidUpdateDiff(() => {
        this.calculateStats();
        this.updateMergeDecorations();
      });
    }

    this.updateEditorModels(textLeft, textRight, currentLanguage);
  },

  updateEditorModels(originalText: string, modifiedText: string, lang: string): void {
    if (!monaco || !diffEditor) return;

    if (originalModel) originalModel.dispose();
    if (modifiedModel) modifiedModel.dispose();

    originalModel = monaco.editor.createModel(originalText, lang);
    modifiedModel = monaco.editor.createModel(modifiedText, lang);

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });

    this.calculateStats();
  },

  onContentChange(): void {
    // Keep textarea synced with monaco changes
    if (originalModel && modifiedModel) {
      const leftTA = document.getElementById('raw-text-left') as HTMLTextAreaElement | null;
      const rightTA = document.getElementById('raw-text-right') as HTMLTextAreaElement | null;
      if (leftTA) leftTA.value = originalModel.getValue();
      if (rightTA) rightTA.value = modifiedModel.getValue();
    }
  },

  calculateStats(): void {
    if (!diffEditor) return;
    const lineChanges = diffEditor.getLineChanges();
    let added = 0;
    let deleted = 0;

    const modifiedText = modifiedModel ? modifiedModel.getValue() : '';
    const modifiedLinesCount = modifiedText.split(/\r?\n/).length;

    if (lineChanges) {
      lineChanges.forEach((change) => {
        const originalCount =
          change.originalEndLineNumber === 0
            ? 0
            : change.originalEndLineNumber - change.originalStartLineNumber + 1;
        const modifiedCount =
          change.modifiedEndLineNumber === 0
            ? 0
            : change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;

        added += modifiedCount;
        deleted += originalCount;
      });
    }

    const unchanged = Math.max(0, modifiedLinesCount - added);

    const elAdded = document.querySelector('.txt-added');
    const elDeleted = document.querySelector('.txt-deleted');
    const elUnchanged = document.querySelector('.txt-unchanged');
    if (elAdded) elAdded.textContent = String(added);
    if (elDeleted) elDeleted.textContent = String(deleted);
    if (elUnchanged) elUnchanged.textContent = String(unchanged);
  },

  swapContent(): void {
    const leftTextarea = document.getElementById('raw-text-left') as HTMLTextAreaElement;
    const rightTextarea = document.getElementById('raw-text-right') as HTMLTextAreaElement;
    const temp = leftTextarea.value;

    leftTextarea.value = rightTextarea.value;
    rightTextarea.value = temp;

    // Swap labels
    const labelLeft = document.querySelector<HTMLElement>('#upload-left .upload-label span');
    const labelRight = document.querySelector<HTMLElement>('#upload-right .upload-label span');
    if (labelLeft && labelRight) {
      const tempLabel = labelLeft.textContent;
      labelLeft.textContent = labelRight.textContent;
      labelRight.textContent = tempLabel;
    }

    if (diffEditor) {
      this.updateEditorModels(leftTextarea.value, rightTextarea.value, currentLanguage);
    }
  },

  clearContent(): void {
    const leftTA = document.getElementById('raw-text-left') as HTMLTextAreaElement | null;
    const rightTA = document.getElementById('raw-text-right') as HTMLTextAreaElement | null;
    if (leftTA) leftTA.value = '';
    if (rightTA) rightTA.value = '';

    const labelLeft = document.querySelector<HTMLElement>('#upload-left .upload-label span');
    const labelRight = document.querySelector<HTMLElement>('#upload-right .upload-label span');
    if (labelLeft) labelLeft.textContent = 'Upload Original File';
    if (labelRight) labelRight.textContent = 'Upload Modified File';

    const inputView = document.getElementById('text-input-view');
    const diffContainer = document.getElementById('monaco-diff-container');
    const compareBtn = document.getElementById('btn-compare');
    const statsContainer = document.getElementById('diff-stats');

    if (inputView) inputView.classList.remove('hidden');
    if (diffContainer) diffContainer.classList.add('hidden');
    if (statsContainer) statsContainer.classList.add('hidden');
    if (compareBtn) compareBtn.textContent = 'Find Differences';

    if (originalModel) originalModel.setValue('');
    if (modifiedModel) modifiedModel.setValue('');

    if (diffEditor) {
      originalDecorations = diffEditor
        .getOriginalEditor()
        .deltaDecorations(originalDecorations, []);
      modifiedDecorations = diffEditor
        .getModifiedEditor()
        .deltaDecorations(modifiedDecorations, []);
    }

    const elAdded = document.querySelector('.txt-added');
    const elDeleted = document.querySelector('.txt-deleted');
    const elUnchanged = document.querySelector('.txt-unchanged');
    if (elAdded) elAdded.textContent = '0';
    if (elDeleted) elDeleted.textContent = '0';
    if (elUnchanged) elUnchanged.textContent = '0';
  },

  loadComparison(
    contentLeft: string,
    contentRight: string,
    labelL: string,
    labelR: string,
    lang = 'plaintext'
  ): void {
    const leftTA = document.getElementById('raw-text-left') as HTMLTextAreaElement | null;
    const rightTA = document.getElementById('raw-text-right') as HTMLTextAreaElement | null;
    if (leftTA) leftTA.value = contentLeft;
    if (rightTA) rightTA.value = contentRight;

    const labelLeft = document.querySelector<HTMLElement>('#upload-left .upload-label span');
    const labelRight = document.querySelector<HTMLElement>('#upload-right .upload-label span');
    if (labelLeft) labelLeft.textContent = labelL || 'Original File';
    if (labelRight) labelRight.textContent = labelR || 'Modified File';

    currentLanguage = lang;
    this.runComparison();
  },

  saveToHistory(): void {
    const leftTA = document.getElementById('raw-text-left') as HTMLTextAreaElement | null;
    const rightTA = document.getElementById('raw-text-right') as HTMLTextAreaElement | null;
    const leftText = leftTA?.value ?? '';
    const rightText = rightTA?.value ?? '';

    if (!leftText && !rightText) {
      alert('Nothing to save! Please enter some text first.');
      return;
    }

    const labelLeft =
      document.querySelector<HTMLElement>('#upload-left .upload-label span')?.textContent ??
      'Original';
    const labelRight =
      document.querySelector<HTMLElement>('#upload-right .upload-label span')?.textContent ??
      'Modified';

    const entry = HistoryManager.saveComparison({
      type: 'text',
      labelLeft,
      labelRight,
      contentLeft: leftText,
      contentRight: rightText,
    });

    if (entry) {
      alert('Diff successfully saved to local history.');
    }
  },

  /**
   * Merge: push original block → into modified editor
   */
  mergeChangeRight(change: ILineChange): void {
    if (!diffEditor || !monaco) return;
    const origModel = diffEditor.getOriginalEditor().getModel();
    const modModel = diffEditor.getModifiedEditor().getModel();
    if (!origModel || !modModel) return;

    const textL = getLinesText(origModel, change.originalStartLineNumber, change.originalEndLineNumber);
    replaceLines(modModel, change.modifiedStartLineNumber, change.modifiedEndLineNumber, textL);
  },

  /**
   * Merge: pull modified block → into original editor
   */
  mergeChangeLeft(change: ILineChange): void {
    if (!diffEditor || !monaco) return;
    const origModel = diffEditor.getOriginalEditor().getModel();
    const modModel = diffEditor.getModifiedEditor().getModel();
    if (!origModel || !modModel) return;

    const textR = getLinesText(modModel, change.modifiedStartLineNumber, change.modifiedEndLineNumber);
    replaceLines(origModel, change.originalStartLineNumber, change.originalEndLineNumber, textR);
  },

  /**
   * Updates glyph margin decorations for TWO-WAY merge.
   */
  updateMergeDecorations(): void {
    if (!diffEditor || !monaco) return;
    const originalEditor = diffEditor.getOriginalEditor();
    const modifiedEditor = diffEditor.getModifiedEditor();

    const changes = diffEditor.getLineChanges();
    const newOriginalDecs: MonacoEditorType.editor.IModelDeltaDecoration[] = [];
    const newModifiedDecs: MonacoEditorType.editor.IModelDeltaDecoration[] = [];

    if (changes) {
      changes.forEach((change) => {
        const origArrowLine = change.originalEndLineNumber > 0
          ? change.originalStartLineNumber
          : Math.max(1, change.originalStartLineNumber);
        newOriginalDecs.push({
          range: new monaco!.Range(origArrowLine, 1, origArrowLine, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: 'merge-glyph-right',
            glyphMarginHoverMessage: { value: 'Push this change → to the right (Modified)' },
          },
        });

        const modArrowLine = change.modifiedEndLineNumber > 0
          ? change.modifiedStartLineNumber
          : Math.max(1, change.modifiedStartLineNumber);
        newModifiedDecs.push({
          range: new monaco!.Range(modArrowLine, 1, modArrowLine, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: 'merge-glyph-left',
            glyphMarginHoverMessage: { value: '← Pull this change to the left (Original)' },
          },
        });
      });
    }

    originalDecorations = originalEditor.deltaDecorations(originalDecorations, newOriginalDecs);
    modifiedDecorations = modifiedEditor.deltaDecorations(modifiedDecorations, newModifiedDecs);
  },
};

function getLinesText(model: ITextModel, startLine: number, endLine: number): string {
  if (endLine === 0) return '';
  const maxCol = model.getLineMaxColumn(endLine);
  return model.getValueInRange(new monaco!.Range(startLine, 1, endLine, maxCol));
}

function replaceLines(model: ITextModel, startLine: number, endLine: number, newText: string): void {
  const lineCount = model.getLineCount();

  if (endLine === 0) {
    // This is an insertion
    if (newText === '') return; // Nothing to insert

    if (startLine === 0) {
      // Insert at the very beginning
      if (lineCount === 1 && model.getLineContent(1) === '') {
        // Model is empty
        model.pushEditOperations([], [{
          range: new monaco!.Range(1, 1, 1, 1),
          text: newText
        }], () => null);
      } else {
        model.pushEditOperations([], [{
          range: new monaco!.Range(1, 1, 1, 1),
          text: newText.endsWith('\n') ? newText : newText + '\n'
        }], () => null);
      }
    } else {
      // Insert after startLine
      const maxCol = model.getLineMaxColumn(startLine);
      model.pushEditOperations([], [{
        range: new monaco!.Range(startLine, maxCol, startLine, maxCol),
        text: newText.startsWith('\n') ? newText : '\n' + newText
      }], () => null);
    }
  } else {
    // This is a replacement or deletion
    if (newText === '') {
      // Deletion of lines [startLine, endLine]
      if (endLine < lineCount) {
        // Delete lines and the following newline
        model.pushEditOperations([], [{
          range: new monaco!.Range(startLine, 1, endLine + 1, 1),
          text: ''
        }], () => null);
      } else if (startLine > 1) {
        // Delete lines and the preceding newline
        const prevMaxCol = model.getLineMaxColumn(startLine - 1);
        model.pushEditOperations([], [{
          range: new monaco!.Range(startLine - 1, prevMaxCol, endLine, model.getLineMaxColumn(endLine)),
          text: ''
        }], () => null);
      } else {
        // Delete everything
        model.pushEditOperations([], [{
          range: new monaco!.Range(1, 1, lineCount, model.getLineMaxColumn(lineCount)),
          text: ''
        }], () => null);
      }
    } else {
      // Standard replacement
      const maxCol = model.getLineMaxColumn(endLine);
      model.pushEditOperations([], [{
        range: new monaco!.Range(startLine, 1, endLine, maxCol),
        text: newText
      }], () => null);
    }
  }
}

