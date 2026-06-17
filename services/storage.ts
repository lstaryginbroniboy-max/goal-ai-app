import AsyncStorage from '@react-native-async-storage/async-storage';
import { City } from '../constants/cities';

export interface Goals {
  day: string[];
  week: string[];
  month: string[];
  year: string[];
  fiveYear: string[];
  antiGoals: string[];   // что избегать
}

export interface Commitment {
  text: string;
  deadline: string; // YYYY-MM-DD
  createdAt: string;
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

export interface Habit {
  id: string;
  name: string;
  emoji: string;
}

export interface HabitLog {
  habitId: string;
  date: string;
}

export interface MoodEntry {
  date: string;
  mood: number;    // 1-5
  energy: number;  // 1-5
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
  LAST_WEEKLY: '@last_weekly',
  TASKS: '@tasks',
  ONBOARDED: '@onboarded',
  API_KEY: '@api_key',
  PROVIDER: '@provider_settings',
  CITY: '@city_tz',
  HABITS: '@habits',
  HABIT_LOGS: '@habit_logs',
  MOOD: '@mood_entries',
  COMMITMENT: '@commitment',
};

const DEFAULT_PROVIDER: ProviderSettings = {
  activeProvider: 'groq',
  keys: {},
  models: {},
};

export const storage = {
  async getGoals(): Promise<Goals> {
    const raw = await AsyncStorage.getItem(KEYS.GOALS);
    const defaults = { day: [], week: [], month: [], year: [], fiveYear: [], antiGoals: [] };
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
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

  async getLastWeeklyReview(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.LAST_WEEKLY);
  },

  async setLastWeeklyReview(date: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.LAST_WEEKLY, date);
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

  async getApiKey(): Promise<string | null> {
    const ps = await storage.getProviderSettings();
    const key = ps.keys[ps.activeProvider];
    return key || AsyncStorage.getItem(KEYS.API_KEY);
  },

  async saveApiKey(key: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.API_KEY, key);
    const provider = detectProvider(key);
    const ps = await storage.getProviderSettings();
    ps.keys[provider] = key;
    ps.activeProvider = provider;
    await storage.saveProviderSettings(ps);
  },

  async getProviderSettings(): Promise<ProviderSettings> {
    const raw = await AsyncStorage.getItem(KEYS.PROVIDER);
    if (!raw) {
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

  async getCity(): Promise<City | null> {
    const raw = await AsyncStorage.getItem(KEYS.CITY);
    return raw ? JSON.parse(raw) : null;
  },

  async saveCity(city: City): Promise<void> {
    await AsyncStorage.setItem(KEYS.CITY, JSON.stringify(city));
  },

  // ── Habits ─────────────────────────────────────────────────────────────────
  async getHabits(): Promise<Habit[]> {
    const raw = await AsyncStorage.getItem(KEYS.HABITS);
    return raw ? JSON.parse(raw) : [];
  },

  async saveHabits(habits: Habit[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.HABITS, JSON.stringify(habits));
  },

  async getHabitLogs(): Promise<HabitLog[]> {
    const raw = await AsyncStorage.getItem(KEYS.HABIT_LOGS);
    return raw ? JSON.parse(raw) : [];
  },

  async toggleHabitLog(habitId: string, date: string): Promise<HabitLog[]> {
    const logs = await storage.getHabitLogs();
    const exists = logs.some(l => l.habitId === habitId && l.date === date);
    const updated = exists
      ? logs.filter(l => !(l.habitId === habitId && l.date === date))
      : [...logs, { habitId, date }];
    await AsyncStorage.setItem(KEYS.HABIT_LOGS, JSON.stringify(updated));
    return updated;
  },

  // ── Mood ───────────────────────────────────────────────────────────────────
  async getMoodEntries(): Promise<MoodEntry[]> {
    const raw = await AsyncStorage.getItem(KEYS.MOOD);
    return raw ? JSON.parse(raw) : [];
  },

  async saveMoodEntry(entry: MoodEntry): Promise<void> {
    const entries = await storage.getMoodEntries();
    const filtered = entries.filter(e => e.date !== entry.date);
    await AsyncStorage.setItem(KEYS.MOOD, JSON.stringify([...filtered, entry]));
  },

  async getTodayMood(): Promise<MoodEntry | null> {
    const entries = await storage.getMoodEntries();
    return entries.find(e => e.date === todayString()) || null;
  },

  async getCommitment(): Promise<Commitment | null> {
    const raw = await AsyncStorage.getItem(KEYS.COMMITMENT);
    return raw ? JSON.parse(raw) : null;
  },

  async saveCommitment(c: Commitment): Promise<void> {
    await AsyncStorage.setItem(KEYS.COMMITMENT, JSON.stringify(c));
  },

  async clearCommitment(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.COMMITMENT);
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
