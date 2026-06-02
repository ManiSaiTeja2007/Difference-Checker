// Local History Manager for Antigravity DiffChecker

export type DiffType = 'text' | 'pdf' | 'image';

export interface HistoryEntry {
  id: string;
  timestamp: string;
  type: DiffType;
  labelLeft: string;
  labelRight: string;
  contentLeft: string;
  contentRight: string;
}

const HISTORY_KEY = 'antigravity_diff_history';

export const HistoryManager = {
  getHistory(): HistoryEntry[] {
    try {
      const data = localStorage.getItem(HISTORY_KEY);
      return data ? (JSON.parse(data) as HistoryEntry[]) : [];
    } catch (e) {
      console.error('Failed to load history from localStorage', e);
      return [];
    }
  },

  saveComparison(entry: {
    type: DiffType;
    labelLeft: string;
    labelRight: string;
    contentLeft: string;
    contentRight: string;
  }): HistoryEntry | null {
    try {
      const history = this.getHistory();

      const newEntry: HistoryEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        timestamp: new Date().toISOString(),
        type: entry.type,
        labelLeft: entry.labelLeft || 'Original',
        labelRight: entry.labelRight || 'Modified',
        contentLeft:
          entry.contentLeft.length > 500000
            ? entry.contentLeft.slice(0, 500000) + '\n[Truncated due to size]'
            : entry.contentLeft,
        contentRight:
          entry.contentRight.length > 500000
            ? entry.contentRight.slice(0, 500000) + '\n[Truncated due to size]'
            : entry.contentRight,
      };

      history.unshift(newEntry);
      const trimmedHistory = history.slice(0, 30);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmedHistory));
      return newEntry;
    } catch (e) {
      console.warn('Failed to save comparison to history (storage full?)', e);
      return null;
    }
  },

  deleteItem(id: string): boolean {
    try {
      const history = this.getHistory();
      const updated = history.filter((item) => item.id !== id);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      return true;
    } catch (e) {
      console.error('Failed to delete history item', e);
      return false;
    }
  },

  clearAll(): boolean {
    try {
      localStorage.removeItem(HISTORY_KEY);
      return true;
    } catch (e) {
      console.error('Failed to clear history', e);
      return false;
    }
  },
};
