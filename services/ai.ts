import axios from 'axios';
import { storage, ProviderId } from './storage';
import { SYSTEM_PROMPT } from '../constants/prompts';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  badge: string;
  badgeColor: string;
  desc: string;
  url: string;
  defaultModel: string;
  models: { id: string; label: string }[];
  keyPlaceholder: string;
  keyHint: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'groq',
    name: 'Groq',
    badge: '🟢 Бесплатно',
    badgeColor: '#D1FAE5',
    desc: 'console.groq.com',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (лучший)' },
      { id: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B (быстрый)' },
      { id: 'gemma2-9b-it',            label: 'Gemma 2 9B' },
      { id: 'mixtral-8x7b-32768',      label: 'Mixtral 8x7B' },
    ],
    keyPlaceholder: 'gsk_...',
    keyHint: 'Ключ начинается с gsk_',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    badge: '🟢 Бесплатно',
    badgeColor: '#D1FAE5',
    desc: 'aistudio.google.com',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-1.5-flash',
    models: [
      { id: 'gemini-1.5-flash',   label: 'Gemini 1.5 Flash (быстрый)' },
      { id: 'gemini-1.5-pro',     label: 'Gemini 1.5 Pro (умнее)' },
      { id: 'gemini-2.0-flash',   label: 'Gemini 2.0 Flash (новый)' },
    ],
    keyPlaceholder: 'AIza...',
    keyHint: 'Ключ начинается с AIza',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    badge: '🟡 Есть бесплатные',
    badgeColor: '#FEF3C7',
    desc: 'openrouter.ai',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
    models: [
      { id: 'meta-llama/llama-3.1-8b-instruct:free', label: 'Llama 3.1 8B (бесплатно)' },
      { id: 'mistralai/mistral-7b-instruct:free',     label: 'Mistral 7B (бесплатно)' },
      { id: 'google/gemma-2-9b-it:free',              label: 'Gemma 2 9B (бесплатно)' },
      { id: 'deepseek/deepseek-r1:free',              label: 'DeepSeek R1 (бесплатно)' },
    ],
    keyPlaceholder: 'sk-or-...',
    keyHint: 'Ключ начинается с sk-or-',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    badge: '🔵 Почти бесплатно',
    badgeColor: '#DBEAFE',
    desc: 'platform.deepseek.com',
    url: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat',     label: 'DeepSeek Chat V3' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1 (думает)' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: 'Ключ начинается с sk-',
  },
  {
    id: 'yandex',
    name: 'YandexGPT',
    badge: '🔴 Требует Yandex Cloud',
    badgeColor: '#FEE2E2',
    desc: 'console.yandex.cloud',
    url: 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
    defaultModel: 'yandexgpt-lite',
    models: [
      { id: 'yandexgpt-lite', label: 'YandexGPT Lite (быстрый)' },
      { id: 'yandexgpt',      label: 'YandexGPT (умнее)' },
    ],
    keyPlaceholder: 'y1_...',
    keyHint: 'API-ключ из Yandex Cloud IAM',
  },
];

async function callOpenAI(url: string, apiKey: string, model: string, messages: { role: string; content: string }[], extraHeaders?: Record<string, string>): Promise<string> {
  const response = await axios.post(url, {
    model,
    messages,
    temperature: 0.7,
    max_tokens: 1000,
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    timeout: 30000,
  });
  return response.data.choices[0].message.content as string;
}

async function callYandex(apiKey: string, model: string, messages: { role: string; content: string }[]): Promise<string> {
  const response = await axios.post('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
    modelUri: `gpt://${model}/latest`,
    completionOptions: { temperature: 0.7, maxTokens: 1000 },
    messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user', text: m.content })),
  }, {
    headers: { 'Authorization': `Api-Key ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
  return response.data.result.alternatives[0].message.text as string;
}

function errorMessage(err: any): string {
  if (err.response?.status === 401) return 'Неверный API ключ. Проверь ключ в настройках ⚙️';
  if (err.response?.status === 429) return 'Превышен лимит запросов. Подожди минуту и попробуй снова.';
  if (err.response?.status === 403) return 'Доступ запрещён. Проверь права API ключа.';
  return `Ошибка: ${err.message}. Проверь интернет и ключ в настройках ⚙️`;
}

async function getActiveConfig() {
  const ps = await storage.getProviderSettings();
  const providerId = ps.activeProvider;
  const apiKey = ps.keys[providerId] || '';
  const providerInfo = PROVIDERS.find(p => p.id === providerId)!;
  const model = ps.models[providerId] || providerInfo.defaultModel;
  return { providerId, apiKey, providerInfo, model };
}

export async function sendMessage(userText: string): Promise<string> {
  const { providerId, apiKey, providerInfo, model } = await getActiveConfig();

  if (!apiKey) return 'Пожалуйста, добавь API ключ в настройках ⚙️';

  const history = await storage.getHistory();
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.filter(m => m.role !== 'system').slice(-20).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
  ];

  try {
    let reply: string;
    if (providerId === 'yandex') {
      reply = await callYandex(apiKey, model, messages);
    } else {
      const extraHeaders = providerId === 'openrouter'
        ? { 'HTTP-Referer': 'https://lstaryginbroniboy-max.github.io/goal-ai-app', 'X-Title': 'Лучшая версия себя' }
        : {};
      reply = await callOpenAI(providerInfo.url, apiKey, model, messages, extraHeaders);
    }
    await storage.appendMessage({ role: 'user', content: userText });
    await storage.appendMessage({ role: 'assistant', content: reply });
    return reply;
  } catch (err: any) {
    return errorMessage(err);
  }
}

export async function sendSystemMessage(systemContent: string): Promise<string> {
  const { providerId, apiKey, providerInfo, model } = await getActiveConfig();
  if (!apiKey) return '';

  const history = await storage.getHistory();
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.filter(m => m.role !== 'system').slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: systemContent },
  ];

  try {
    if (providerId === 'yandex') return await callYandex(apiKey, model, messages);
    const extraHeaders = providerId === 'openrouter'
      ? { 'HTTP-Referer': 'https://lstaryginbroniboy-max.github.io/goal-ai-app', 'X-Title': 'Лучшая версия себя' }
      : {};
    return await callOpenAI(providerInfo.url, apiKey, model, messages, extraHeaders);
  } catch {
    return '';
  }
}
