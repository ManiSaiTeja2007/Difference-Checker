// Folder Comparison View Controller
import loader from '@monaco-editor/loader';
import type * as MonacoEditorType from 'monaco-editor';

type Monaco = typeof MonacoEditorType;
type IStandaloneDiffEditor = MonacoEditorType.editor.IStandaloneDiffEditor;
type ILineChange = MonacoEditorType.editor.ILineChange;

// ──────────────────────────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────────────────────────
let filesLeft: Record<string, File> = {};   // relativePath → File
let filesRight: Record<string, File> = {};  // relativePath → File
let allPaths = new Set<string>();
let comparisonResults: ComparisonItem[] = [];

// NOTE: monacoInstance is the correct name — the old JS code had a critical bug
// where it used bare `monaco` inside functions that actually stored it as `monacoInstance`.
let monacoInstance: Monaco | null = null;
let folderDiffEditor: IStandaloneDiffEditor | null = null;
let currentFilter = 'all'; // all | modified | added | deleted
let searchQuery = '';

// In-memory workspace editing buffers
let leftTextCache: Record<string, string> = {};
let rightTextCache: Record<string, string> = {};
let originalLeftTextCache: Record<string, string> = {};
let originalRightTextCache: Record<string, string> = {};
let viewStates: Record<string, MonacoEditorType.editor.IDiffEditorViewState | null> = {};
let activePath = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let folderOriginalDecorations: string[] = [];
let folderModifiedDecorations: string[] = [];

interface ComparisonItem {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'unchanged';
  fileLeft: File | null;
  fileRight: File | null;
  isDirty: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// Controller
// ──────────────────────────────────────────────────────────────────────────────
export const FolderDiffController = {
  async init(): Promise<void> {
    this.bindDOMEvents();

    // Load Monaco for the side panel comparison
    monacoInstance = await loader.init() as unknown as Monaco;
  },

  bindDOMEvents(): void {
    const clearBtn = document.getElementById('folder-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearAll());
    }

    // Setup input uploads
    this.setupFolderUpload('folder-upload-left', 'folder-input-left', 'left');
    this.setupFolderUpload('folder-upload-right', 'folder-input-right', 'right');

    // Search and filters
    const searchInput = document.getElementById('folder-search') as HTMLInputElement | null;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
        this.renderFileList();
      });
    }

    const pills = document.querySelectorAll<HTMLButtonElement>('.filter-pills .pill');
    pills.forEach((pill) => {
      pill.addEventListener('click', (e) => {
        pills.forEach((p) => p.classList.remove('active'));
        const target = e.currentTarget as HTMLButtonElement;
        target.classList.add('active');
        currentFilter = target.getAttribute('data-filter') ?? 'all';
        this.renderFileList();
      });
    });
  },

  setupFolderUpload(zoneId: string, inputId: string, side: 'left' | 'right'): void {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId) as HTMLInputElement | null;

    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());

    input.addEventListener('change', (e) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? []);
      if (files.length > 0) {
        this.processFiles(files, side);
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
      const files = Array.from((e as DragEvent).dataTransfer?.files ?? []);
      if (files.length > 0) {
        if ((files[0] as File & { webkitRelativePath?: string }).webkitRelativePath) {
          this.processFiles(files, side);
        } else {
          alert(
            'To compare folders, please click the upload boxes to select folders through the system dialog.'
          );
        }
      }
    });
  },

  processFiles(files: File[], side: 'left' | 'right'): void {
    const firstFile = files[0] as File & { webkitRelativePath?: string };
    const rootName = (firstFile.webkitRelativePath ?? '').split('/')[0];
    const folderLabel = document.getElementById(`folder-label-${side}`);
    if (folderLabel) {
      folderLabel.textContent = `${rootName} (${files.length} files)`;
    }

    const folderMap: Record<string, File> = {};
    files.forEach((file) => {
      const f = file as File & { webkitRelativePath?: string };
      const parts = (f.webkitRelativePath ?? f.name).split('/');
      parts.shift(); // remove root name
      const relativePath = parts.join('/');
      folderMap[relativePath] = file;
    });

    if (side === 'left') {
      filesLeft = folderMap;
    } else {
      filesRight = folderMap;
    }

    // If both folders are loaded, perform diff
    if (Object.keys(filesLeft).length > 0 && Object.keys(filesRight).length > 0) {
      this.compareFolders();
    }
  },

  async compareFolders(): Promise<void> {
    const placeholder = document.getElementById('folder-placeholder');
    const resultsLayout = document.getElementById('folder-results');

    if (placeholder) placeholder.classList.add('hidden');
    if (resultsLayout) resultsLayout.classList.remove('hidden');

    allPaths = new Set([...Object.keys(filesLeft), ...Object.keys(filesRight)]);

    // Reset workspace edit buffers
    leftTextCache = {};
    rightTextCache = {};
    originalLeftTextCache = {};
    originalRightTextCache = {};
    viewStates = {};
    activePath = '';
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Show loading text in file list
    const fileList = document.getElementById('folder-list');
    if (fileList) {
      fileList.innerHTML = `<div class="select-file-msg"><div class="spinner"></div><p>Mapping directories...</p></div>`;
    }

    comparisonResults = [];

    for (const path of allPaths) {
      const fileL = filesLeft[path] ?? null;
      const fileR = filesRight[path] ?? null;

      if (fileL && fileR) {
        if (fileL.size !== fileR.size) {
          comparisonResults.push({ path, status: 'modified', fileLeft: fileL, fileRight: fileR, isDirty: false });
        } else {
          if (fileL.size < 1_000_000 && this.isTextFile(path)) {
            const textL = await this.readFileText(fileL);
            const textR = await this.readFileText(fileR);
            if (textL !== textR) {
              comparisonResults.push({ path, status: 'modified', fileLeft: fileL, fileRight: fileR, isDirty: false });
            } else {
              comparisonResults.push({ path, status: 'unchanged', fileLeft: fileL, fileRight: fileR, isDirty: false });
            }
          } else {
            comparisonResults.push({ path, status: 'unchanged', fileLeft: fileL, fileRight: fileR, isDirty: false });
          }
        }
      } else if (fileL) {
        comparisonResults.push({ path, status: 'deleted', fileLeft: fileL, fileRight: null, isDirty: false });
      } else if (fileR) {
        comparisonResults.push({ path, status: 'added', fileLeft: null, fileRight: fileR, isDirty: false });
      }
    }

    comparisonResults.sort((a, b) => a.path.localeCompare(b.path));
    this.renderFileList();
  },

  isTextFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const textExtensions = [
      'txt', 'js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css',
      'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'md',
      'xml', 'yaml', 'yml', 'sh', 'sql',
    ];
    return textExtensions.includes(ext);
  },

  readFileText(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve((e.target?.result as string) ?? '');
      reader.onerror = () => resolve('');
      reader.readAsText(file);
    });
  },

  renderFileList(): void {
    const fileListContainer = document.getElementById('folder-list');
    if (!fileListContainer) return;
    fileListContainer.innerHTML = '';

    const filtered = comparisonResults.filter((item) => {
      const matchesSearch = item.path.toLowerCase().includes(searchQuery);
      if (!matchesSearch) return false;

      if (currentFilter === 'all') return true;
      return item.status === currentFilter;
    });

    const finalItems =
      currentFilter === 'all' && searchQuery === ''
        ? filtered.filter((item) => item.status !== 'unchanged')
        : filtered;

    if (finalItems.length === 0) {
      fileListContainer.innerHTML = `<div class="select-file-msg"><p>No matching files found</p></div>`;
      return;
    }

    finalItems.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'file-item';
      if (item.path === activePath) div.classList.add('active');
      div.setAttribute('data-path', item.path);

      let statusBadge = '';
      if (item.status === 'modified') {
        statusBadge = `<span class="file-status-badge badge-modified">mod</span>`;
      } else if (item.status === 'added') {
        statusBadge = `<span class="file-status-badge badge-added">add</span>`;
      } else if (item.status === 'deleted') {
        statusBadge = `<span class="file-status-badge badge-deleted">del</span>`;
      } else {
        statusBadge = `<span class="file-status-badge badge-unchanged" style="opacity: 0.4;">same</span>`;
      }

      const dirtyDot = item.isDirty
        ? `<span class="file-item-dirty-dot" title="Unsaved changes">●</span>`
        : '';

      div.innerHTML = `
        <div class="file-item-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
          <span>${item.path}</span>
          ${dirtyDot}
        </div>
        ${statusBadge}
      `;

      div.addEventListener('click', () => {
        document.querySelectorAll('.file-item').forEach((el) => el.classList.remove('active'));
        div.classList.add('active');
        this.previewFileComparison(item);
      });

      fileListContainer.appendChild(div);
    });
  },

  async previewFileComparison(item: ComparisonItem): Promise<void> {
    const viewer = document.getElementById('folder-diff-viewer');
    if (!viewer) return;

    // Save viewState of previous active path before swapping
    if (activePath && folderDiffEditor) {
      viewStates[activePath] = folderDiffEditor.saveViewState();
    }
    activePath = item.path;

    // Load file contents from cache or disk
    if (leftTextCache[item.path] === undefined) {
      if (item.fileLeft) {
        const text = await this.readFileText(item.fileLeft);
        leftTextCache[item.path] = text;
        originalLeftTextCache[item.path] = text;
      } else {
        leftTextCache[item.path] = '';
        originalLeftTextCache[item.path] = '';
      }
    }

    if (rightTextCache[item.path] === undefined) {
      if (item.fileRight) {
        const text = await this.readFileText(item.fileRight);
        rightTextCache[item.path] = text;
        originalRightTextCache[item.path] = text;
      } else {
        rightTextCache[item.path] = '';
        originalRightTextCache[item.path] = '';
      }
    }

    const textL = leftTextCache[item.path];
    const textR = rightTextCache[item.path];

    const displayHeader = `${item.path}${item.isDirty ? ' (Unsaved Edits)' : ''}`;

    viewer.innerHTML = `
      <div class="pane-header">${displayHeader}</div>
      <div class="editor-workspace-container" id="folder-inner-diff" style="flex-grow:1;"></div>
    `;

    const innerContainer = viewer.querySelector<HTMLElement>('#folder-inner-diff');
    if (innerContainer) {
      this.createInnerDiffEditor(innerContainer, textL, textR, item.path, item);
    }
  },

  createInnerDiffEditor(
    container: HTMLElement,
    textLeft: string,
    textRight: string,
    filepath: string,
    item: ComparisonItem
  ): void {
    if (!monacoInstance) return;

    if (folderDiffEditor) {
      folderDiffEditor.dispose();
    }

    // ─── BUG FIX: use monacoInstance here, not the bare `monaco` variable ───
    folderDiffEditor = monacoInstance.editor.createDiffEditor(container, {
      originalEditable: true,
      renderSideBySide: true,
      automaticLayout: true,
      folding: true,         // Bug fix: enable folding
      glyphMargin: true,     // Required for merge arrows
      minimap: { enabled: false },
    });

    this.applyTheme();

    const ext = filepath.split('.').pop()?.toLowerCase() ?? '';
    const langMap: Record<string, string> = {
      js: 'javascript',
      ts: 'typescript',
      json: 'json',
      html: 'html',
      css: 'css',
      py: 'python',
      md: 'markdown',
      rs: 'rust',
      go: 'go',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
    };
    const lang = langMap[ext] ?? 'plaintext'; // Bug fix: 'plaintext' not 'text/plain'

    const origModel = monacoInstance.editor.createModel(textLeft, lang);
    const modModel = monacoInstance.editor.createModel(textRight, lang);

    folderDiffEditor.setModel({
      original: origModel,
      modified: modModel,
    });

    // Restore viewState if exists
    const savedState = viewStates[filepath];
    if (savedState) {
      folderDiffEditor.restoreViewState(savedState);
    }

    // Bind change listeners to capture edits and cache them
    origModel.onDidChangeContent(() => {
      leftTextCache[filepath] = origModel.getValue();
      this.queueRecompute(filepath, item);
    });

    modModel.onDidChangeContent(() => {
      rightTextCache[filepath] = modModel.getValue();
      this.queueRecompute(filepath, item);
    });

    // ─── BUG FIX: Hook mouse clicks using monacoInstance (not bare `monaco`) ───
    const originalEditor = folderDiffEditor.getOriginalEditor();
    const modifiedEditor = folderDiffEditor.getModifiedEditor();

    originalEditor.onMouseDown((e) => {
      if (e.target.type === monacoInstance!.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const lineNum = e.target.position?.lineNumber;
        if (lineNum == null) return;
        const changes = folderDiffEditor!.getLineChanges();
        if (changes) {
          const change = changes.find(
            (c) =>
              (c.originalEndLineNumber > 0 &&
                c.originalStartLineNumber <= lineNum &&
                lineNum <= c.originalEndLineNumber) ||
              (c.originalEndLineNumber === 0 && c.originalStartLineNumber === lineNum)
          );
          if (change) this.mergeChangeRight(change);
        }
      }
    });

    modifiedEditor.onMouseDown((e) => {
      if (e.target.type === monacoInstance!.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const lineNum = e.target.position?.lineNumber;
        if (lineNum == null) return;
        const changes = folderDiffEditor!.getLineChanges();
        if (changes) {
          const change = changes.find(
            (c) =>
              (c.modifiedEndLineNumber > 0 &&
                c.modifiedStartLineNumber <= lineNum &&
                lineNum <= c.modifiedEndLineNumber) ||
              (c.modifiedEndLineNumber === 0 && c.modifiedStartLineNumber === lineNum)
          );
          if (change) this.mergeChangeLeft(change);
        }
      }
    });

    folderDiffEditor.onDidUpdateDiff(() => {
      this.updateMergeDecorations();
    });
  },

  queueRecompute(filepath: string, item: ComparisonItem): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      this.recomputeStatus(filepath, item);
    }, 500);
  },

  recomputeStatus(filepath: string, item: ComparisonItem): void {
    const textL = leftTextCache[filepath] ?? '';
    const textR = rightTextCache[filepath] ?? '';

    const originalL = originalLeftTextCache[filepath] ?? '';
    const originalR = originalRightTextCache[filepath] ?? '';

    // Check dirty state
    const isDirty = textL !== originalL || textR !== originalR;
    item.isDirty = isDirty;

    // Check status
    let newStatus: ComparisonItem['status'] = 'unchanged';
    if (textL !== textR) {
      if (textL === '') {
        newStatus = 'added';
      } else if (textR === '') {
        newStatus = 'deleted';
      } else {
        newStatus = 'modified';
      }
    }

    item.status = newStatus;

    // Update the filename header title if currently selected
    const headerTitle = document.querySelector<HTMLElement>('.folder-compare-pane .pane-header');
    if (headerTitle && activePath === filepath) {
      headerTitle.textContent = `${filepath}${isDirty ? ' (Unsaved Edits)' : ''}`;
    }

    // Refresh file list item display in UI
    this.updateFileItemInUI(filepath, item);
  },

  updateFileItemInUI(filepath: string, item: ComparisonItem): void {
    const fileItemEl = document.querySelector<HTMLElement>(`.file-item[data-path="${filepath}"]`);
    if (!fileItemEl) return;

    // Update dirty dot
    const leftDiv = fileItemEl.querySelector<HTMLElement>('.file-item-left');
    if (leftDiv) {
      const oldDot = leftDiv.querySelector('.file-item-dirty-dot');
      if (oldDot) oldDot.remove();

      if (item.isDirty) {
        const span = document.createElement('span');
        span.className = 'file-item-dirty-dot';
        span.title = 'Unsaved changes';
        span.textContent = '●';
        leftDiv.appendChild(span);
      }
    }

    // Update status badge
    const badge = fileItemEl.querySelector<HTMLElement>('.file-status-badge');
    if (badge) {
      badge.className = 'file-status-badge';
      if (item.status === 'modified') {
        badge.classList.add('badge-modified');
        badge.textContent = 'mod';
      } else if (item.status === 'added') {
        badge.classList.add('badge-added');
        badge.textContent = 'add';
      } else if (item.status === 'deleted') {
        badge.classList.add('badge-deleted');
        badge.textContent = 'del';
      } else {
        badge.classList.add('badge-unchanged');
        badge.textContent = 'same';
      }
    }
  },

  triggerLayout(): void {
    if (folderDiffEditor) {
      folderDiffEditor.layout();
    }
  },

  updateColorblindMode(_checked: boolean): void {
    this.applyTheme();
  },

  applyTheme(): void {
    if (!monacoInstance || !folderDiffEditor) return;
    const isColorblind = localStorage.getItem('colorblind_mode') === 'true';

    const themeSelect = document.getElementById('settings-editor-theme') as HTMLSelectElement | null;
    const currentBaseTheme = themeSelect?.value ?? 'vs-dark';

    let themeName = currentBaseTheme;
    if (isColorblind) {
      themeName = currentBaseTheme === 'vs-light' ? 'colorblind-light' : 'colorblind-dark';
    }

    monacoInstance.editor.setTheme(themeName);
  },

  clearAll(): void {
    filesLeft = {};
    filesRight = {};
    allPaths.clear();
    comparisonResults = [];

    // Clear caches
    leftTextCache = {};
    rightTextCache = {};
    originalLeftTextCache = {};
    originalRightTextCache = {};
    viewStates = {};
    activePath = '';
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (folderDiffEditor) {
      // Clear decorations
      folderOriginalDecorations = folderDiffEditor
        .getOriginalEditor()
        .deltaDecorations(folderOriginalDecorations, []);
      folderModifiedDecorations = folderDiffEditor
        .getModifiedEditor()
        .deltaDecorations(folderModifiedDecorations, []);
      folderDiffEditor.dispose();
      folderDiffEditor = null;
    }

    const placeholder = document.getElementById('folder-placeholder');
    const resultsLayout = document.getElementById('folder-results');

    if (placeholder) placeholder.classList.remove('hidden');
    if (resultsLayout) resultsLayout.classList.add('hidden');

    const labelLeft = document.getElementById('folder-label-left');
    const labelRight = document.getElementById('folder-label-right');
    if (labelLeft) labelLeft.textContent = 'Select Original Folder';
    if (labelRight) labelRight.textContent = 'Select Modified Folder';

    const inputLeft = document.getElementById('folder-input-left') as HTMLInputElement | null;
    const inputRight = document.getElementById('folder-input-right') as HTMLInputElement | null;
    if (inputLeft) inputLeft.value = '';
    if (inputRight) inputRight.value = '';
  },

  /**
   * Merge: push original block → into modified editor
   * BUG FIX: Uses monacoInstance.Range (not bare `monaco.Range`)
   */
  mergeChangeRight(change: ILineChange): void {
    if (!folderDiffEditor || !monacoInstance) return;
    const origModel = folderDiffEditor.getOriginalEditor().getModel();
    const modModel = folderDiffEditor.getModifiedEditor().getModel();
    if (!origModel || !modModel) return;

    let textToCopy = '';
    if (change.originalEndLineNumber > 0) {
      const startLine = change.originalStartLineNumber;
      const endLine = change.originalEndLineNumber;
      const maxCol = origModel.getLineMaxColumn(endLine);
      textToCopy = origModel.getValueInRange(
        new monacoInstance.Range(startLine, 1, endLine, maxCol)
      );
      if (change.modifiedEndLineNumber === 0) {
        textToCopy += '\n';
      }
    }

    let rangeToReplace: MonacoEditorType.Range;
    if (change.modifiedEndLineNumber === 0) {
      rangeToReplace = new monacoInstance.Range(
        change.modifiedStartLineNumber,
        1,
        change.modifiedStartLineNumber,
        1
      );
    } else {
      const startLine = change.modifiedStartLineNumber;
      const endLine = change.modifiedEndLineNumber;
      const maxCol = modModel.getLineMaxColumn(endLine);
      rangeToReplace = new monacoInstance.Range(startLine, 1, endLine, maxCol);
    }

    modModel.pushEditOperations([], [{ range: rangeToReplace, text: textToCopy }], () => null);
  },

  /**
   * Merge: pull modified block ← into original editor
   * BUG FIX: Uses monacoInstance.Range (not bare `monaco.Range`)
   */
  mergeChangeLeft(change: ILineChange): void {
    if (!folderDiffEditor || !monacoInstance) return;
    const origModel = folderDiffEditor.getOriginalEditor().getModel();
    const modModel = folderDiffEditor.getModifiedEditor().getModel();
    if (!origModel || !modModel) return;

    let textToCopy = '';
    if (change.modifiedEndLineNumber > 0) {
      const startLine = change.modifiedStartLineNumber;
      const endLine = change.modifiedEndLineNumber;
      const maxCol = modModel.getLineMaxColumn(endLine);
      textToCopy = modModel.getValueInRange(
        new monacoInstance.Range(startLine, 1, endLine, maxCol)
      );
      if (change.originalEndLineNumber === 0) {
        textToCopy += '\n';
      }
    }

    let rangeToReplace: MonacoEditorType.Range;
    if (change.originalEndLineNumber === 0) {
      rangeToReplace = new monacoInstance.Range(
        change.originalStartLineNumber,
        1,
        change.originalStartLineNumber,
        1
      );
    } else {
      const startLine = change.originalStartLineNumber;
      const endLine = change.originalEndLineNumber;
      const maxCol = origModel.getLineMaxColumn(endLine);
      rangeToReplace = new monacoInstance.Range(startLine, 1, endLine, maxCol);
    }

    origModel.pushEditOperations([], [{ range: rangeToReplace, text: textToCopy }], () => null);
  },

  /**
   * Updates glyph margin decorations for TWO-WAY merge — same dual-glyph fix as textDiff.
   * BUG FIX: Uses monacoInstance (not bare `monaco`)
   */
  updateMergeDecorations(): void {
    if (!folderDiffEditor || !monacoInstance) return;
    const originalEditor = folderDiffEditor.getOriginalEditor();
    const modifiedEditor = folderDiffEditor.getModifiedEditor();

    const changes = folderDiffEditor.getLineChanges();
    const newOriginalDecs: MonacoEditorType.editor.IModelDeltaDecoration[] = [];
    const newModifiedDecs: MonacoEditorType.editor.IModelDeltaDecoration[] = [];

    if (changes) {
      changes.forEach((change) => {
        // RIGHT ARROW on original side — always present for every change
        const origArrowLine = change.originalStartLineNumber;
        newOriginalDecs.push({
          range: new monacoInstance!.Range(origArrowLine, 1, origArrowLine, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: 'merge-glyph-right',
            glyphMarginHoverMessage: { value: 'Push this change → to the right (Modified)' },
          },
        });

        // LEFT ARROW on modified side — always present for every change
        const modArrowLine = change.modifiedStartLineNumber;
        newModifiedDecs.push({
          range: new monacoInstance!.Range(modArrowLine, 1, modArrowLine, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: 'merge-glyph-left',
            glyphMarginHoverMessage: { value: '← Pull this change to the left (Original)' },
          },
        });
      });
    }

    folderOriginalDecorations = originalEditor.deltaDecorations(
      folderOriginalDecorations,
      newOriginalDecs
    );
    folderModifiedDecorations = modifiedEditor.deltaDecorations(
      folderModifiedDecorations,
      newModifiedDecs
    );
  },
};
