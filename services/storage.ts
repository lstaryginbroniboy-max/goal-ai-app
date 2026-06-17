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

const KEYS = {
  GOALS: '@goals',
  HISTORY: '@chat_history',
  LAST_CHECKIN: '@last_checkin',
  TASKS: '@tasks',
  ONBOARDED: '@onboarded',
  API_KEY: '@api_key',
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
    // Keep last 100 messages to avoid excessive storage
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

  async getApiKey(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.API_KEY);
  },

  async saveApiKey(key: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.API_KEY, key);
  },

  async clearAll(): Promise<void> {
    await AsyncStorage.multiRemove(Object.values(KEYS));
  },
};

export function todayString(): string {
  return new Date().toISOString().split('T')[0];
}
