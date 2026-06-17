import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Modal, ActivityIndicator, KeyboardAvoidingView, Platform,
  SafeAreaView, Alert, Animated, Easing
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { storage, Goals, Task, todayString, ProviderId, ProviderSettings } from './services/storage';
import { sendMessage, sendSystemMessage, PROVIDERS } from './services/ai';
import { DAILY_CHECKIN_PROMPT } from './constants/prompts';

type Screen = 'home' | 'chat' | 'goals' | 'settings' | 'onboarding';

// ─── Speech Recognition ───────────────────────────────────────────────────────
function useSpeech(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (listening) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.3, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1,   duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(1);
    }
  }, [listening]);

  const start = useCallback(() => {
    const SR = (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
    if (!SR) {
      Alert.alert('Не поддерживается', 'Голосовой ввод работает в Chrome и Яндекс браузере.');
      return;
    }
    const rec = new SR();
    rec.lang = 'ru-RU';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart  = () => setListening(true);
    rec.onend    = () => setListening(false);
    rec.onerror  = () => setListening(false);
    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      onResult(text);
    };
    rec.start();
    recRef.current = rec;
  }, [onResult]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  return { listening, start, stop, pulse };
}

// ─── Mic Button ───────────────────────────────────────────────────────────────
function MicButton({ onText }: { onText: (t: string) => void }) {
  const { listening, start, stop, pulse } = useSpeech(onText);
  return (
    <TouchableOpacity onPress={listening ? stop : start} activeOpacity={0.8}>
      <Animated.View style={[st.micBtn, listening && st.micBtnActive, { transform: [{ scale: pulse }] }]}>
        <Text style={{ fontSize: 20 }}>{listening ? '⏹' : '🎤'}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const GOAL_LABELS: { key: keyof Goals; emoji: string; title: string }[] = [
  { key: 'day',     emoji: '☀️', title: 'Цели на сегодня' },
  { key: 'week',    emoji: '📋', title: 'Цели на неделю' },
  { key: 'month',   emoji: '📅', title: 'Цели на месяц' },
  { key: 'year',    emoji: '🎯', title: 'Цели на год' },
  { key: 'fiveYear',emoji: '🚀', title: 'Цели на 5 лет' },
];

const ONBOARDING_STEPS = [
  { key: 'apiKey',  emoji: '🔑', title: 'API Ключ для ИИ',   sub: 'Нужен для работы коуча',      desc: '🟢 Groq — полностью бесплатно\n   console.groq.com  →  ключ gsk_...\n\n🔵 DeepSeek — почти бесплатно\n   platform.deepseek.com  →  ключ sk-...', placeholder: 'gsk_... или sk-...', secure: true,  multi: false },
  { key: 'fiveYear',emoji: '🚀', title: 'Цели на 5 лет',     sub: 'Кем ты хочешь стать?',        desc: '',  placeholder: 'Каждая цель — отдельная строка', secure: false, multi: true  },
  { key: 'year',    emoji: '🎯', title: 'Цели на год',        sub: 'Что достичь в этом году?',    desc: '',  placeholder: 'Каждая цель — отдельная строка', secure: false, multi: true  },
  { key: 'month',   emoji: '📅', title: 'Цели на месяц',      sub: 'Фокус этого месяца?',         desc: '',  placeholder: 'Каждая цель — отдельная строка', secure: false, multi: true  },
  { key: 'week',    emoji: '📋', title: 'Цели на неделю',     sub: 'Фокус этой недели?',          desc: '',  placeholder: 'Каждая цель — отдельная строка', secure: false, multi: true  },
  { key: 'day',     emoji: '☀️', title: 'Цели на сегодня',    sub: 'Что важно сделать сегодня?',  desc: '',  placeholder: 'Каждая цель — отдельная строка', secure: false, multi: true  },
];

// ─── Onboarding ───────────────────────────────────────────────────────────────
function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(ONBOARDING_STEPS.map(s => [s.key, '']))
  );
  const cur = ONBOARDING_STEPS[step];
  const isLast = step === ONBOARDING_STEPS.length - 1;

  async function next() {
    if (cur.key === 'apiKey' && !vals.apiKey.trim()) {
      Alert.alert('Введи API ключ', 'Это нужно для работы ИИ-коуча'); return;
    }
    if (step === 0) await storage.saveApiKey(vals.apiKey.trim());
    if (isLast) {
      const goals: Goals = {
        day:      vals.day.split('\n').map(s => s.trim()).filter(Boolean),
        week:     vals.week.split('\n').map(s => s.trim()).filter(Boolean),
        month:    vals.month.split('\n').map(s => s.trim()).filter(Boolean),
        year:     vals.year.split('\n').map(s => s.trim()).filter(Boolean),
        fiveYear: vals.fiveYear.split('\n').map(s => s.trim()).filter(Boolean),
      };
      await storage.saveGoals(goals);
      await storage.setOnboarded();
      onDone();
    } else {
      setStep(s => s + 1);
    }
  }

  return (
    <SafeAreaView style={st.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={st.obWrap} keyboardShouldPersistTaps="handled">
          <View style={st.dots}>
            {ONBOARDING_STEPS.map((_, i) => (
              <View key={i} style={[st.dot, i <= step && st.dotActive]} />
            ))}
          </View>
          <Text style={st.obEmoji}>{cur.emoji}</Text>
          <Text style={st.obTitle}>{cur.title}</Text>
          <Text style={st.obSub}>{cur.sub}</Text>
          {!!cur.desc && (
            <View style={st.descBox}>
              <Text style={st.descText}>{cur.desc}</Text>
            </View>
          )}
          <TextInput
            style={[st.obInput, cur.multi && { minHeight: 100, textAlignVertical: 'top' }]}
            value={vals[cur.key]}
            onChangeText={v => setVals(p => ({ ...p, [cur.key]: v }))}
            placeholder={cur.placeholder}
            placeholderTextColor="#9CA3AF"
            multiline={cur.multi}
            secureTextEntry={cur.secure}
            autoCapitalize="none"
          />
          <TouchableOpacity style={st.primaryBtn} onPress={next}>
            <Text style={st.primaryBtnText}>{isLast ? 'Начать! 🚀' : 'Далее →'}</Text>
          </TouchableOpacity>
          {step > 0 && (
            <TouchableOpacity onPress={() => setStep(s => s - 1)} style={{ marginTop: 12 }}>
              <Text style={{ color: '#6B7280', fontSize: 15 }}>← Назад</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────
function HomeScreen({ onSettings }: { onSettings: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hasKey, setHasKey] = useState(false);
  const [showCheckin, setShowCheckin] = useState(false);
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const h = new Date().getHours();
  const greet = h < 12 ? 'Доброе утро! ☀️' : h < 17 ? 'Добрый день! 🌤' : 'Добрый вечер! 🌙';
  const dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  useEffect(() => { init(); }, []);

  async function init() {
    const key = await storage.getApiKey();
    setHasKey(!!key);
    const all = await storage.getTasks();
    setTasks(all.filter(t => t.date === todayString()));
    const last = await storage.getLastCheckin();
    if (last !== todayString() && key) { setShowCheckin(true); startCheckin(); }
  }

  async function startCheckin() {
    setLoading(true);
    const goals = await storage.getGoals();
    const reply = await sendSystemMessage(DAILY_CHECKIN_PROMPT(goals));
    setMsgs([{ role: 'assistant', content: reply || 'Привет! Как прошёл вчерашний день? Что успел сделать?' }]);
    setLoading(false);
  }

  async function sendCheckin() {
    if (!input.trim() || loading) return;
    const text = input.trim(); setInput('');
    const next = [...msgs, { role: 'user' as const, content: text }];
    setMsgs(next); setLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    const reply = await sendMessage(text);
    const withReply = [...next, { role: 'assistant' as const, content: reply }];
    setMsgs(withReply); setLoading(false);
    // Extract tasks
    const lines = reply.split('\n').filter(l => l.match(/✅|^\d+\./));
    if (lines.length) {
      const existing = await storage.getTasks();
      const newTasks: Task[] = lines.map((l, i) => ({
        id: `${Date.now()}_${i}`,
        text: l.replace(/^✅\s*(Задача\s*\d+:\s*)?/i, '').replace(/^\d+\.\s*/, '').trim(),
        done: false, date: todayString(),
      }));
      await storage.saveTasks([...existing, ...newTasks]);
      setTasks(newTasks);
    }
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }

  async function closeCheckin() {
    await storage.setLastCheckin(todayString()); setShowCheckin(false);
  }

  async function toggleTask(id: string) {
    await storage.toggleTask(id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  }

  const done = tasks.filter(t => t.done).length;

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={st.topBar}>
        <View>
          <Text style={st.greeting}>{greet}</Text>
          <Text style={st.dateText}>{dateStr}</Text>
        </View>
        <TouchableOpacity onPress={onSettings}><Text style={st.icon}>⚙️</Text></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={st.content}>
        {!hasKey && (
          <TouchableOpacity style={st.warnCard} onPress={onSettings}>
            <Text style={st.warnText}>⚠️ Добавь API ключ в настройках — нажми сюда →</Text>
          </TouchableOpacity>
        )}

        <View style={st.card}>
          <Text style={st.cardTitle}>Задачи на сегодня</Text>
          <View style={st.progBar}>
            <View style={[st.progFill, { width: tasks.length ? `${(done / tasks.length) * 100}%` as any : '0%' }]} />
          </View>
          <Text style={st.progText}>{done} из {tasks.length} выполнено</Text>
        </View>

        {tasks.length === 0 ? (
          <View style={[st.card, { alignItems: 'center', paddingVertical: 32 }]}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>🤖</Text>
            <Text style={[st.cardTitle, { textAlign: 'center' }]}>Нет задач на сегодня</Text>
            <Text style={{ color: '#6B7280', textAlign: 'center', marginBottom: 20, marginTop: 4 }}>
              Пройди утренний чек-ин с коучем
            </Text>
            <TouchableOpacity style={st.primaryBtn}
              onPress={() => { setShowCheckin(true); if (!msgs.length) startCheckin(); }}>
              <Text style={st.primaryBtnText}>Начать чек-ин</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={st.sectionLabel}>Мои задачи</Text>
            {tasks.map(task => (
              <TouchableOpacity key={task.id} style={st.taskRow} onPress={() => toggleTask(task.id)} activeOpacity={0.7}>
                <View style={[st.checkbox, task.done && st.checkboxDone]}>
                  {task.done && <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>✓</Text>}
                </View>
                <Text style={[st.taskText, task.done && st.taskDone]}>{task.text}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {done > 0 && done === tasks.length && (
          <View style={[st.card, { backgroundColor: '#D1FAE5', alignItems: 'center', marginTop: 8 }]}>
            <Text style={{ fontSize: 36, marginBottom: 6 }}>🎉</Text>
            <Text style={{ fontWeight: '700', color: '#065F46', fontSize: 16 }}>Все задачи выполнены!</Text>
            <Text style={{ color: '#047857', marginTop: 4 }}>Отличная работа сегодня!</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={showCheckin} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={st.safe}>
          <View style={st.modalHeader}>
            <Text style={st.modalTitle}>☀️ Утренний чек-ин</Text>
            <TouchableOpacity onPress={closeCheckin}>
              <Text style={{ color: '#4F46E5', fontWeight: '600', fontSize: 16 }}>Готово</Text>
            </TouchableOpacity>
          </View>
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 20 }}>
            {msgs.map((m, i) => (
              <View key={i} style={[st.bubble, m.role === 'user' ? st.bubbleUser : st.bubbleAI]}>
                {m.role === 'assistant' && <Text style={{ fontSize: 20, marginRight: 8 }}>🤖</Text>}
                <Text style={[st.bubbleText, m.role === 'user' && { color: '#fff' }]}>{m.content}</Text>
              </View>
            ))}
            {loading && (
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                <ActivityIndicator color="#4F46E5" size="small" />
                <Text style={{ color: '#6B7280', marginLeft: 8 }}>Коуч думает...</Text>
              </View>
            )}
          </ScrollView>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={st.inputRow}>
              <MicButton onText={t => setInput(prev => prev ? prev + ' ' + t : t)} />
              <TextInput style={st.chatInput} value={input} onChangeText={setInput}
                placeholder="Напиши или скажи..." placeholderTextColor="#9CA3AF" multiline />
              <TouchableOpacity
                style={[st.sendBtn, (!input.trim() || loading) && { backgroundColor: '#C7D2FE' }]}
                onPress={sendCheckin} disabled={!input.trim() || loading}>
                <Text style={{ color: '#fff', fontSize: 18 }}>➤</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
function ChatScreen() {
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    storage.getHistory().then(h =>
      setMsgs(h.filter(m => m.role !== 'system').map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })))
    );
  }, []);

  async function send() {
    if (!input.trim() || loading) return;
    const text = input.trim(); setInput('');
    const next = [...msgs, { role: 'user' as const, content: text }];
    setMsgs(next); setLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    const reply = await sendMessage(text);
    setMsgs([...next, { role: 'assistant' as const, content: reply }]);
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }

  const CHIPS = ['Дай задачи на сегодня', 'Как достичь моих целей?', 'Мотивируй меня!'];

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={st.screenHeader}>
        <Text style={st.screenTitle}>🤖 Коуч</Text>
        <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>Помогает достигать твоих целей</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        {msgs.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <Text style={{ fontSize: 56, marginBottom: 16 }}>💬</Text>
            <Text style={[st.cardTitle, { fontSize: 20, textAlign: 'center', marginBottom: 8 }]}>
              Начни разговор с коучем
            </Text>
            <Text style={{ color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 28 }}>
              Расскажи о целях, спроси совет или попроси задачи на день
            </Text>
            {CHIPS.map(c => (
              <TouchableOpacity key={c} style={st.chip} onPress={() => setInput(c)}>
                <Text style={st.chipText}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 16 }}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
            {msgs.map((m, i) => (
              <View key={i} style={[st.bubble, m.role === 'user' ? st.bubbleUser : st.bubbleAI]}>
                {m.role === 'assistant' && <Text style={{ fontSize: 20, marginRight: 8 }}>🤖</Text>}
                <Text style={[st.bubbleText, m.role === 'user' && { color: '#fff' }]}>{m.content}</Text>
              </View>
            ))}
            {loading && (
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                <ActivityIndicator color="#4F46E5" size="small" />
                <Text style={{ color: '#6B7280', marginLeft: 8 }}>Коуч думает...</Text>
              </View>
            )}
          </ScrollView>
        )}
        <View style={st.inputRow}>
          <MicButton onText={t => setInput(prev => prev ? prev + ' ' + t : t)} />
          <TextInput style={st.chatInput} value={input} onChangeText={setInput}
            placeholder="Напиши или скажи..." placeholderTextColor="#9CA3AF" multiline maxLength={1000} />
          <TouchableOpacity
            style={[st.sendBtn, (!input.trim() || loading) && { backgroundColor: '#C7D2FE' }]}
            onPress={send} disabled={!input.trim() || loading}>
            <Text style={{ color: '#fff', fontSize: 18 }}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Goals ────────────────────────────────────────────────────────────────────
function GoalsScreen({ onSettings }: { onSettings: () => void }) {
  const [goals, setGoals] = useState<Goals>({ day: [], week: [], month: [], year: [], fiveYear: [] });
  const [editingKey, setEditingKey] = useState<keyof Goals | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => { storage.getGoals().then(setGoals); }, []);

  async function saveGoal(key: keyof Goals) {
    const vals = draft.split('\n').map(s => s.trim()).filter(Boolean);
    const updated = { ...goals, [key]: vals };
    setGoals(updated);
    await storage.saveGoals(updated);
    setEditingKey(null);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={st.topBar}>
        <Text style={st.screenTitle}>Мои цели</Text>
        <TouchableOpacity onPress={onSettings}><Text style={st.icon}>⚙️</Text></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={st.content}>
        <Text style={st.hint}>Нажми «Изменить» чтобы редактировать. Коуч использует эти цели для составления задач.</Text>
        {GOAL_LABELS.map(({ key, emoji, title }) => (
          <View key={key} style={st.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ fontSize: 22, marginRight: 8 }}>{emoji}</Text>
              <Text style={[st.cardTitle, { flex: 1 }]}>{title}</Text>
              <TouchableOpacity onPress={() => {
                if (editingKey === key) { setEditingKey(null); }
                else { setDraft(goals[key].join('\n')); setEditingKey(key); }
              }}>
                <Text style={{ color: '#4F46E5', fontWeight: '500', fontSize: 14 }}>
                  {editingKey === key ? 'Отмена' : 'Изменить'}
                </Text>
              </TouchableOpacity>
            </View>
            {editingKey === key ? (
              <>
                <TextInput
                  style={[st.obInput, { minHeight: 90, textAlignVertical: 'top', marginBottom: 8 }]}
                  value={draft} onChangeText={setDraft} multiline
                  placeholder="Каждая цель — отдельная строка..." placeholderTextColor="#9CA3AF"
                />
                <TouchableOpacity style={st.primaryBtn} onPress={() => saveGoal(key)}>
                  <Text style={st.primaryBtnText}>Сохранить</Text>
                </TouchableOpacity>
              </>
            ) : goals[key].length === 0 ? (
              <Text style={{ color: '#9CA3AF', fontStyle: 'italic', fontSize: 14 }}>
                Цели не добавлены. Нажми «Изменить».
              </Text>
            ) : (
              goals[key].map((g, i) => (
                <View key={i} style={{ flexDirection: 'row', marginVertical: 3 }}>
                  <Text style={{ color: '#4F46E5', marginRight: 8, fontSize: 16 }}>•</Text>
                  <Text style={{ flex: 1, color: '#374151', fontSize: 15, lineHeight: 22 }}>{g}</Text>
                </View>
              ))
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsScreen({ onBack, onReset }: { onBack: () => void; onReset: () => void }) {
  const [ps, setPs] = useState<ProviderSettings>({ activeProvider: 'groq', keys: {}, models: {} });
  const [savedId, setSavedId] = useState<ProviderId | null>(null);
  const [expandedId, setExpandedId] = useState<ProviderId | null>(null);
  const [draftKeys, setDraftKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [draftModels, setDraftModels] = useState<Partial<Record<ProviderId, string>>>({});

  useEffect(() => {
    storage.getProviderSettings().then(s => {
      setPs(s);
      setDraftKeys(s.keys);
      setDraftModels(s.models);
    });
  }, []);

  async function saveProvider(id: ProviderId) {
    const updated: ProviderSettings = {
      ...ps,
      activeProvider: id,
      keys: { ...ps.keys, [id]: draftKeys[id] || '' },
      models: { ...ps.models, [id]: draftModels[id] || '' },
    };
    setPs(updated);
    await storage.saveProviderSettings(updated);
    setSavedId(id); setTimeout(() => setSavedId(null), 2000);
  }

  async function setActive(id: ProviderId) {
    const updated = { ...ps, activeProvider: id };
    setPs(updated);
    await storage.saveProviderSettings(updated);
  }

  function handleReset() {
    Alert.alert('Сбросить данные?', 'Удалятся история и задачи. Ключи останутся.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Сбросить', style: 'destructive', onPress: async () => {
        const saved = await storage.getProviderSettings();
        await storage.clearAll();
        await storage.saveProviderSettings(saved);
        onReset();
      }},
    ]);
  }

  const activeInfo = PROVIDERS.find(p => p.id === ps.activeProvider)!;

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={st.topBar}>
        <TouchableOpacity onPress={onBack}>
          <Text style={{ color: '#4F46E5', fontSize: 16, fontWeight: '500' }}>← Назад</Text>
        </TouchableOpacity>
        <Text style={st.screenTitle}>Настройки</Text>
        <View style={{ width: 70 }} />
      </View>
      <ScrollView contentContainerStyle={[st.content, { gap: 12 }]}>

        {/* Active provider banner */}
        <View style={[st.card, { backgroundColor: '#EEF2FF', borderWidth: 1.5, borderColor: '#4F46E5' }]}>
          <Text style={{ fontSize: 13, color: '#4F46E5', fontWeight: '600', marginBottom: 4 }}>АКТИВНЫЙ ИИ</Text>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827' }}>{activeInfo.name}</Text>
          <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>
            Модель: {ps.models[ps.activeProvider] || activeInfo.defaultModel}
          </Text>
        </View>

        <Text style={[st.sectionLabel, { marginBottom: 0 }]}>Выбери ИИ провайдера</Text>

        {PROVIDERS.map(provider => {
          const isActive = ps.activeProvider === provider.id;
          const hasKey = !!(ps.keys[provider.id]);
          const isOpen = expandedId === provider.id;
          const curModel = draftModels[provider.id] || provider.defaultModel;

          return (
            <View key={provider.id} style={[st.card, isActive && { borderWidth: 1.5, borderColor: '#4F46E5' }]}>
              {/* Header row */}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center' }}
                onPress={() => setExpandedId(isOpen ? null : provider.id)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>{provider.name}</Text>
                    <View style={[st.badge, { backgroundColor: provider.badgeColor }]}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: '#374151' }}>{provider.badge}</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 13, color: '#6B7280' }}>
                    {provider.desc}  {hasKey ? '✓ ключ есть' : '— нет ключа'}
                  </Text>
                </View>
                <Text style={{ fontSize: 20, marginLeft: 8 }}>{isOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {/* Expanded content */}
              {isOpen && (
                <View style={{ marginTop: 14 }}>
                  {/* Key input */}
                  <Text style={st.fieldLabel}>API Ключ</Text>
                  <TextInput
                    style={[st.obInput, { marginBottom: 10 }]}
                    value={draftKeys[provider.id] || ''}
                    onChangeText={v => setDraftKeys(p => ({ ...p, [provider.id]: v }))}
                    placeholder={provider.keyPlaceholder}
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry autoCapitalize="none"
                  />
                  <Text style={st.fieldHint}>{provider.keyHint}</Text>

                  {/* Model picker */}
                  <Text style={[st.fieldLabel, { marginTop: 12 }]}>Модель</Text>
                  <View style={{ gap: 6 }}>
                    {provider.models.map(m => (
                      <TouchableOpacity
                        key={m.id}
                        style={[st.modelRow, curModel === m.id && st.modelRowActive]}
                        onPress={() => setDraftModels(p => ({ ...p, [provider.id]: m.id }))}
                      >
                        <View style={[st.modelDot, curModel === m.id && st.modelDotActive]} />
                        <Text style={{ fontSize: 14, color: curModel === m.id ? '#4F46E5' : '#374151', flex: 1 }}>
                          {m.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Action buttons */}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                    <TouchableOpacity
                      style={[st.primaryBtn, { flex: 1 }, savedId === provider.id && { backgroundColor: '#10B981' }]}
                      onPress={() => saveProvider(provider.id)}
                    >
                      <Text style={st.primaryBtnText}>
                        {savedId === provider.id ? '✓ Сохранено' : 'Сохранить'}
                      </Text>
                    </TouchableOpacity>
                    {!isActive && (
                      <TouchableOpacity
                        style={[st.primaryBtn, { flex: 1, backgroundColor: hasKey ? '#4F46E5' : '#E5E7EB' }]}
                        onPress={() => hasKey ? setActive(provider.id) : Alert.alert('Сначала введи и сохрани ключ')}
                      >
                        <Text style={[st.primaryBtnText, !hasKey && { color: '#9CA3AF' }]}>
                          Использовать
                        </Text>
                      </TouchableOpacity>
                    )}
                    {isActive && (
                      <View style={[st.primaryBtn, { flex: 1, backgroundColor: '#D1FAE5' }]}>
                        <Text style={[st.primaryBtnText, { color: '#065F46' }]}>✓ Активен</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </View>
          );
        })}

        <View style={st.card}>
          <Text style={st.cardTitle}>ℹ️ О приложении</Text>
          <Text style={{ color: '#6B7280', lineHeight: 22, fontSize: 14 }}>
            Лучшая версия себя — твой персональный ИИ-коуч.{'\n\n'}
            Каждый день спрашивает о прогрессе, ставит задачи и помогает достигать целей. История хранится только на твоём устройстве.
          </Text>
        </View>

        <TouchableOpacity style={[st.primaryBtn, { backgroundColor: '#FEE2E2' }]} onPress={handleReset}>
          <Text style={[st.primaryBtnText, { color: '#DC2626' }]}>Сбросить историю и задачи</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
const TABS: { key: Screen; label: string; emoji: string }[] = [
  { key: 'home',     label: 'Главная',   emoji: '🏠' },
  { key: 'chat',     label: 'Коуч',      emoji: '💬' },
  { key: 'goals',    label: 'Цели',      emoji: '🎯' },
  { key: 'settings', label: 'Настройки', emoji: '⚙️' },
];

export default function App() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [tab, setTab] = useState<Screen>('home');

  useEffect(() => {
    storage.isOnboarded().then(done => setScreen(done ? 'home' : 'onboarding'));
  }, []);

  if (screen === null) {
    return (
      <View style={[st.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ fontSize: 52, marginBottom: 20 }}>🎯</Text>
        <ActivityIndicator color="#4F46E5" size="large" />
      </View>
    );
  }

  if (screen === 'onboarding') {
    return <OnboardingScreen onDone={() => { setTab('home'); setScreen('home'); }} />;
  }

  function goTab(t: Screen) { setTab(t); setScreen(t); }

  return (
    <SafeAreaView style={st.safe}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        {tab === 'home'     && <HomeScreen onSettings={() => goTab('settings')} />}
        {tab === 'chat'     && <ChatScreen />}
        {tab === 'goals'    && <GoalsScreen onSettings={() => goTab('settings')} />}
        {tab === 'settings' && <SettingsScreen onBack={() => goTab('home')} onReset={() => { setTab('home'); setScreen('onboarding'); }} />}
      </View>
      <View style={st.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={st.tabItem} onPress={() => goTab(t.key)} activeOpacity={0.7}>
            <Text style={{ fontSize: 24 }}>{t.emoji}</Text>
            <Text style={[st.tabLabel, tab === t.key && st.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: '#F9FAFB' },
  // Onboarding
  obWrap:       { padding: 24, paddingTop: 48, alignItems: 'center' },
  dots:         { flexDirection: 'row', gap: 8, marginBottom: 32 },
  dot:          { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D1D5DB' },
  dotActive:    { backgroundColor: '#4F46E5', width: 24 },
  obEmoji:      { fontSize: 52, marginBottom: 12 },
  obTitle:      { fontSize: 26, fontWeight: '700', color: '#111827', textAlign: 'center', marginBottom: 6 },
  obSub:        { fontSize: 16, color: '#6B7280', textAlign: 'center', marginBottom: 16 },
  descBox:      { backgroundColor: '#EEF2FF', borderRadius: 12, padding: 14, marginBottom: 16, width: '100%' },
  descText:     { color: '#4338CA', fontSize: 14, lineHeight: 22 },
  obInput:      { width: '100%', backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 14, fontSize: 15, color: '#111827', marginBottom: 16 },
  // Buttons
  primaryBtn:   { width: '100%', backgroundColor: '#4F46E5', borderRadius: 14, padding: 15, alignItems: 'center', marginBottom: 4 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // Layout
  topBar:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  screenHeader: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  screenTitle:  { fontSize: 20, fontWeight: '700', color: '#111827' },
  greeting:     { fontSize: 20, fontWeight: '700', color: '#111827' },
  dateText:     { fontSize: 13, color: '#6B7280', marginTop: 2, textTransform: 'capitalize' },
  icon:         { fontSize: 24 },
  content:      { padding: 16, paddingBottom: 32 },
  hint:         { color: '#6B7280', fontSize: 13, backgroundColor: '#F3F4F6', borderRadius: 10, padding: 12, marginBottom: 12, lineHeight: 18 },
  sectionLabel: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 8 },
  // Cards
  card:         { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardTitle:    { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 4 },
  // Progress
  progBar:      { height: 8, backgroundColor: '#E5E7EB', borderRadius: 4, marginVertical: 8 },
  progFill:     { height: 8, backgroundColor: '#4F46E5', borderRadius: 4 },
  progText:     { fontSize: 13, color: '#6B7280' },
  // Warn
  warnCard:     { backgroundColor: '#FEF3C7', borderRadius: 12, padding: 14, marginBottom: 12 },
  warnText:     { color: '#92400E', fontSize: 14, lineHeight: 20 },
  // Tasks
  taskRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 6, elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  checkbox:     { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#4F46E5', marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  checkboxDone: { backgroundColor: '#4F46E5' },
  taskText:     { flex: 1, fontSize: 15, color: '#111827', lineHeight: 20 },
  taskDone:     { color: '#9CA3AF', textDecorationLine: 'line-through' },
  // Chat bubbles
  bubble:       { marginVertical: 4, maxWidth: '85%', borderRadius: 16, padding: 12, flexDirection: 'row' },
  bubbleAI:     { alignSelf: 'flex-start', backgroundColor: '#F3F4F6' },
  bubbleUser:   { alignSelf: 'flex-end', backgroundColor: '#4F46E5' },
  bubbleText:   { flex: 1, fontSize: 15, color: '#111827', lineHeight: 22 },
  // Mic
  micBtn:       { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  micBtnActive: { backgroundColor: '#FEE2E2' },
  // Input
  inputRow:     { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: '#E5E7EB', backgroundColor: '#fff', alignItems: 'flex-end' },
  chatInput:    { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#111827', maxHeight: 100 },
  sendBtn:      { backgroundColor: '#4F46E5', borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  // Chips
  chip:         { backgroundColor: '#EEF2FF', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 11, marginBottom: 10, width: '100%', alignItems: 'center' },
  chipText:     { color: '#4F46E5', fontWeight: '500', fontSize: 14 },
  // Modal
  modalHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: '#fff' },
  modalTitle:   { fontSize: 18, fontWeight: '700', color: '#111827' },
  // Provider picker
  badge:          { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  fieldLabel:     { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  fieldHint:      { fontSize: 12, color: '#9CA3AF', marginBottom: 4 },
  modelRow:       { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB' },
  modelRowActive: { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' },
  modelDot:       { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#D1D5DB', marginRight: 10 },
  modelDotActive: { borderColor: '#4F46E5', backgroundColor: '#4F46E5' },
  // Tab bar
  tabBar:       { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#F3F4F6', backgroundColor: '#fff', height: 62 },
  tabItem:      { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  tabLabel:     { fontSize: 11, color: '#9CA3AF', marginTop: 2, fontWeight: '500' },
  tabLabelActive: { color: '#4F46E5', fontWeight: '700' },
});
