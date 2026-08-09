import { create } from 'zustand';
import { codehubApi, type CodeHubConfig, type RepoConfig } from '@/api/codehub';

export interface NotificationItem {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

interface AppState {
  config: CodeHubConfig | null;
  isConfigured: boolean;
  sidebarCollapsed: boolean;
  currentMR: number | null;

  activeRepoId: string | null;
  reposConfig: RepoConfig[];

  themeMode: 'light' | 'dark';
  notifications: NotificationItem[];
  unreadCount: number;

  setConfig: (config: CodeHubConfig | null) => void;
  setIsConfigured: (configured: boolean) => void;
  toggleSidebar: () => void;
  setCurrentMR: (mrIid: number | null) => void;

  setActiveRepoId: (id: string | null) => void;
  setReposConfig: (repos: RepoConfig[]) => void;
  loadReposConfig: () => Promise<void>;

  setThemeMode: (mode: 'light' | 'dark') => void;
  toggleTheme: () => void;

  markAllRead: () => void;
  addNotification: (item: NotificationItem) => void;
}

const STORAGE_KEY_THEME = 'cr-theme-mode';

function loadThemeFromStorage(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_THEME);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore
  }
  return 'light';
}

function persistTheme(mode: 'light' | 'dark') {
  try {
    localStorage.setItem(STORAGE_KEY_THEME, mode);
  } catch {
    // ignore
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  config: null,
  isConfigured: false,
  sidebarCollapsed: false,
  currentMR: null,

  activeRepoId: null,
  reposConfig: [],

  themeMode: loadThemeFromStorage(),
  notifications: [],
  unreadCount: 0,

  setConfig: (config) => set({ config }),
  setIsConfigured: (configured) => set({ isConfigured: configured }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setCurrentMR: (mrIid) => set({ currentMR: mrIid }),

  setActiveRepoId: (id) => set({ activeRepoId: id }),
  setReposConfig: (repos) => set({ reposConfig: repos }),
  loadReposConfig: async () => {
    try {
      const data = await codehubApi.listReposConfig();
      set({
        reposConfig: data?.repos ?? [],
        activeRepoId: data?.activeRepoId ?? null,
      });
    } catch {
      // 后端不可用或未配置时静默处理
    }
  },

  setThemeMode: (mode) => {
    persistTheme(mode);
    set({ themeMode: mode });
  },
  toggleTheme: () => {
    const next = get().themeMode === 'light' ? 'dark' : 'light';
    persistTheme(next);
    set({ themeMode: next });
  },

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),
  addNotification: (item) =>
    set((state) => ({
      notifications: [item, ...state.notifications],
      unreadCount: state.unreadCount + (item.read ? 0 : 1),
    })),
}));