// Antigravity DiffChecker Bootstrap & App Controller
import './style.css';
import { TextDiffController } from './textDiff';
import { ImageDiffController } from './imageDiff';
import { PdfDiffController } from './pdfDiff';
import { FolderDiffController } from './folderDiff';
import { HistoryManager } from './history';
import type { HistoryEntry } from './history';

// App state
let currentTab = 'text';

const App = {
  async init(): Promise<void> {
    // Restore sidebar state
    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    if (isCollapsed) {
      const sidebar = document.querySelector<HTMLElement>('.sidebar');
      if (sidebar) sidebar.classList.add('collapsed');
    }

    // Initialize view controllers
    await TextDiffController.init({
      theme: 'vs-dark',
      wordWrap: 'on',
      minimap: true,
      ignoreTrimWhitespace: true,
    });

    ImageDiffController.init();
    PdfDiffController.init();
    await FolderDiffController.init();

    // Bind SPA navigation
    this.bindNavigation();

    // Bind sidebar collapse toggle
    this.bindSidebarToggle();

    // Bind settings panel events
    this.bindSettings();

    // Bind history actions
    this.bindHistoryEvents();
  },

  bindSidebarToggle(): void {
    const toggleBtn = document.getElementById('sidebar-toggle');
    const sidebar = document.querySelector<HTMLElement>('.sidebar');

    if (toggleBtn && sidebar) {
      toggleBtn.addEventListener('click', () => {
        const collapsed = sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebar_collapsed', collapsed ? 'true' : 'false');

        // Trigger Monaco resizing after CSS transitions complete (200ms)
        setTimeout(() => {
          TextDiffController.triggerLayout();
          FolderDiffController.triggerLayout();
          PdfDiffController.triggerLayout();
        }, 210);
      });
    }
  },

  bindNavigation(): void {
    const navItems = document.querySelectorAll<HTMLButtonElement>('.nav-item[data-tab]');
    navItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.nav-item');
        if (!btn) return;

        const tab = btn.getAttribute('data-tab');
        if (tab) this.switchTab(tab);
      });
    });
  },

  switchTab(tabId: string): void {
    currentTab = tabId;

    // Update active nav item
    const navItems = document.querySelectorAll<HTMLButtonElement>('.nav-item[data-tab]');
    navItems.forEach((item) => {
      if (item.getAttribute('data-tab') === tabId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update active panel
    const panels = document.querySelectorAll('.panel');
    panels.forEach((panel) => {
      if (panel.id === `panel-${tabId}`) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });

    // Run tab-specific entry hooks
    if (tabId === 'history') {
      this.renderHistory();
    }
  },

  bindSettings(): void {
    const themeSelect = document.getElementById('settings-editor-theme') as HTMLSelectElement | null;
    const wrapCheck = document.getElementById('settings-line-wrap') as HTMLInputElement | null;
    const minimapCheck = document.getElementById('settings-minimap') as HTMLInputElement | null;
    const whitespaceCheck = document.getElementById('settings-ignore-whitespace') as HTMLInputElement | null;

    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => {
        const theme = (e.target as HTMLSelectElement).value;
        if (theme === 'vs-light') {
          document.body.classList.remove('dark-theme');
          document.body.classList.add('light-theme');
        } else {
          document.body.classList.remove('light-theme');
          document.body.classList.add('dark-theme');
        }

        TextDiffController.updateSettings({ theme });
      });
    }

    if (wrapCheck) {
      wrapCheck.addEventListener('change', (e) => {
        TextDiffController.updateSettings({
          wordWrap: (e.target as HTMLInputElement).checked ? 'on' : 'off',
        });
      });
    }

    if (minimapCheck) {
      minimapCheck.addEventListener('change', (e) => {
        TextDiffController.updateSettings({ minimap: (e.target as HTMLInputElement).checked });
      });
    }

    if (whitespaceCheck) {
      whitespaceCheck.addEventListener('change', (e) => {
        TextDiffController.updateSettings({
          ignoreTrimWhitespace: (e.target as HTMLInputElement).checked,
        });
      });
    }

    const colorblindCheck = document.getElementById('settings-colorblind') as HTMLInputElement | null;
    if (colorblindCheck) {
      // Restore state
      const isColorblind = localStorage.getItem('colorblind_mode') === 'true';
      colorblindCheck.checked = isColorblind;
      if (isColorblind) {
        document.body.classList.add('colorblind-theme');
      }

      colorblindCheck.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        localStorage.setItem('colorblind_mode', checked ? 'true' : 'false');
        if (checked) {
          document.body.classList.add('colorblind-theme');
        } else {
          document.body.classList.remove('colorblind-theme');
        }
        TextDiffController.updateColorblindMode(checked);
        FolderDiffController.updateColorblindMode(checked);
      });
    }
  },

  bindHistoryEvents(): void {
    const clearAllBtn = document.getElementById('history-clear-all');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all saved comparisons?')) {
          HistoryManager.clearAll();
          this.renderHistory();
        }
      });
    }
  },

  renderHistory(): void {
    const historyList = document.getElementById('history-list-container');
    if (!historyList) return;

    const items = HistoryManager.getHistory();

    if (items.length === 0) {
      historyList.innerHTML = `
        <div class="placeholder-box">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
          <h3>No History Saved</h3>
          <p>Perform a text comparison and click "Save Diff" in the top bar to save comparisons here.</p>
        </div>
      `;
      return;
    }

    historyList.innerHTML = ''; // clear

    items.forEach((item: HistoryEntry) => {
      const card = document.createElement('div');
      card.className = 'history-card';

      const formattedDate = new Date(item.timestamp).toLocaleString();
      const typeBadge = `<span class="history-type-badge">${item.type.toUpperCase()}</span>`;

      card.innerHTML = `
        <div class="history-meta">
          <div class="history-title-row">
            <span class="history-name">${item.labelLeft} ↔ ${item.labelRight}</span>
            ${typeBadge}
          </div>
          <span class="history-date">${formattedDate}</span>
        </div>
        <div class="history-actions">
          <button class="btn btn-secondary btn-restore" data-id="${item.id}">Restore</button>
          <button class="btn btn-danger btn-delete" data-id="${item.id}">Delete</button>
        </div>
      `;

      // Restore action
      card.querySelector('.btn-restore')?.addEventListener('click', () => {
        this.restoreHistoryItem(item);
      });

      // Delete action
      card.querySelector('.btn-delete')?.addEventListener('click', (e) => {
        const id = (e.target as HTMLButtonElement).getAttribute('data-id');
        if (id) {
          HistoryManager.deleteItem(id);
          this.renderHistory();
        }
      });

      historyList.appendChild(card);
    });
  },

  restoreHistoryItem(item: HistoryEntry): void {
    if (item.type === 'text') {
      // Re-route to Text tab
      this.switchTab('text');
      // Load content
      TextDiffController.loadComparison(
        item.contentLeft,
        item.contentRight,
        item.labelLeft,
        item.labelRight
      );
    } else if (item.type === 'pdf') {
      // Re-route to PDF tab
      this.switchTab('pdf');
      // Load content
      PdfDiffController.loadComparison(
        item.contentLeft,
        item.contentRight,
        item.labelLeft,
        item.labelRight
      );
    }
  },
};

// Bootstrap application on page load
window.addEventListener('DOMContentLoaded', () => {
  App.init().catch((err: unknown) => {
    console.error('Failed to initialize app:', err);
  });
});
