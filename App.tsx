import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Modal, ActivityIndicator, KeyboardAvoidingView, Platform, Dimensions,
  SafeAreaView, FlatList, Alert
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { storage, Goals, Message, Task, todayString } from './services/storage';
import { sendMessage, sendSystemMessage } from './services/ai';
import { DAILY_CHECKIN_PROMPT } from './constants/prompts';

type Screen = 'home' | 'chat' | 'goals' | 'settings' | 'onboarding';

const GOAL_LABELS = [
  { key: 'day' as keyof Goals, emoji: '☀️', title: 'Цели на сегодня' },
  { key: 'week' as keyof Goals, emoji: '📋', title: 'Цели на неделю' },
  { key: 'month' as keyof Goals, emoji: '📅', title: 'Цели на месяц' },
  { key: 'year' as keyof Goals, emoji: '🎯', title: 'Цели на год' },
  { key: 'fiveYear' as keyof Goals, emoji: '🚀', title: 'Цели на 5 лет' },
];

// ─── Onboarding ─────────────────────────────────────────────────────────────
const STEPS = [
  { key: 'apiKey', emoji: '🔑', title: 'API Ключ для ИИ', sub: 'Нужен для работы коуча', desc: '🟢 Groq — бесплатно: console.groq.com\n   Ключ начинается с gsk_\n\n🔵 DeepSeek — почти бесплатно:\n   platform.deepseek.com\n   Ключ начинается с sk-', placeholder: 'gsk_... или sk-...' },
  { key: 'fiveYear', emoji: '🚀', title: 'Цели на 5 лет', sub: 'Кем ты хочешь стать?', placeholder: 'Каждая цель с новой строки' },
  { key: 'year',    emoji: '🎯', title: 'Цели на год',   sub: 'Что достичь в этом году?', placeholder: 'Каждая цель с новой строки' },
  { key: 'month',   emoji: '📅', title: 'Цели на месяц', sub: 'Фокус этого месяца?', placeholder: 'Каждая цель с новой строки' },
  { key: 'week',    emoji: '📋', title: 'Цели на неделю', sub: 'Фокус этой недели?', placeholder: 'Каждая цель с новой строки' },
  { key: 'day',     emoji: '☀️', title: 'Цели на сегодня', sub: 'Что важно сделать сегодня?', placeholder: 'Каждая цель с новой строки' },
];

function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({
    apiKey: '', fiveYear: '', year: '', month: '', week: '', day: '',
  });
  const cur = STEPS[step];
  const isLast = step === STEPS.length - 1;

  async function next() {
    if (step === 0) {
      if (!values.apiKey.trim()) { Alert.alert('Введи API ключ'); return; }
      await storage.saveApiKey(values.apiKey.trim());
    }
    if (isLast) {
      const goals: Goals = {
        day: values.day.split('\n').map(s => s.trim()).filter(Boolean),
        week: values.week.split('\n').map(s => s.trim()).filter(Boolean),
        month: values.month.split('\n').map(s => s.trim()).filter(Boolean),
        year: values.year.split('\n').map(s => s.trim()).filter(Boolean),
        fiveYear: values.fiveYear.split('\n').map(s => s.trim()).filter(Boolean),
      };
      await storage.saveGoals(goals);
      await storage.setOnboarded();
      onDone();
    } else {
      setStep(s => s + 1);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.obContainer} keyboardShouldPersistTaps="handled">
          <View style={s.dots}>
            {STEPS.map((_, i) => <View key={i} style={[s.dot, i <= step && s.dotOn]} />)}
          </View>
          <Text style={s.obEmoji}>{cur.emoji}</Text>
          <Text style={s.obTitle}>{cur.title}</Text>
          <Text style={s.obSub}>{cur.sub}</Text>
          {cur.desc && <View style={s.descBox}><Text style={s.descText}>{cur.desc}</Text></View>}
          <TextInput
            style={[s.obInput, cur.key !== 'apiKey' && { minHeight: 100, textAlignVertical: 'top' }]}
            value={values[cur.key]}
            onChangeText={v => setValues(p => ({ ...p, [cur.key]: v }))}
            placeholder={cur.placeholder}
            placeholderTextColor="#9CA3AF"
            multiline={cur.key !== 'apiKey'}
            secureTextEntry={cur.key === 'apiKey'}
            autoCapitalize="none"
          />
          <TouchableOpacity style={s.obBtn} onPress={next}>
            <Text style={s.obBtnText}>{isLast ? 'Начать! 🚀' : 'Далее →'}</Text>
          </TouchableOpacity>
          {step > 0 && (
            <TouchableOpacity onPress={() => setStep(s => s - 1)}>
              <Text style={s.obBack}>← Назад</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Home ────────────────────────────────────────────────────────────────────
function HomeScreen({ onNav }: { onNav: (s: Screen) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinMsgs, setCheckinMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [checkinInput, setCheckinInput] = useState('');
  const [checkinLoading, setCheckinLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Доброе утро! ☀️' : hour < 17 ? 'Добрый день! 🌤' : 'Добрый вечер! 🌙';

  useEffect(() => { load(); }, []);

  async function load() {
    const key = await storage.getApiKey();
    setApiKey(key);
    const allTasks = await storage.getTasks();
    setTasks(allTasks.filter(t => t.date === todayString()));
    const last = await storage.getLastCheckin();
    if (last !== todayString() && key) {
      setShowCheckin(true);
      startCheckin();
    }
  }

  async function startCheckin() {
    setCheckinLoading(true);
    const goals = await storage.getGoals();
    const reply = await sendSystemMessage(DAILY_CHECKIN_PROMPT(goals));
    setCheckinMsgs([{ role: 'assistant', content: reply || 'Привет! Как прошёл вчерашний день?' }]);
    setCheckinLoading(false);
  }

  async function sendCheckin() {
    if (!checkinInput.trim() || checkinLoading) return;
    const text = checkinInput.trim();
    setCheckinInput('');
    const msgs = [...checkinMsgs, { role: 'user' as const, content: text }];
    setCheckinMsgs(msgs);
    setCheckinLoading(true);
    const reply = await sendMessage(text);
    setCheckinMsgs([...msgs, { role: 'assistant' as const, content: reply }]);
    const lines = reply.split('\n').filter(l => l.includes('✅') || /^\d+\./.test(l));
    if (lines.length > 0) {
      const existing = await storage.getTasks();
      const newTasks: Task[] = lines.map((line, i) => ({
        id: `${Date.now()}_${i}`,
        text: line.replace(/^✅\s*Задача\s*\d+:\s*/i, '').replace(/^\d+\.\s*/, '').trim(),
        done: false,
        date: todayString(),
      }));
      await storage.saveTasks([...existing, ...newTasks]);
      setTasks(newTasks);
    }
    setCheckinLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  async function closeCheckin() {
    await storage.setLastCheckin(todayString());
    setShowCheckin(false);
  }

  async function toggleTask(id: string) {
    await storage.toggleTask(id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  }

  const done = tasks.filter(t => t.done).length;

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={s.topBar}>
        <View>
          <Text style={s.greeting}>{greeting}</Text>
          <Text style={s.dateText}>{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
        </View>
        <TouchableOpacity onPress={() => onNav('settings')}><Text style={{ fontSize: 24 }}>⚙️</Text></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        {!apiKey && (
          <TouchableOpacity style={s.warnCard} onPress={() => onNav('settings')}>
            <Text style={s.warnText}>⚠️ Добавь API ключ в настройках чтобы ИИ заработал →</Text>
          </TouchableOpacity>
        )}

        <View style={s.card}>
          <Text style={s.cardTitle}>Задачи на сегодня</Text>
          <View style={s.progBar}><View style={[s.progFill, { width: tasks.length ? `${(done / tasks.length) * 100}%` : '0%' }]} /></View>
          <Text style={s.progText}>{done} из {tasks.length} выполнено</Text>
        </View>

        {tasks.length === 0 ? (
          <View style={[s.card, { alignItems: 'center', paddingVertical: 32 }]}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>🤖</Text>
            <Text style={s.cardTitle}>Нет задач на сегодня</Text>
            <Text style={{ color: '#6B7280', textAlign: 'center', marginBottom: 16 }}>Пройди утренний чек-ин с коучем</Text>
            <TouchableOpacity style={s.btn} onPress={() => { setShowCheckin(true); if (checkinMsgs.length === 0) startCheckin(); }}>
              <Text style={s.btnText}>Начать чек-ин</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={s.sectionTitle}>Мои задачи</Text>
            {tasks.map(task => (
              <TouchableOpacity key={task.id} style={s.taskRow} onPress={() => toggleTask(task.id)} activeOpacity={0.7}>
                <View style={[s.checkbox, task.done && s.checkboxDone]}>
                  {task.done && <Text style={{ color: '#fff', fontWeight: 'bold' }}>✓</Text>}
                </View>
                <Text style={[s.taskText, task.done && s.taskDone]}>{task.text}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {done === tasks.length && tasks.length > 0 && (
          <View style={[s.card, { backgroundColor: '#D1FAE5', alignItems: 'center' }]}>
            <Text style={{ fontSize: 36 }}>🎉</Text>
            <Text style={{ fontWeight: '700', color: '#065F46', marginTop: 8 }}>Все задачи выполнены!</Text>
          </View>
        )}
      </ScrollView>

      {/* Checkin Modal */}
      <Modal visible={showCheckin} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={s.safe}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>☀️ Утренний чек-ин</Text>
            <TouchableOpacity onPress={closeCheckin}><Text style={{ color: '#4F46E5', fontWeight: '600', fontSize: 16 }}>Готово</Text></TouchableOpacity>
          </View>
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
            {checkinMsgs.map((m, i) => (
              <View key={i} style={[s.bubble, m.role === 'user' ? s.bubbleUser : s.bubbleAI]}>
                {m.role === 'assistant' && <Text style={{ fontSize: 18, marginRight: 6 }}>🤖</Text>}
                <Text style={[s.bubbleText, m.role === 'user' && { color: '#fff' }]}>{m.content}</Text>
              </View>
            ))}
            {checkinLoading && <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8 }}>
              <ActivityIndicator color="#4F46E5" size="small" />
              <Text style={{ color: '#6B7280', marginLeft: 8 }}>Коуч думает...</Text>
            </View>}
          </ScrollView>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={s.inputRow}>
              <TextInput style={s.chatInput} value={checkinInput} onChangeText={setCheckinInput}
                placeholder="Напиши ответ..." placeholderTextColor="#9CA3AF" multiline />
              <TouchableOpacity style={[s.sendBtn, (!checkinInput.trim() || checkinLoading) && { backgroundColor: '#C7D2FE' }]}
                onPress={sendCheckin} disabled={!checkinInput.trim() || checkinLoading}>
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
    storage.getHistory().then(h => setMsgs(h.filter(m => m.role !== 'system') as any));
  }, []);

  async function send() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');
    const newMsgs = [...msgs, { role: 'user' as const, content: text }];
    setMsgs(newMsgs);
    setLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    const reply = await sendMessage(text);
    setMsgs([...newMsgs, { role: 'assistant' as const, content: reply }]);
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }

  const chips = ['Дай задачи на сегодня', 'Как достичь моих целей?', 'Мотивируй меня!'];

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={s.screenHeader}><Text style={s.screenTitle}>🤖 Коуч</Text></View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        {msgs.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <Text style={{ fontSize: 56, marginBottom: 16 }}>💬</Text>
            <Text style={s.cardTitle}>Начни разговор с коучем</Text>
            <Text style={{ color: '#6B7280', textAlign: 'center', marginBottom: 24 }}>Расскажи о целях, спроси совет или попроси задачи</Text>
            {chips.map(c => (
              <TouchableOpacity key={c} style={s.chip} onPress={() => setInput(c)}>
                <Text style={s.chipText}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
            {msgs.map((m, i) => (
              <View key={i} style={[s.bubble, m.role === 'user' ? s.bubbleUser : s.bubbleAI]}>
                {m.role === 'assistant' && <Text style={{ fontSize: 18, marginRight: 6 }}>🤖</Text>}
                <Text style={[s.bubbleText, m.role === 'user' && { color: '#fff' }]}>{m.content}</Text>
              </View>
            ))}
            {loading && <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8 }}>
              <ActivityIndicator color="#4F46E5" size="small" />
              <Text style={{ color: '#6B7280', marginLeft: 8 }}>Коуч думает...</Text>
            </View>}
          </ScrollView>
        )}
        <View style={s.inputRow}>
          <TextInput style={s.chatInput} value={input} onChangeText={setInput}
            placeholder="Написать коучу..." placeholderTextColor="#9CA3AF" multiline maxLength={1000} />
          <TouchableOpacity style={[s.sendBtn, (!input.trim() || loading) && { backgroundColor: '#C7D2FE' }]}
            onPress={send} disabled={!input.trim() || loading}>
            <Text style={{ color: '#fff', fontSize: 18 }}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Goals ────────────────────────────────────────────────────────────────────
function GoalsScreen({ onNav }: { onNav: (s: Screen) => void }) {
  const [goals, setGoals] = useState<Goals>({ day: [], week: [], month: [], year: [], fiveYear: [] });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => { storage.getGoals().then(setGoals); }, []);

  async function save(key: keyof Goals) {
    const vals = draft.split('\n').map(s => s.trim()).filter(Boolean);
    const updated = { ...goals, [key]: vals };
    setGoals(updated);
    await storage.saveGoals(updated);
    setEditing(null);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={s.topBar}>
        <Text style={s.screenTitle}>Мои цели</Text>
        <TouchableOpacity onPress={() => onNav('settings')}><Text style={{ fontSize: 24 }}>⚙️</Text></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text style={{ color: '#6B7280', fontSize: 13, marginBottom: 12 }}>
          Нажми «Изменить» чтобы редактировать. Коуч использует цели для задач.
        </Text>
        {GOAL_LABELS.map(({ key, emoji, title }) => (
          <View key={key} style={s.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ fontSize: 22, marginRight: 8 }}>{emoji}</Text>
              <Text style={[s.cardTitle, { flex: 1 }]}>{title}</Text>
              <TouchableOpacity onPress={() => {
                if (editing === key) { setEditing(null); }
                else { setDraft(goals[key].join('\n')); setEditing(key); }
              }}>
                <Text style={{ color: '#4F46E5', fontWeight: '500' }}>{editing === key ? 'Отмена' : 'Изменить'}</Text>
              </TouchableOpacity>
            </View>
            {editing === key ? (
              <>
                <TextInput style={[s.obInput, { minHeight: 80, textAlignVertical: 'top', marginBottom: 8 }]}
                  value={draft} onChangeText={setDraft} multiline placeholder="Каждая цель с новой строки..."
                  placeholderTextColor="#9CA3AF" />
                <TouchableOpacity style={s.btn} onPress={() => save(key)}>
                  <Text style={s.btnText}>Сохранить</Text>
                </TouchableOpacity>
              </>
            ) : goals[key].length === 0 ? (
              <Text style={{ color: '#9CA3AF', fontStyle: 'italic' }}>Нет целей. Нажми «Изменить»</Text>
            ) : (
              goals[key].map((g, i) => (
                <View key={i} style={{ flexDirection: 'row', marginVertical: 2 }}>
                  <Text style={{ color: '#4F46E5', marginRight: 8 }}>•</Text>
                  <Text style={{ flex: 1, color: '#374151' }}>{g}</Text>
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
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { storage.getApiKey().then(k => setApiKey(k || '')); }, []);

  async function handleSave() {
    await storage.saveApiKey(apiKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleReset() {
    Alert.alert('Сбросить данные?', 'Удалится история, задачи и цели. Ключ сохранится.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Сбросить', style: 'destructive', onPress: async () => {
        const key = await storage.getApiKey();
        await storage.clearAll();
        if (key) await storage.saveApiKey(key);
        onReset();
      }},
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={s.topBar}>
        <TouchableOpacity onPress={onBack}><Text style={{ color: '#4F46E5', fontSize: 16 }}>← Назад</Text></TouchableOpacity>
        <Text style={s.screenTitle}>Настройки</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View style={s.card}>
          <Text style={s.cardTitle}>🔑 API Ключ</Text>
          <Text style={{ color: '#6B7280', marginBottom: 12, lineHeight: 22 }}>
            {'🟢 Groq — бесплатно: console.groq.com\n   (ключ начинается с gsk_)\n\n🔵 DeepSeek — почти бесплатно:\n   platform.deepseek.com\n   (ключ начинается с sk-)'}
          </Text>
          <TextInput style={s.obInput} value={apiKey} onChangeText={setApiKey}
            placeholder="gsk_... или sk-..." placeholderTextColor="#9CA3AF"
            secureTextEntry autoCapitalize="none" />
          <TouchableOpacity style={[s.btn, saved && { backgroundColor: '#10B981' }]} onPress={handleSave}>
            <Text style={s.btnText}>{saved ? '✓ Сохранено!' : 'Сохранить ключ'}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={[s.btn, { backgroundColor: '#FEE2E2' }]} onPress={handleReset}>
          <Text style={[s.btnText, { color: '#DC2626' }]}>Сбросить все данные</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Tab Bar ──────────────────────────────────────────────────────────────────
const TABS: { key: Screen; label: string; emoji: string }[] = [
  { key: 'home', label: 'Главная', emoji: '🏠' },
  { key: 'chat', label: 'Коуч', emoji: '💬' },
  { key: 'goals', label: 'Цели', emoji: '🎯' },
];

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [tab, setTab] = useState<Screen>('home');
  const [prevTab, setPrevTab] = useState<Screen>('home');

  useEffect(() => {
    storage.isOnboarded().then(done => setScreen(done ? 'home' : 'onboarding'));
  }, []);

  if (screen === null) {
    return (
      <View style={[s.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🎯</Text>
        <ActivityIndicator color="#4F46E5" size="large" />
      </View>
    );
  }

  if (screen === 'onboarding') {
    return <OnboardingScreen onDone={() => setScreen('home')} />;
  }

  if (screen === 'settings') {
    return (
      <SafeAreaView style={s.safe}>
        <SettingsScreen onBack={() => setScreen(prevTab)} onReset={() => setScreen('onboarding')} />
      </SafeAreaView>
    );
  }

  const nav = (s: Screen) => {
    if (s === 'settings') { setPrevTab(tab); setScreen('settings'); }
    else { setTab(s); setScreen(s); }
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        {tab === 'home'  && <HomeScreen onNav={nav} />}
        {tab === 'chat'  && <ChatScreen />}
        {tab === 'goals' && <GoalsScreen onNav={nav} />}
      </View>
      <View style={s.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={s.tabItem} onPress={() => nav(t.key)}>
            <Text style={{ fontSize: 22 }}>{t.emoji}</Text>
            <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9FAFB' },
  // Onboarding
  obContainer: { padding: 24, paddingTop: 48, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 8, marginBottom: 32 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D1D5DB' },
  dotOn: { backgroundColor: '#4F46E5', width: 24 },
  obEmoji: { fontSize: 52, marginBottom: 12 },
  obTitle: { fontSize: 26, fontWeight: '700', color: '#111827', textAlign: 'center', marginBottom: 6 },
  obSub: { fontSize: 16, color: '#6B7280', textAlign: 'center', marginBottom: 16 },
  descBox: { backgroundColor: '#EEF2FF', borderRadius: 12, padding: 14, marginBottom: 16, width: '100%' },
  descText: { color: '#4338CA', fontSize: 14, lineHeight: 22 },
  obInput: { width: '100%', backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 14, fontSize: 15, color: '#111827', marginBottom: 16 },
  obBtn: { width: '100%', backgroundColor: '#4F46E5', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 12 },
  obBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  obBack: { color: '#6B7280', fontSize: 15 },
  // Layout
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  screenHeader: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  screenTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },
  greeting: { fontSize: 20, fontWeight: '700', color: '#111827' },
  dateText: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  // Cards
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 8 },
  // Progress
  progBar: { height: 8, backgroundColor: '#E5E7EB', borderRadius: 4, marginVertical: 8 },
  progFill: { height: 8, backgroundColor: '#4F46E5', borderRadius: 4 },
  progText: { fontSize: 13, color: '#6B7280' },
  // Warn
  warnCard: { backgroundColor: '#FEF3C7', borderRadius: 12, padding: 14, marginBottom: 12 },
  warnText: { color: '#92400E', fontSize: 14 },
  // Tasks
  taskRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 6, elevation: 1 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#4F46E5', marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  checkboxDone: { backgroundColor: '#4F46E5' },
  taskText: { flex: 1, fontSize: 15, color: '#111827' },
  taskDone: { color: '#9CA3AF', textDecorationLine: 'line-through' },
  // Buttons
  btn: { backgroundColor: '#4F46E5', borderRadius: 12, padding: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  // Chat
  bubble: { flexDirection: 'row', marginVertical: 4, maxWidth: '85%' },
  bubbleAI: { alignSelf: 'flex-start', backgroundColor: '#F3F4F6', borderRadius: 16, padding: 12 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: '#4F46E5', borderRadius: 16, padding: 12 },
  bubbleText: { flex: 1, fontSize: 15, color: '#111827', lineHeight: 22 },
  inputRow: { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: '#E5E7EB', backgroundColor: '#fff', alignItems: 'flex-end' },
  chatInput: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#111827', maxHeight: 100 },
  sendBtn: { backgroundColor: '#4F46E5', borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  // Chips
  chip: { backgroundColor: '#EEF2FF', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 10, width: '100%', alignItems: 'center' },
  chipText: { color: '#4F46E5', fontWeight: '500', fontSize: 14 },
  // Modal
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: '#fff' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  // Tabs
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#F3F4F6', backgroundColor: '#fff', height: 60 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  tabLabelActive: { color: '#4F46E5', fontWeight: '600' },
});
