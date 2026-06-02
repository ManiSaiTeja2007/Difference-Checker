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

// Merge ball state
let mergeBalls: HTMLElement[] = [];
let activeDragBall: HTMLElement | null = null;
let dragStartX = 0;
let dragBallChange: ILineChange | null = null;

interface EditorSettings {
  theme: string;
  wordWrap: 'on' | 'off';
  minimap: boolean;
  ignoreTrimWhitespace: boolean;
}

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
    document.getElementById('btn-compare')?.addEventListener('click', () => this.runComparison());
    document.getElementById('text-swap')?.addEventListener('click', () => this.swapContent());
    document.getElementById('text-clear')?.addEventListener('click', () => this.clearContent());
    document.getElementById('text-save')?.addEventListener('click', () => this.saveToHistory());

    const viewModeToggle = document.getElementById('text-view-mode') as HTMLInputElement | null;
    viewModeToggle?.addEventListener('change', (e) => {
      diffEditor?.updateOptions({ renderSideBySide: (e.target as HTMLInputElement).checked });
    });

    // Nav diff buttons
    document.getElementById('btn-prev-diff')?.addEventListener('click', () => this.navigateDiff(-1));
    document.getElementById('btn-next-diff')?.addEventListener('click', () => this.navigateDiff(1));

    this.setupDragAndDrop('upload-left', 'file-left', 'raw-text-left', 'left');
    this.setupDragAndDrop('upload-right', 'file-right', 'raw-text-right', 'right');

    // Global drag events for merge ball
    window.addEventListener('mousemove', (e) => this.onBallDrag(e));
    window.addEventListener('mouseup', (e) => this.onBallDragEnd(e));
  },

  setupDragAndDrop(zoneId: string, inputId: string, textareaId: string, side: 'left' | 'right'): void {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const textarea = document.getElementById(textareaId) as HTMLTextAreaElement | null;
    if (!zone || !input || !textarea) return;

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.readFile(file, textarea, side);
    });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = (e as DragEvent).dataTransfer?.files[0];
      if (file) this.readFile(file, textarea, side);
    });
  },

  readFile(file: File, textarea: HTMLTextAreaElement, side: 'left' | 'right'): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      textarea.value = text;
      const detectedLang = this.getLanguageFromFilename(file.name);
      currentLanguage = detectedLang;
      const label = document.querySelector<HTMLElement>(`#upload-${side} .upload-label span`);
      if (label) label.textContent = `${file.name}`;
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
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      json: 'json', html: 'html', htm: 'html', css: 'css', py: 'python',
      java: 'java', cpp: 'cpp', c: 'c', cs: 'csharp', go: 'go', rs: 'rust',
      md: 'markdown', xml: 'xml', yaml: 'yaml', yml: 'yaml', sh: 'shell',
      sql: 'sql', diff: 'diff', patch: 'diff',
    };
    return map[ext] ?? 'plaintext';
  },

  navigateDiff(direction: -1 | 1): void {
    if (!diffEditor) return;
    const action = direction === 1
      ? 'editor.action.diffReview.next'
      : 'editor.action.diffReview.prev';
    diffEditor.getModifiedEditor().trigger('keyboard', action, null);
  },

  async runComparison(): Promise<void> {
    const textLeft = (document.getElementById('raw-text-left') as HTMLTextAreaElement).value;
    const textRight = (document.getElementById('raw-text-right') as HTMLTextAreaElement).value;

    const inputView = document.getElementById('text-input-view');
    const diffContainer = document.getElementById('monaco-diff-container');
    const compareBtn = document.getElementById('btn-compare');
    const statsContainer = document.getElementById('diff-stats');
    const navBtns = document.getElementById('diff-nav-btns');

    if (inputView) inputView.classList.add('hidden');
    if (diffContainer) diffContainer.classList.remove('hidden');
    if (statsContainer) statsContainer.classList.remove('hidden');
    if (navBtns) navBtns.classList.remove('hidden');
    if (compareBtn) compareBtn.textContent = 'Refresh';

    if (!monaco) {
      if (diffContainer) {
        diffContainer.innerHTML = `<div class="pdf-loading-overlay"><div class="spinner"></div><p>Loading Monaco Editor…</p></div>`;
      }

      monaco = await loader.init() as unknown as Monaco;
      if (diffContainer) diffContainer.innerHTML = '';

      // Define good diff colors for dark theme
      monaco.editor.defineTheme('ag-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#0d0e14',
          'diffEditor.insertedTextBackground': '#1a3a2a',
          'diffEditor.removedTextBackground': '#3a1a1a',
          'diffEditor.insertedLineBackground': '#122318',
          'diffEditor.removedLineBackground': '#2a1212',
          'diffEditor.diagonalFill': '#1e1f2a',
        },
      });

      monaco.editor.defineTheme('ag-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'diffEditor.insertedTextBackground': '#c8f7d8',
          'diffEditor.removedTextBackground': '#ffd7d7',
          'diffEditor.insertedLineBackground': '#d4fae6',
          'diffEditor.removedLineBackground': '#ffe4e4',
        },
      });

      monaco.editor.defineTheme('colorblind-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'diffEditor.insertedTextBackground': '#0d2b4d',
          'diffEditor.removedTextBackground': '#4d1a00',
        },
      });

      monaco.editor.defineTheme('colorblind-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'diffEditor.insertedTextBackground': '#b3d9ff',
          'diffEditor.removedTextBackground': '#ffd9b3',
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
        glyphMargin: false,           // No glyph margin — we use floating merge balls instead
        lineDecorationsWidth: 4,
        scrollbar: { vertical: 'visible', horizontal: 'visible' },
        renderOverviewRuler: true,
        diffCodeLens: false,
      });

      // Use the correct themed version
      this.applyTheme();

      diffEditor.getModifiedEditor().onDidChangeModelContent(() => this.onContentChange());
      diffEditor.getOriginalEditor().onDidChangeModelContent(() => this.onContentChange());

      // Sync scrolling between both sides
      let syncingScroll = false;
      diffEditor.getOriginalEditor().onDidScrollChange((e) => {
        if (syncingScroll) return;
        syncingScroll = true;
        diffEditor!.getModifiedEditor().setScrollTop(e.scrollTop);
        syncingScroll = false;
        this.positionMergeBalls();
      });
      diffEditor.getModifiedEditor().onDidScrollChange((e) => {
        if (syncingScroll) return;
        syncingScroll = true;
        diffEditor!.getOriginalEditor().setScrollTop(e.scrollTop);
        syncingScroll = false;
        this.positionMergeBalls();
      });

      diffEditor.onDidUpdateDiff(() => {
        this.calculateStats();
        this.renderMergeBalls();
      });
    }

    this.updateEditorModels(textLeft, textRight, currentLanguage);
  },

  applyTheme(): void {
    if (!monaco) return;
    if (isColorblindMode) {
      monaco.editor.setTheme(editorSettings.theme === 'vs-light' ? 'colorblind-light' : 'colorblind-dark');
    } else {
      monaco.editor.setTheme(editorSettings.theme === 'vs-light' ? 'ag-light' : 'ag-dark');
    }
  },

  updateEditorModels(originalText: string, modifiedText: string, lang: string): void {
    if (!monaco || !diffEditor) return;
    if (originalModel) originalModel.dispose();
    if (modifiedModel) modifiedModel.dispose();
    originalModel = monaco.editor.createModel(originalText, lang);
    modifiedModel = monaco.editor.createModel(modifiedText, lang);
    diffEditor.setModel({ original: originalModel, modified: modifiedModel });
    this.calculateStats();
  },

  onContentChange(): void {
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
    let added = 0, deleted = 0;
    const modifiedText = modifiedModel?.getValue() ?? '';
    const modifiedLinesCount = modifiedText.split(/\r?\n/).length;

    if (lineChanges) {
      lineChanges.forEach((c) => {
        added += c.modifiedEndLineNumber === 0 ? 0 : c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1;
        deleted += c.originalEndLineNumber === 0 ? 0 : c.originalEndLineNumber - c.originalStartLineNumber + 1;
      });
    }

    const unchanged = Math.max(0, modifiedLinesCount - added);
    const el = (s: string) => document.querySelector(s);
    const sa = el('.txt-added'); const sd = el('.txt-deleted'); const su = el('.txt-unchanged');
    if (sa) sa.textContent = String(added);
    if (sd) sd.textContent = String(deleted);
    if (su) su.textContent = String(unchanged);

    // Update diff count badge
    const badge = document.getElementById('diff-count-badge');
    if (badge) {
      const total = lineChanges?.length ?? 0;
      badge.textContent = String(total);
      badge.style.display = total > 0 ? 'flex' : 'none';
    }
  },

  // ─── MERGE BALL SYSTEM ───────────────────────────────────────────────────────
  //
  // Instead of glyph margin arrows, we overlay a draggable pill/ball on the
  // center separator between original and modified editors. Each diff block gets
  // its own ball, positioned at the vertical center of that diff block.
  // Dragging left merges modified→original; dragging right merges original→modified.
  //
  renderMergeBalls(): void {
    const container = document.getElementById('monaco-diff-container');
    if (!container || !diffEditor || !monaco) return;

    // Remove old balls
    mergeBalls.forEach((b) => b.remove());
    mergeBalls = [];

    const changes = diffEditor.getLineChanges();
    if (!changes || changes.length === 0) return;

    // We overlay balls on the monaco container. They need absolute positioning.
    if (container.style.position !== 'absolute') {
      container.style.position = 'relative';
    }

    changes.forEach((change, index) => {
      const ball = document.createElement('div');
      ball.className = 'merge-ball';
      ball.setAttribute('data-index', String(index));
      ball.innerHTML = `
        <div class="merge-ball-track">
          <div class="merge-ball-label left" title="Merge right → left">◀</div>
          <div class="merge-ball-knob" title="Drag ← to pull from right | Drag → to push to right"></div>
          <div class="merge-ball-label right" title="Merge left → right">▶</div>
        </div>
      `;

      ball.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        activeDragBall = ball;
        dragStartX = e.clientX;
        dragBallChange = change;
        ball.classList.add('dragging');
      });

      // Also handle label clicks directly
      ball.querySelector('.merge-ball-label.left')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.mergeChangeLeft(change);
      });
      ball.querySelector('.merge-ball-label.right')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.mergeChangeRight(change);
      });

      container.appendChild(ball);
      mergeBalls.push(ball);
    });

    this.positionMergeBalls();
  },

  positionMergeBalls(): void {
    if (!diffEditor || !monaco) return;
    const container = document.getElementById('monaco-diff-container');
    if (!container) return;

    const changes = diffEditor.getLineChanges();
    if (!changes) return;

    const origEditor = diffEditor.getOriginalEditor();
    const lineHeight = origEditor.getOption(monaco.editor.EditorOption.lineHeight);
    const scrollTop = origEditor.getScrollTop();
    const containerRect = container.getBoundingClientRect();
    const editorLayout = origEditor.getLayoutInfo();
    const containerWidth = containerRect.width;

    // The center separator column in a side-by-side diff
    // Monaco renders: [original] [overview_ruler] [modified]
    // The gap is at approximately 50% of the total width
    const centerX = containerWidth / 2;

    mergeBalls.forEach((ball, i) => {
      const change = changes[i];
      if (!change) return;

      // Vertical: center of the change block in original editor
      const topLine = change.originalEndLineNumber > 0
        ? change.originalStartLineNumber
        : change.modifiedStartLineNumber;

      const lineTop = origEditor.getTopForLineNumber(topLine) - scrollTop;
      const blockHeight = change.originalEndLineNumber > 0
        ? (change.originalEndLineNumber - change.originalStartLineNumber + 1) * lineHeight
        : lineHeight;

      const ballTop = lineTop + blockHeight / 2;

      ball.style.left = `${centerX}px`;
      ball.style.top = `${ballTop}px`;
      ball.style.transform = 'translate(-50%, -50%)';

      // Hide if scrolled out of view
      const containerHeight = containerRect.height;
      if (ballTop < -20 || ballTop > containerHeight + 20) {
        ball.style.display = 'none';
      } else {
        ball.style.display = 'flex';
      }
    });
  },

  onBallDrag(e: MouseEvent): void {
    if (!activeDragBall || !dragBallChange) return;
    const dx = e.clientX - dragStartX;
    const knob = activeDragBall.querySelector<HTMLElement>('.merge-ball-knob');
    if (!knob) return;

    // Show directional hint
    const clampedDx = Math.max(-40, Math.min(40, dx));
    knob.style.transform = `translateX(${clampedDx}px)`;

    if (dx < -10) {
      activeDragBall.classList.add('hint-left');
      activeDragBall.classList.remove('hint-right');
    } else if (dx > 10) {
      activeDragBall.classList.add('hint-right');
      activeDragBall.classList.remove('hint-left');
    } else {
      activeDragBall.classList.remove('hint-left', 'hint-right');
    }
  },

  onBallDragEnd(e: MouseEvent): void {
    if (!activeDragBall || !dragBallChange) return;
    const dx = e.clientX - dragStartX;
    const knob = activeDragBall.querySelector<HTMLElement>('.merge-ball-knob');

    activeDragBall.classList.remove('dragging', 'hint-left', 'hint-right');
    if (knob) knob.style.transform = '';

    const THRESHOLD = 30; // px drag threshold to commit
    if (dx > THRESHOLD) {
      // Dragged right → push original → modified
      this.mergeChangeRight(dragBallChange);
      this.flashBall(activeDragBall, 'right');
    } else if (dx < -THRESHOLD) {
      // Dragged left → pull modified → original
      this.mergeChangeLeft(dragBallChange);
      this.flashBall(activeDragBall, 'left');
    }

    activeDragBall = null;
    dragBallChange = null;
    dragStartX = 0;
  },

  flashBall(ball: HTMLElement, direction: 'left' | 'right'): void {
    ball.classList.add(`flash-${direction}`);
    setTimeout(() => ball.classList.remove(`flash-left`, `flash-right`), 600);
  },

  // ─── MERGE OPERATIONS ──────────────────────────────────────────────────────
  mergeChangeRight(change: ILineChange): void {
    if (!diffEditor || !monaco) return;
    const origModel = diffEditor.getOriginalEditor().getModel();
    const modModel = diffEditor.getModifiedEditor().getModel();
    if (!origModel || !modModel) return;

    let textToCopy = '';
    if (change.originalEndLineNumber > 0) {
      const maxCol = origModel.getLineMaxColumn(change.originalEndLineNumber);
      textToCopy = origModel.getValueInRange(new monaco.Range(change.originalStartLineNumber, 1, change.originalEndLineNumber, maxCol));
      if (change.modifiedEndLineNumber === 0) textToCopy += '\n';
    }

    const rangeToReplace = change.modifiedEndLineNumber === 0
      ? new monaco.Range(change.modifiedStartLineNumber, 1, change.modifiedStartLineNumber, 1)
      : new monaco.Range(change.modifiedStartLineNumber, 1, change.modifiedEndLineNumber, modModel.getLineMaxColumn(change.modifiedEndLineNumber));

    modModel.pushEditOperations([], [{ range: rangeToReplace, text: textToCopy }], () => null);
  },

  mergeChangeLeft(change: ILineChange): void {
    if (!diffEditor || !monaco) return;
    const origModel = diffEditor.getOriginalEditor().getModel();
    const modModel = diffEditor.getModifiedEditor().getModel();
    if (!origModel || !modModel) return;

    let textToCopy = '';
    if (change.modifiedEndLineNumber > 0) {
      const maxCol = modModel.getLineMaxColumn(change.modifiedEndLineNumber);
      textToCopy = modModel.getValueInRange(new monaco.Range(change.modifiedStartLineNumber, 1, change.modifiedEndLineNumber, maxCol));
      if (change.originalEndLineNumber === 0) textToCopy += '\n';
    }

    const rangeToReplace = change.originalEndLineNumber === 0
      ? new monaco.Range(change.originalStartLineNumber, 1, change.originalStartLineNumber, 1)
      : new monaco.Range(change.originalStartLineNumber, 1, change.originalEndLineNumber, origModel.getLineMaxColumn(change.originalEndLineNumber));

    origModel.pushEditOperations([], [{ range: rangeToReplace, text: textToCopy }], () => null);
  },

  swapContent(): void {
    const leftTA = document.getElementById('raw-text-left') as HTMLTextAreaElement;
    const rightTA = document.getElementById('raw-text-right') as HTMLTextAreaElement;
    [leftTA.value, rightTA.value] = [rightTA.value, leftTA.value];

    const lLabel = document.querySelector<HTMLElement>('#upload-left .upload-label span');
    const rLabel = document.querySelector<HTMLElement>('#upload-right .upload-label span');
    if (lLabel && rLabel) [lLabel.textContent, rLabel.textContent] = [rLabel.textContent, lLabel.textContent];

    if (diffEditor) this.updateEditorModels(leftTA.value, rightTA.value, currentLanguage);
  },

  clearContent(): void {
    const leftTA = document.getElementById('raw-text-left') as HTMLTextAreaElement | null;
    const rightTA = document.getElementById('raw-text-right') as HTMLTextAreaElement | null;
    if (leftTA) leftTA.value = '';
    if (rightTA) rightTA.value = '';

    document.querySelector<HTMLElement>('#upload-left .upload-label span')!.textContent = 'Upload Original';
    document.querySelector<HTMLElement>('#upload-right .upload-label span')!.textContent = 'Upload Modified';

    document.getElementById('text-input-view')?.classList.remove('hidden');
    document.getElementById('monaco-diff-container')?.classList.add('hidden');
    document.getElementById('diff-stats')?.classList.add('hidden');
    document.getElementById('diff-nav-btns')?.classList.add('hidden');
    const btn = document.getElementById('btn-compare');
    if (btn) btn.textContent = 'Find Differences';

    mergeBalls.forEach((b) => b.remove());
    mergeBalls = [];

    if (originalModel) originalModel.setValue('');
    if (modifiedModel) modifiedModel.setValue('');

    ['txt-added', 'txt-deleted', 'txt-unchanged'].forEach((cls) => {
      const el = document.querySelector(`.${cls}`);
      if (el) el.textContent = '0';
    });
  },

  loadComparison(contentLeft: string, contentRight: string, labelL: string, labelR: string, lang = 'plaintext'): void {
    const leftTA = document.getElementById('raw-text-left') as HTMLTextAreaElement | null;
    const rightTA = document.getElementById('raw-text-right') as HTMLTextAreaElement | null;
    if (leftTA) leftTA.value = contentLeft;
    if (rightTA) rightTA.value = contentRight;

    const lLabel = document.querySelector<HTMLElement>('#upload-left .upload-label span');
    const rLabel = document.querySelector<HTMLElement>('#upload-right .upload-label span');
    if (lLabel) lLabel.textContent = labelL || 'Original';
    if (rLabel) rLabel.textContent = labelR || 'Modified';

    currentLanguage = lang;
    this.runComparison();
  },

  saveToHistory(): void {
    const leftText = (document.getElementById('raw-text-left') as HTMLTextAreaElement)?.value ?? '';
    const rightText = (document.getElementById('raw-text-right') as HTMLTextAreaElement)?.value ?? '';
    if (!leftText && !rightText) { alert('Nothing to save!'); return; }

    const labelLeft = document.querySelector<HTMLElement>('#upload-left .upload-label span')?.textContent ?? 'Original';
    const labelRight = document.querySelector<HTMLElement>('#upload-right .upload-label span')?.textContent ?? 'Modified';

    const entry = HistoryManager.saveComparison({ type: 'text', labelLeft, labelRight, contentLeft: leftText, contentRight: rightText });
    if (entry) alert('Diff saved to local history.');
  },
};
