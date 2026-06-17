import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Goals {
  day: string[];
  week: string[];
  month: string[];
  year: string[];
  fiveYear: string[];
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

export interface Task {
  id: string;
  text: string;
  done: boolean;
  date: string;
}

export type ProviderId = 'groq' | 'gemini' | 'openrouter' | 'deepseek' | 'yandex';

export interface ProviderSettings {
  activeProvider: ProviderId;
  keys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
}

const KEYS = {
  GOALS: '@goals',
  HISTORY: '@chat_history',
  LAST_CHECKIN: '@last_checkin',
  TASKS: '@tasks',
  ONBOARDED: '@onboarded',
  API_KEY: '@api_key',
  PROVIDER: '@provider_settings',
};

const DEFAULT_PROVIDER: ProviderSettings = {
  activeProvider: 'groq',
  keys: {},
  models: {},
};

export const storage = {
  async getGoals(): Promise<Goals> {
    const raw = await AsyncStorage.getItem(KEYS.GOALS);
    return raw ? JSON.parse(raw) : { day: [], week: [], month: [], year: [], fiveYear: [] };
  },

  async saveGoals(goals: Goals): Promise<void> {
    await AsyncStorage.setItem(KEYS.GOALS, JSON.stringify(goals));
  },

  async getHistory(): Promise<Message[]> {
    const raw = await AsyncStorage.getItem(KEYS.HISTORY);
    return raw ? JSON.parse(raw) : [];
  },

  async saveHistory(messages: Message[]): Promise<void> {
    const trimmed = messages.slice(-100);
    await AsyncStorage.setItem(KEYS.HISTORY, JSON.stringify(trimmed));
  },

  async appendMessage(message: Message): Promise<void> {
    const history = await storage.getHistory();
    history.push({ ...message, timestamp: Date.now() });
    await storage.saveHistory(history);
  },

  async getLastCheckin(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.LAST_CHECKIN);
  },

  async setLastCheckin(date: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.LAST_CHECKIN, date);
  },

  async getTasks(): Promise<Task[]> {
    const raw = await AsyncStorage.getItem(KEYS.TASKS);
    return raw ? JSON.parse(raw) : [];
  },

  async saveTasks(tasks: Task[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.TASKS, JSON.stringify(tasks));
  },

  async toggleTask(id: string): Promise<void> {
    const tasks = await storage.getTasks();
    const updated = tasks.map(t => t.id === id ? { ...t, done: !t.done } : t);
    await storage.saveTasks(updated);
  },

  async isOnboarded(): Promise<boolean> {
    const val = await AsyncStorage.getItem(KEYS.ONBOARDED);
    return val === 'true';
  },

  async setOnboarded(): Promise<void> {
    await AsyncStorage.setItem(KEYS.ONBOARDED, 'true');
  },

  // Legacy single key — used on onboarding step 0
  async getApiKey(): Promise<string | null> {
    const ps = await storage.getProviderSettings();
    const key = ps.keys[ps.activeProvider];
    return key || AsyncStorage.getItem(KEYS.API_KEY);
  },

  async saveApiKey(key: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.API_KEY, key);
    // Auto-detect provider from key prefix and save
    const provider = detectProvider(key);
    const ps = await storage.getProviderSettings();
    ps.keys[provider] = key;
    ps.activeProvider = provider;
    await storage.saveProviderSettings(ps);
  },

  async getProviderSettings(): Promise<ProviderSettings> {
    const raw = await AsyncStorage.getItem(KEYS.PROVIDER);
    if (!raw) {
      // Migrate legacy API key
      const legacyKey = await AsyncStorage.getItem(KEYS.API_KEY);
      if (legacyKey) {
        const provider = detectProvider(legacyKey);
        return { activeProvider: provider, keys: { [provider]: legacyKey }, models: {} };
      }
      return { ...DEFAULT_PROVIDER };
    }
    return JSON.parse(raw);
  },

  async saveProviderSettings(settings: ProviderSettings): Promise<void> {
    await AsyncStorage.setItem(KEYS.PROVIDER, JSON.stringify(settings));
  },

  async clearAll(): Promise<void> {
    await AsyncStorage.multiRemove(Object.values(KEYS));
  },
};

export function detectProvider(key: string): ProviderId {
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('y1_') || key.startsWith('AQVN') || key.startsWith('t1.')) return 'yandex';
  return 'deepseek';
}

export function todayString(): string {
  return new Date().toISOString().split('T')[0];
}
