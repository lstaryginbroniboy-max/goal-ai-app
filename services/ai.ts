import axios from 'axios';
import { Message, storage } from './storage';
import { SYSTEM_PROMPT } from '../constants/prompts';

// DeepSeek API (primary) — get free key at platform.deepseek.com
// Groq API (fallback) — free at console.groq.com
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function sendMessage(userText: string): Promise<string> {
  const apiKey = await storage.getApiKey();
  if (!apiKey) {
    return 'Пожалуйста, добавь API ключ в настройках (кнопка ⚙️ вверху). Получи бесплатный ключ на platform.deepseek.com или console.groq.com';
  }

  const history = await storage.getHistory();

  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.filter(m => m.role !== 'system').slice(-20),
    { role: 'user', content: userText },
  ];

  const payload = {
    model: apiKey.startsWith('gsk_') ? 'llama-3.3-70b-versatile' : 'deepseek-chat',
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: 0.7,
    max_tokens: 1000,
  };

  const baseURL = apiKey.startsWith('gsk_') ? GROQ_URL : DEEPSEEK_URL;

  try {
    const response = await axios.post(baseURL, payload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const reply = response.data.choices[0].message.content as string;

    await storage.appendMessage({ role: 'user', content: userText });
    await storage.appendMessage({ role: 'assistant', content: reply });

    return reply;
  } catch (err: any) {
    if (err.response?.status === 401) {
      return 'Неверный API ключ. Проверь ключ в настройках ⚙️';
    }
    if (err.response?.status === 429) {
      return 'Превышен лимит запросов. Подожди минуту и попробуй снова.';
    }
    return `Ошибка соединения: ${err.message}. Проверь интернет и попробуй снова.`;
  }
}

export async function sendSystemMessage(systemContent: string): Promise<string> {
  const apiKey = await storage.getApiKey();
  if (!apiKey) return '';

  const history = await storage.getHistory();

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.filter(m => m.role !== 'system').slice(-10),
    { role: 'user', content: systemContent },
  ];

  const isGroq = apiKey.startsWith('gsk_');
  const payload = {
    model: isGroq ? 'llama-3.3-70b-versatile' : 'deepseek-chat',
    messages,
    temperature: 0.7,
    max_tokens: 800,
  };

  try {
    const response = await axios.post(isGroq ? GROQ_URL : DEEPSEEK_URL, payload, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    return response.data.choices[0].message.content as string;
  } catch {
    return '';
  }
}
