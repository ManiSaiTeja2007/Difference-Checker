// PDF Comparison View Controller using pdfjs-dist and Monaco Editor
import * as pdfjsLib from 'pdfjs-dist';
import loader from '@monaco-editor/loader';
import type * as MonacoEditorType from 'monaco-editor';
import { HistoryManager } from './history';

type Monaco = typeof MonacoEditorType;
type IStandaloneDiffEditor = MonacoEditorType.editor.IStandaloneDiffEditor;
type ITextModel = MonacoEditorType.editor.ITextModel;
type ILineChange = MonacoEditorType.editor.ILineChange;

// Initialize PDFJS worker using Vite's URL asset loader
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

let monacoInstance: Monaco | null = null;
let pdfDiffEditor: IStandaloneDiffEditor | null = null;
let originalModel: ITextModel | null = null;
let modifiedModel: ITextModel | null = null;
let originalDecorations: string[] = [];
let modifiedDecorations: string[] = [];

let pdfLeftBuffer: ArrayBuffer | null = null;
let pdfRightBuffer: ArrayBuffer | null = null;
let nameLeft = 'Original.pdf';
let nameRight = 'Modified.pdf';
let activePdfMode: 'text-diff' | 'visual-preview' = 'text-diff';

export const PdfDiffController = {
  async init(): Promise<void> {
    this.bindDOMEvents();
    this.bindScrollSync();
    // Pre-load Monaco
    monacoInstance = await loader.init() as unknown as Monaco;
  },

  bindDOMEvents(): void {
    const clearBtn = document.getElementById('pdf-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearPDFs());
    }

    const swapBtn = document.getElementById('pdf-swap');
    if (swapBtn) {
      swapBtn.addEventListener('click', () => this.swapPDFs());
    }

    const saveBtn = document.getElementById('pdf-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveToHistory());
    }

    const viewModeToggle = document.getElementById('pdf-view-mode') as HTMLInputElement | null;
    if (viewModeToggle) {
      viewModeToggle.addEventListener('change', (e) => {
        if (pdfDiffEditor) {
          pdfDiffEditor.updateOptions({
            renderSideBySide: (e.target as HTMLInputElement).checked,
          });
        }
      });
    }

    // PDF Mode Selector click events
    const btnTextDiff = document.getElementById('pdf-btn-text-diff');
    const btnVisualPreview = document.getElementById('pdf-btn-visual-preview');

    if (btnTextDiff && btnVisualPreview) {
      btnTextDiff.addEventListener('click', () => {
        this.switchMode('text-diff');
      });
      btnVisualPreview.addEventListener('click', () => {
        this.switchMode('visual-preview');
      });
    }

    // Drag and Drop setups
    this.setupPdfUpload('pdf-upload-left', 'pdf-file-left', 'left');
    this.setupPdfUpload('pdf-upload-right', 'pdf-file-right', 'right');
  },

  bindScrollSync(): void {
    let isSyncingScroll = false;
    const leftScroll = document.getElementById('pdf-preview-left-pages');
    const rightScroll = document.getElementById('pdf-preview-right-pages');

    if (leftScroll && rightScroll) {
      leftScroll.addEventListener('scroll', () => {
        if (!isSyncingScroll) {
          isSyncingScroll = true;
          rightScroll.scrollTop = leftScroll.scrollTop;
          isSyncingScroll = false;
        }
      });

      rightScroll.addEventListener('scroll', () => {
        if (!isSyncingScroll) {
          isSyncingScroll = true;
          leftScroll.scrollTop = rightScroll.scrollTop;
          isSyncingScroll = false;
        }
      });
    }
  },

  switchMode(mode: 'text-diff' | 'visual-preview'): void {
    activePdfMode = mode;

    const btnTextDiff = document.getElementById('pdf-btn-text-diff');
    const btnVisualPreview = document.getElementById('pdf-btn-visual-preview');
    const diffContainer = document.getElementById('pdf-monaco-diff-container');
    const previewContainer = document.getElementById('pdf-visual-preview-container');
    const viewModeWrapper = document.getElementById('pdf-view-mode-wrapper');

    if (mode === 'text-diff') {
      btnTextDiff?.classList.add('active');
      btnVisualPreview?.classList.remove('active');

      if (pdfLeftBuffer && pdfRightBuffer) {
        diffContainer?.classList.remove('hidden');
        viewModeWrapper?.classList.remove('hidden');
      }
      previewContainer?.classList.add('hidden');
    } else {
      btnVisualPreview?.classList.add('active');
      btnTextDiff?.classList.remove('active');

      diffContainer?.classList.add('hidden');
      viewModeWrapper?.classList.add('hidden');
      if (pdfLeftBuffer && pdfRightBuffer) {
        previewContainer?.classList.remove('hidden');
        this.renderVisualPages();
      }
    }
  },

  setupPdfUpload(zoneId: string, inputId: string, side: 'left' | 'right'): void {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId) as HTMLInputElement | null;

    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    input.addEventListener('click', (e) => e.stopPropagation());

    input.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        this.loadPDF(file, side);
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
      if (file && file.type === 'application/pdf') {
        this.loadPDF(file, side);
      }
    });
  },

  loadPDF(file: File, side: 'left' | 'right'): void {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const buffer = e.target?.result as ArrayBuffer;

      const label = document.getElementById(`pdf-label-${side}`);
      if (label) {
        label.textContent = file.name;
      }

      if (side === 'left') {
        pdfLeftBuffer = buffer;
        nameLeft = file.name;
      } else {
        pdfRightBuffer = buffer;
        nameRight = file.name;
      }

      // If both PDFs are uploaded, start extraction and comparison
      if (pdfLeftBuffer && pdfRightBuffer) {
        await this.runPDFComparison();
      }
    };
    reader.readAsArrayBuffer(file);
  },

  async runPDFComparison(): Promise<void> {
    const loadingOverlay = document.getElementById('pdf-loading');
    if (loadingOverlay) {
      loadingOverlay.classList.remove('hidden');
    }

    try {
      const textLeft = await this.extractText(pdfLeftBuffer!);
      const textRight = await this.extractText(pdfRightBuffer!);

      // Hide loading
      if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
      }

      const placeholder = document.getElementById('pdf-placeholder');
      const diffContainer = document.getElementById('pdf-monaco-diff-container');
      const previewContainer = document.getElementById('pdf-visual-preview-container');
      const viewModeWrapper = document.getElementById('pdf-view-mode-wrapper');

      if (placeholder) placeholder.classList.add('hidden');

      if (activePdfMode === 'text-diff') {
        if (diffContainer) diffContainer.classList.remove('hidden');
        if (viewModeWrapper) viewModeWrapper.classList.remove('hidden');
        if (previewContainer) previewContainer.classList.add('hidden');
      } else {
        if (diffContainer) diffContainer.classList.add('hidden');
        if (viewModeWrapper) viewModeWrapper.classList.add('hidden');
        if (previewContainer) previewContainer.classList.remove('hidden');
        await this.renderVisualPages();
      }

      if (!monacoInstance) {
        monacoInstance = await loader.init() as unknown as Monaco;
      }

      if (!pdfDiffEditor) {
        const viewModeToggle = document.getElementById('pdf-view-mode') as HTMLInputElement | null;

        pdfDiffEditor = monacoInstance.editor.createDiffEditor(diffContainer!, {
          originalEditable: true,
          renderSideBySide: viewModeToggle?.checked ?? true,
          automaticLayout: true,
          folding: true,
          glyphMargin: true,
          diffAlgorithm: 'advanced',
          showMoves: true,
          minimap: { enabled: false },
        } as any);

        this.applyTheme();

        const modifiedEditor = pdfDiffEditor.getModifiedEditor();
        const originalEditor = pdfDiffEditor.getOriginalEditor();

        // Hook mouse clicks on glyph margins for bidirectional merges
        originalEditor.onMouseDown((e) => {
          if (e.target.type === monacoInstance!.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
            const lineNum = e.target.position?.lineNumber;
            if (lineNum == null) return;
            const changes = pdfDiffEditor!.getLineChanges();
            if (changes) {
              const change = changes.find((c) => {
                const glyphLine = c.originalEndLineNumber > 0
                  ? c.originalStartLineNumber
                  : Math.max(1, c.originalStartLineNumber);
                return lineNum === glyphLine;
              });
              if (change) this.mergeChangeRight(change);
            }
          }
        });

        modifiedEditor.onMouseDown((e) => {
          if (e.target.type === monacoInstance!.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
            const lineNum = e.target.position?.lineNumber;
            if (lineNum == null) return;
            const changes = pdfDiffEditor!.getLineChanges();
            if (changes) {
              const change = changes.find((c) => {
                const glyphLine = c.modifiedEndLineNumber > 0
                  ? c.modifiedStartLineNumber
                  : Math.max(1, c.modifiedStartLineNumber);
                return lineNum === glyphLine;
              });
              if (change) this.mergeChangeLeft(change);
            }
          }
        });

        pdfDiffEditor.onDidUpdateDiff(() => {
          this.updateMergeDecorations();
        });
      }

      this.updateEditorModels(textLeft, textRight);
    } catch (err) {
      console.error('Failed to compare PDFs:', err);
      alert('Error parsing PDF files. Make sure they are not encrypted and contain text elements.');
      if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
      }
    }
  },

  async renderVisualPages(): Promise<void> {
    const leftScroll = document.getElementById('pdf-preview-left-pages');
    const rightScroll = document.getElementById('pdf-preview-right-pages');

    if (!leftScroll || !rightScroll) return;

    leftScroll.innerHTML = '';
    rightScroll.innerHTML = '';

    if (pdfLeftBuffer) {
      await this.renderPdfToContainer(pdfLeftBuffer, leftScroll);
    }
    if (pdfRightBuffer) {
      await this.renderPdfToContainer(pdfRightBuffer, rightScroll);
    }
  },

  async renderPdfToContainer(buffer: ArrayBuffer, container: HTMLElement): Promise<void> {
    try {
      const bufferCopy = buffer.slice(0);
      const loadingTask = pdfjsLib.getDocument({ data: bufferCopy });
      const pdf = await loadingTask.promise;

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });

        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        container.appendChild(canvas);

        const context = canvas.getContext('2d');
        if (context) {
          await page.render({
            canvasContext: context,
            viewport: viewport,
            canvas: canvas
          } as any).promise;
        }
      }
    } catch (e) {
      console.error('Failed to render PDF page:', e);
      container.innerHTML = `<div class="select-file-msg"><p>Error rendering visual page preview</p></div>`;
    }
  },

  updateEditorModels(originalText: string, modifiedText: string): void {
    if (!monacoInstance || !pdfDiffEditor) return;

    if (originalModel) originalModel.dispose();
    if (modifiedModel) modifiedModel.dispose();

    originalModel = monacoInstance.editor.createModel(originalText, 'plaintext');
    modifiedModel = monacoInstance.editor.createModel(modifiedText, 'plaintext');

    pdfDiffEditor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });
  },

  async extractText(arrayBuffer: ArrayBuffer): Promise<string> {
    const bufferCopy = arrayBuffer.slice(0);
    const loadingTask = pdfjsLib.getDocument({ data: bufferCopy });
    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      const items = (textContent.items as Array<{ str: string; transform: number[] }>).sort(
        (a, b) => {
          const yA = a.transform[5];
          const yB = b.transform[5];
          if (Math.abs(yA - yB) > 4) {
            return yB - yA;
          }
          return a.transform[4] - b.transform[4];
        }
      );

      let pageText = '';
      let lastY = -1;

      for (const item of items) {
        const y = item.transform[5];
        if (lastY !== -1 && Math.abs(y - lastY) > 4) {
          pageText += '\n';
        } else if (lastY !== -1) {
          pageText += ' ';
        }
        pageText += item.str;
        lastY = y;
      }

      fullText += `=== PAGE ${i} ===\n${pageText}\n\n`;
    }

    return fullText.trim();
  },

  triggerLayout(): void {
    if (pdfDiffEditor) {
      pdfDiffEditor.layout();
    }
  },

  applyTheme(): void {
    if (!monacoInstance || !pdfDiffEditor) return;
    const isColorblind = localStorage.getItem('colorblind_mode') === 'true';
    const themeSelect = document.getElementById('settings-editor-theme') as HTMLSelectElement | null;
    const currentBaseTheme = themeSelect?.value ?? 'vs-dark';

    let themeName = currentBaseTheme;
    if (isColorblind) {
      themeName = currentBaseTheme === 'vs-light' ? 'colorblind-light' : 'colorblind-dark';
    }
    monacoInstance.editor.setTheme(themeName);
  },

  swapPDFs(): void {
    // Swap buffers
    const tempBuffer = pdfLeftBuffer;
    pdfLeftBuffer = pdfRightBuffer;
    pdfRightBuffer = tempBuffer;

    // Swap names
    const tempName = nameLeft;
    nameLeft = nameRight;
    nameRight = tempName;

    // Update labels in UI
    const labelLeft = document.getElementById('pdf-label-left');
    const labelRight = document.getElementById('pdf-label-right');
    if (labelLeft) labelLeft.textContent = pdfLeftBuffer ? nameLeft : 'Original PDF File';
    if (labelRight) labelRight.textContent = pdfRightBuffer ? nameRight : 'Modified PDF File';

    // If active, reload editors/previews
    if (pdfLeftBuffer && pdfRightBuffer) {
      if (activePdfMode === 'visual-preview') {
        this.renderVisualPages();
      }
      this.runPDFComparison();
    }
  },

  clearPDFs(): void {
    pdfLeftBuffer = null;
    pdfRightBuffer = null;
    nameLeft = 'Original.pdf';
    nameRight = 'Modified.pdf';

    const labelLeft = document.getElementById('pdf-label-left');
    const labelRight = document.getElementById('pdf-label-right');
    if (labelLeft) labelLeft.textContent = 'Original PDF File';
    if (labelRight) labelRight.textContent = 'Modified PDF File';

    const fileLeft = document.getElementById('pdf-file-left') as HTMLInputElement | null;
    const fileRight = document.getElementById('pdf-file-right') as HTMLInputElement | null;
    if (fileLeft) fileLeft.value = '';
    if (fileRight) fileRight.value = '';

    const placeholder = document.getElementById('pdf-placeholder');
    const diffContainer = document.getElementById('pdf-monaco-diff-container');
    const previewContainer = document.getElementById('pdf-visual-preview-container');
    const viewModeWrapper = document.getElementById('pdf-view-mode-wrapper');

    if (placeholder) placeholder.classList.remove('hidden');
    if (diffContainer) diffContainer.classList.add('hidden');
    if (previewContainer) previewContainer.classList.add('hidden');
    if (viewModeWrapper) viewModeWrapper.classList.remove('hidden');

    // Reset modes buttons to text diff
    activePdfMode = 'text-diff';
    document.getElementById('pdf-btn-text-diff')?.classList.add('active');
    document.getElementById('pdf-btn-visual-preview')?.classList.remove('active');

    const leftScroll = document.getElementById('pdf-preview-left-pages');
    const rightScroll = document.getElementById('pdf-preview-right-pages');
    if (leftScroll) leftScroll.innerHTML = '';
    if (rightScroll) rightScroll.innerHTML = '';

    if (originalModel) originalModel.setValue('');
    if (modifiedModel) modifiedModel.setValue('');

    if (pdfDiffEditor) {
      originalDecorations = pdfDiffEditor
        .getOriginalEditor()
        .deltaDecorations(originalDecorations, []);
      modifiedDecorations = pdfDiffEditor
        .getModifiedEditor()
        .deltaDecorations(modifiedDecorations, []);
    }
  },

  loadComparison(contentLeft: string, contentRight: string, labelL: string, labelR: string): void {
    nameLeft = labelL || 'Original.pdf';
    nameRight = labelR || 'Modified.pdf';

    const labelLeft = document.getElementById('pdf-label-left');
    const labelRight = document.getElementById('pdf-label-right');
    if (labelLeft) labelLeft.textContent = nameLeft;
    if (labelRight) labelRight.textContent = nameRight;

    // Fake buffer setup so swap actions work
    pdfLeftBuffer = new ArrayBuffer(0);
    pdfRightBuffer = new ArrayBuffer(0);

    // Reset modes buttons to text diff
    activePdfMode = 'text-diff';
    document.getElementById('pdf-btn-text-diff')?.classList.add('active');
    document.getElementById('pdf-btn-visual-preview')?.classList.remove('active');

    const leftScroll = document.getElementById('pdf-preview-left-pages');
    const rightScroll = document.getElementById('pdf-preview-right-pages');
    if (leftScroll) leftScroll.innerHTML = '';
    if (rightScroll) rightScroll.innerHTML = '';

    const placeholder = document.getElementById('pdf-placeholder');
    const diffContainer = document.getElementById('pdf-monaco-diff-container');
    const previewContainer = document.getElementById('pdf-visual-preview-container');
    const viewModeWrapper = document.getElementById('pdf-view-mode-wrapper');

    if (placeholder) placeholder.classList.add('hidden');
    if (diffContainer) diffContainer.classList.remove('hidden');
    if (previewContainer) previewContainer.classList.add('hidden');
    if (viewModeWrapper) viewModeWrapper.classList.remove('hidden');

    if (!pdfDiffEditor && monacoInstance) {
      const viewModeToggle = document.getElementById('pdf-view-mode') as HTMLInputElement | null;
      pdfDiffEditor = monacoInstance.editor.createDiffEditor(diffContainer!, {
        originalEditable: true,
        renderSideBySide: viewModeToggle?.checked ?? true,
        automaticLayout: true,
        folding: true,
        glyphMargin: true,
        diffAlgorithm: 'advanced',
        showMoves: true,
        minimap: { enabled: false },
      } as any);

      this.applyTheme();

      const modifiedEditor = pdfDiffEditor.getModifiedEditor();
      const originalEditor = pdfDiffEditor.getOriginalEditor();

      originalEditor.onMouseDown((e) => {
        if (e.target.type === monacoInstance!.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          const lineNum = e.target.position?.lineNumber;
          if (lineNum == null) return;
          const changes = pdfDiffEditor!.getLineChanges();
          if (changes) {
            const change = changes.find((c) => {
              const glyphLine = c.originalEndLineNumber > 0
                ? c.originalStartLineNumber
                : Math.max(1, c.originalStartLineNumber);
              return lineNum === glyphLine;
            });
            if (change) this.mergeChangeRight(change);
          }
        }
      });

      modifiedEditor.onMouseDown((e) => {
        if (e.target.type === monacoInstance!.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          const lineNum = e.target.position?.lineNumber;
          if (lineNum == null) return;
          const changes = pdfDiffEditor!.getLineChanges();
          if (changes) {
            const change = changes.find((c) => {
              const glyphLine = c.modifiedEndLineNumber > 0
                ? c.modifiedStartLineNumber
                : Math.max(1, c.modifiedStartLineNumber);
              return lineNum === glyphLine;
            });
            if (change) this.mergeChangeLeft(change);
          }
        }
      });

      pdfDiffEditor.onDidUpdateDiff(() => {
        this.updateMergeDecorations();
      });
    }

    this.updateEditorModels(contentLeft, contentRight);
  },

  saveToHistory(): void {
    if (!originalModel || !modifiedModel) {
      alert('Nothing to save! Please extract some PDFs first.');
      return;
    }

    const leftText = originalModel.getValue();
    const rightText = modifiedModel.getValue();

    const entry = HistoryManager.saveComparison({
      type: 'pdf',
      labelLeft: nameLeft,
      labelRight: nameRight,
      contentLeft: leftText,
      contentRight: rightText,
    });

    if (entry) {
      alert('PDF diff successfully saved to local history.');
    }
  },

  mergeChangeRight(change: ILineChange): void {
    if (!pdfDiffEditor || !monacoInstance) return;
    const origModel = pdfDiffEditor.getOriginalEditor().getModel();
    const modModel = pdfDiffEditor.getModifiedEditor().getModel();
    if (!origModel || !modModel) return;

    const textL = getLinesText(origModel, change.originalStartLineNumber, change.originalEndLineNumber);
    replaceLines(modModel, change.modifiedStartLineNumber, change.modifiedEndLineNumber, textL);
  },

  mergeChangeLeft(change: ILineChange): void {
    if (!pdfDiffEditor || !monacoInstance) return;
    const origModel = pdfDiffEditor.getOriginalEditor().getModel();
    const modModel = pdfDiffEditor.getModifiedEditor().getModel();
    if (!origModel || !modModel) return;

    const textR = getLinesText(modModel, change.modifiedStartLineNumber, change.modifiedEndLineNumber);
    replaceLines(origModel, change.originalStartLineNumber, change.originalEndLineNumber, textR);
  },

  updateMergeDecorations(): void {
    if (!pdfDiffEditor || !monacoInstance) return;
    const originalEditor = pdfDiffEditor.getOriginalEditor();
    const modifiedEditor = pdfDiffEditor.getModifiedEditor();

    const changes = pdfDiffEditor.getLineChanges();
    const newOriginalDecs: MonacoEditorType.editor.IModelDeltaDecoration[] = [];
    const newModifiedDecs: MonacoEditorType.editor.IModelDeltaDecoration[] = [];

    if (changes) {
      changes.forEach((change) => {
        const origArrowLine = change.originalEndLineNumber > 0
          ? change.originalStartLineNumber
          : Math.max(1, change.originalStartLineNumber);
        newOriginalDecs.push({
          range: new monacoInstance!.Range(origArrowLine, 1, origArrowLine, 1),
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
          range: new monacoInstance!.Range(modArrowLine, 1, modArrowLine, 1),
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

function getLinesText(model: MonacoEditorType.editor.ITextModel, startLine: number, endLine: number): string {
  if (endLine === 0) return '';
  const maxCol = model.getLineMaxColumn(endLine);
  return model.getValueInRange(new monacoInstance!.Range(startLine, 1, endLine, maxCol));
}

function replaceLines(model: MonacoEditorType.editor.ITextModel, startLine: number, endLine: number, newText: string): void {
  const lineCount = model.getLineCount();

  if (endLine === 0) {
    if (newText === '') return;

    if (startLine === 0) {
      if (lineCount === 1 && model.getLineContent(1) === '') {
        model.pushEditOperations([], [{
          range: new monacoInstance!.Range(1, 1, 1, 1),
          text: newText
        }], () => null);
      } else {
        model.pushEditOperations([], [{
          range: new monacoInstance!.Range(1, 1, 1, 1),
          text: newText.endsWith('\n') ? newText : newText + '\n'
        }], () => null);
      }
    } else {
      const maxCol = model.getLineMaxColumn(startLine);
      model.pushEditOperations([], [{
        range: new monacoInstance!.Range(startLine, maxCol, startLine, maxCol),
        text: newText.startsWith('\n') ? newText : '\n' + newText
      }], () => null);
    }
  } else {
    if (newText === '') {
      if (endLine < lineCount) {
        model.pushEditOperations([], [{
          range: new monacoInstance!.Range(startLine, 1, endLine + 1, 1),
          text: ''
        }], () => null);
      } else if (startLine > 1) {
        const prevMaxCol = model.getLineMaxColumn(startLine - 1);
        model.pushEditOperations([], [{
          range: new monacoInstance!.Range(startLine - 1, prevMaxCol, endLine, model.getLineMaxColumn(endLine)),
          text: ''
        }], () => null);
      } else {
        model.pushEditOperations([], [{
          range: new monacoInstance!.Range(1, 1, lineCount, model.getLineMaxColumn(lineCount)),
          text: ''
        }], () => null);
      }
    } else {
      const maxCol = model.getLineMaxColumn(endLine);
      model.pushEditOperations([], [{
        range: new monacoInstance!.Range(startLine, 1, endLine, maxCol),
        text: newText
      }], () => null);
    }
  }
}
