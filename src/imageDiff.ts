// Image Comparison View Controller

let imgOriginal: HTMLImageElement | null = null;
let imgModified: HTMLImageElement | null = null;
let activeMode = 'side-by-side'; // side-by-side, slider, blend, diff
let isDraggingSlider = false;

export const ImageDiffController = {
  init(): void {
    this.bindDOMEvents();
  },

  bindDOMEvents(): void {
    // Mode Switcher
    const modeSelector = document.getElementById('image-mode-selector');
    if (modeSelector) {
      const modeButtons = modeSelector.querySelectorAll<HTMLButtonElement>('button');
      modeButtons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          modeButtons.forEach((b) => b.classList.remove('active'));
          const target = e.currentTarget as HTMLButtonElement;
          target.classList.add('active');
          const mode = target.getAttribute('data-mode');
          if (mode) this.switchMode(mode);
        });
      });
    }

    const clearBtn = document.getElementById('image-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearImages());
    }

    // Blend slider input
    const blendSlider = document.getElementById('blend-slider') as HTMLInputElement | null;
    if (blendSlider) {
      blendSlider.addEventListener('input', (e) => {
        const opacity = (e.target as HTMLInputElement).value;
        const frontImg = document.getElementById('img-blend-front') as HTMLImageElement | null;
        if (frontImg) {
          frontImg.style.opacity = opacity;
        }
      });
    }

    // Setup drag handling for the slider mode
    this.setupSliderDrag();

    // Setup drag and drop for original and modified images
    this.setupImageUpload('img-dropzone-left', 'image-input-left', 'preview-img-left', 'left');
    this.setupImageUpload('img-dropzone-right', 'image-input-right', 'preview-img-right', 'right');
  },

  setupImageUpload(zoneId: string, inputId: string, previewId: string, side: 'left' | 'right'): void {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const preview = document.getElementById(previewId) as HTMLImageElement | null;

    if (!zone || !input || !preview) return;

    zone.addEventListener('click', () => input.click());

    input.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        this.loadImage(file, preview, side);
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
      if (file && file.type.startsWith('image/')) {
        this.loadImage(file, preview, side);
      }
    });
  },

  loadImage(file: File, previewImg: HTMLImageElement, side: 'left' | 'right'): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      previewImg.src = base64;
      previewImg.classList.remove('hidden');

      const zone = document.getElementById(`img-dropzone-${side}`);
      if (zone) {
        const content = zone.querySelector('.dropzone-content');
        if (content) content.classList.add('hidden');
      }

      if (side === 'left') {
        imgOriginal = new Image();
        imgOriginal.src = base64;
      } else {
        imgModified = new Image();
        imgModified.src = base64;
      }

      // Check if both are loaded to display comparisons
      if (imgOriginal && imgModified) {
        this.setupViewports();
      }
    };
    reader.readAsDataURL(file);
  },

  setupViewports(): void {
    if (!imgOriginal || !imgModified) return;
    const originalSrc = imgOriginal.src;
    const modifiedSrc = imgModified.src;

    // Show viewports container
    const viewports = document.getElementById('image-viewports');
    if (viewports) viewports.classList.remove('hidden');

    // Load sources to all views
    (document.getElementById('img-side-left') as HTMLImageElement).src = originalSrc;
    (document.getElementById('img-side-right') as HTMLImageElement).src = modifiedSrc;

    (document.getElementById('img-slider-back') as HTMLImageElement).src = originalSrc;
    (document.getElementById('img-slider-front') as HTMLImageElement).src = modifiedSrc;

    (document.getElementById('img-blend-back') as HTMLImageElement).src = originalSrc;
    (document.getElementById('img-blend-front') as HTMLImageElement).src = modifiedSrc;

    // Wait until images are rendered to size front image correctly in slider mode
    const sliderBack = document.getElementById('img-slider-back') as HTMLImageElement;
    sliderBack.onload = () => {
      this.syncSliderDimensions();
    };

    // Calculate canvas pixel diff
    this.calculatePixelDiff();

    // Auto switch to side-by-side or current active mode
    this.switchMode(activeMode);
  },

  syncSliderDimensions(): void {
    const sliderBack = document.getElementById('img-slider-back') as HTMLImageElement | null;
    const sliderFront = document.getElementById('img-slider-front') as HTMLImageElement | null;
    const frontWrap = document.getElementById('slider-front-wrap') as HTMLElement | null;
    const handle = document.getElementById('slider-drag-handle') as HTMLElement | null;

    if (!sliderBack || !sliderFront || !frontWrap || !handle) return;

    // Wait for a frame to ensure dimensions are ready
    requestAnimationFrame(() => {
      const w = sliderBack.clientWidth;
      const h = sliderBack.clientHeight;

      if (w > 0 && h > 0) {
        sliderFront.style.width = w + 'px';
        sliderFront.style.height = h + 'px';

        // Reset split to 50%
        frontWrap.style.width = '50%';
        handle.style.left = '50%';
      }
    });
  },

  setupSliderDrag(): void {
    const handle = document.getElementById('slider-drag-handle');
    const container = document.querySelector<HTMLElement>('.slider-container');
    const frontWrap = document.getElementById('slider-front-wrap') as HTMLElement | null;

    if (!handle || !container || !frontWrap) return;

    const startDrag = () => {
      isDraggingSlider = true;
      document.body.style.cursor = 'ew-resize';
    };

    const drag = (e: MouseEvent | TouchEvent) => {
      if (!isDraggingSlider) return;

      const rect = container.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;

      let positionX = clientX - rect.left;
      let percentage = (positionX / rect.width) * 100;

      // Clamp percentage
      percentage = Math.max(0, Math.min(100, percentage));

      handle.style.left = percentage + '%';
      frontWrap.style.width = percentage + '%';
    };

    const endDrag = () => {
      if (isDraggingSlider) {
        isDraggingSlider = false;
        document.body.style.cursor = '';
      }
    };

    handle.addEventListener('mousedown', startDrag);
    handle.addEventListener('touchstart', startDrag, { passive: true });

    window.addEventListener('mousemove', drag);
    window.addEventListener('touchmove', drag as EventListener, { passive: false });

    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchend', endDrag);
  },

  calculatePixelDiff(): void {
    if (!imgOriginal || !imgModified) return;

    const canvas = document.getElementById('img-diff-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set size to maximum bounding size
    const w = Math.max(imgOriginal.naturalWidth, imgModified.naturalWidth);
    const h = Math.max(imgOriginal.naturalHeight, imgModified.naturalHeight);

    canvas.width = w;
    canvas.height = h;

    // Draw Original
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(imgOriginal, 0, 0);
    const dataOrig = ctx.getImageData(0, 0, w, h);

    // Draw Modified
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(imgModified, 0, 0);
    const dataMod = ctx.getImageData(0, 0, w, h);

    // Prepare Output
    const dataDiff = ctx.createImageData(w, h);
    const dO = dataOrig.data;
    const dM = dataMod.data;
    const dD = dataDiff.data;

    const len = w * h * 4;
    for (let i = 0; i < len; i += 4) {
      const rDiff = Math.abs(dO[i] - dM[i]);
      const gDiff = Math.abs(dO[i + 1] - dM[i + 1]);
      const bDiff = Math.abs(dO[i + 2] - dM[i + 2]);
      const aDiff = Math.abs(dO[i + 3] - dM[i + 3]);

      if (rDiff > 5 || gDiff > 5 || bDiff > 5 || aDiff > 5) {
        // Pixel mismatch -> Hot pink highlight
        dD[i] = 255;
        dD[i + 1] = 0;
        dD[i + 2] = 127;
        dD[i + 3] = 255;
      } else {
        // Pixel matches -> Draw dimmed grayscale version of the original image
        const gray = 0.299 * dO[i] + 0.587 * dO[i + 1] + 0.114 * dO[i + 2];
        dD[i] = gray;
        dD[i + 1] = gray;
        dD[i + 2] = gray;
        dD[i + 3] = Math.max(30, dO[i + 3] * 0.15);
      }
    }

    ctx.putImageData(dataDiff, 0, 0);
  },

  switchMode(mode: string): void {
    activeMode = mode;

    // Hide all viewports
    document.getElementById('viewport-side')?.classList.add('hidden');
    document.getElementById('viewport-slide-overlay')?.classList.add('hidden');
    document.getElementById('viewport-blend-overlay')?.classList.add('hidden');
    document.getElementById('viewport-diff-canvas')?.classList.add('hidden');

    if (!imgOriginal || !imgModified) return;

    if (mode === 'side-by-side') {
      document.getElementById('viewport-side')?.classList.remove('hidden');
    } else if (mode === 'slider') {
      document.getElementById('viewport-slide-overlay')?.classList.remove('hidden');
      this.syncSliderDimensions();
    } else if (mode === 'blend') {
      document.getElementById('viewport-blend-overlay')?.classList.remove('hidden');
    } else if (mode === 'diff') {
      document.getElementById('viewport-diff-canvas')?.classList.remove('hidden');
    }
  },

  clearImages(): void {
    imgOriginal = null;
    imgModified = null;

    // Hide previews and reset zones
    const previewLeft = document.getElementById('preview-img-left') as HTMLImageElement | null;
    const previewRight = document.getElementById('preview-img-right') as HTMLImageElement | null;
    if (previewLeft) {
      previewLeft.classList.add('hidden');
      previewLeft.removeAttribute('src');
    }
    if (previewRight) {
      previewRight.classList.add('hidden');
      previewRight.removeAttribute('src');
    }

    document.querySelector('#img-dropzone-left .dropzone-content')?.classList.remove('hidden');
    document.querySelector('#img-dropzone-right .dropzone-content')?.classList.remove('hidden');

    document.getElementById('image-viewports')?.classList.add('hidden');

    // Clear file input values
    const inputLeft = document.getElementById('image-input-left') as HTMLInputElement | null;
    const inputRight = document.getElementById('image-input-right') as HTMLInputElement | null;
    if (inputLeft) inputLeft.value = '';
    if (inputRight) inputRight.value = '';
  },
};
