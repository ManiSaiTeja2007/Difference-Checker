// PDF Comparison View Controller using pdfjs-dist
import * as pdfjsLib from 'pdfjs-dist';
import { TextDiffController } from './textDiff';

// Initialize PDFJS worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

let pdfLeftBuffer: ArrayBuffer | null = null;
let pdfRightBuffer: ArrayBuffer | null = null;
let nameLeft = 'Original.pdf';
let nameRight = 'Modified.pdf';

export const PdfDiffController = {
  init(): void {
    this.bindDOMEvents();
  },

  bindDOMEvents(): void {
    const clearBtn = document.getElementById('pdf-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearPDFs());
    }

    // Drag and Drop setups
    this.setupPdfUpload('pdf-upload-left', 'pdf-file-left', 'left');
    this.setupPdfUpload('pdf-upload-right', 'pdf-file-right', 'right');
  },

  setupPdfUpload(zoneId: string, inputId: string, side: 'left' | 'right'): void {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId) as HTMLInputElement | null;

    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());

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

      // Load comparison into Monaco Text Diff view
      TextDiffController.loadComparison(textLeft, textRight, nameLeft, nameRight, 'plaintext');

      // Switch active tab in the sidebar to 'text'
      const textTabButton = document.querySelector<HTMLButtonElement>('.nav-item[data-tab="text"]');
      if (textTabButton) {
        textTabButton.click();
      }
    } catch (err) {
      console.error('Failed to compare PDFs:', err);
      alert('Error parsing PDF files. Make sure they are not encrypted and contain text elements.');
      if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
      }
    }
  },

  async extractText(arrayBuffer: ArrayBuffer): Promise<string> {
    // Copy the buffer to prevent transfer issues
    const bufferCopy = arrayBuffer.slice(0);
    const loadingTask = pdfjsLib.getDocument({ data: bufferCopy });
    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      // Sort text segments by position to preserve reading order
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

  clearPDFs(): void {
    pdfLeftBuffer = null;
    pdfRightBuffer = null;
    nameLeft = 'Original.pdf';
    nameRight = 'Modified.pdf';

    const labelLeft = document.getElementById('pdf-label-left');
    const labelRight = document.getElementById('pdf-label-right');
    if (labelLeft) labelLeft.textContent = 'Original PDF File';
    if (labelRight) labelRight.textContent = 'Modified PDF File';

    // Clear file input values
    const fileLeft = document.getElementById('pdf-file-left') as HTMLInputElement | null;
    const fileRight = document.getElementById('pdf-file-right') as HTMLInputElement | null;
    if (fileLeft) fileLeft.value = '';
    if (fileRight) fileRight.value = '';
  },
};
