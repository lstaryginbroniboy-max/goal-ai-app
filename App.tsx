import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Modal, ActivityIndicator, KeyboardAvoidingView, Platform,
  SafeAreaView, Alert, Animated, Easing
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { storage, Goals, Task, Habit, HabitLog, MoodEntry, Commitment, todayString, ProviderId, ProviderSettings } from './services/storage';
import { sendMessage, sendSystemMessage, PROVIDERS } from './services/ai';
import { DAILY_CHECKIN_PROMPT, WEEKLY_REVIEW_PROMPT, EVENING_RITUAL_PROMPT, QUICK_WIN_PROMPT } from './constants/prompts';
import { CITIES, City, getCityTime } from './constants/cities';

type Screen = 'home' | 'chat' | 'goals' | 'habits' | 'settings' | 'onboarding' | 'stats';

// ─── Speech Recognition ───────────────────────────────────────────────────────
function useSpeech(
  onResult: (text: string) => void,
  opts?: { onStart?: () => void; onInterim?: (text: string) => void },
) {
  const [listening, setListening] = useState(false);
  const recRef     = useRef<any>(null);
  const finalAccum = useRef('');
  const pulse      = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (listening) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.3, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1,   duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
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
      Alert.alert('Не поддерживается', 'Голосовой ввод работает в Chrome или Яндекс браузере.');
      return;
    }
    const rec = new SR();
    rec.lang           = 'ru-RU';
    rec.continuous     = true;   // не останавливаться на паузах
    rec.interimResults = true;   // промежуточные результаты для превью
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      finalAccum.current = '';
      setListening(true);
      opts?.onStart?.();
    };

    rec.onresult = (e: any) => {
      let finals  = '';
      let interim = '';
      // собираем ВСЕ куски, не только первый
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) finals  += e.results[i][0].transcript + ' ';
        else                       interim += e.results[i][0].transcript;
      }
      finalAccum.current = finals;
      opts?.onInterim?.(finals + interim);
    };

    rec.onend = () => {
      setListening(false);
      const result = finalAccum.current.trim();
      if (result) onResult(result);
      finalAccum.current = '';
    };

    rec.onerror = (e: any) => {
      // 'no-speech' — нормальная пауза, не останавливаем запись
      if (e.error === 'no-speech') return;
      setListening(false);
      const result = finalAccum.current.trim();
      if (result) onResult(result);
      finalAccum.current = '';
    };

    rec.start();
    recRef.current = rec;
  }, [onResult, opts]);

  const stop = useCallback(() => {
    recRef.current?.stop(); // onend сам доставит результат
  }, []);

  return { listening, start, stop, pulse };
}

// ─── Text-to-Speech ───────────────────────────────────────────────────────────
function useTTS() {
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);

  function speak(text: string, idx: number) {
    const synth = (globalThis as any).speechSynthesis;
    if (!synth) return;
    if (speakingIdx === idx) { synth.cancel(); setSpeakingIdx(null); return; }
    synth.cancel();
    const utt = new (globalThis as any).SpeechSynthesisUtterance(text);
    utt.lang  = 'ru-RU';
    utt.rate  = 1.0;
    utt.pitch = 1.0;
    utt.onstart = () => setSpeakingIdx(idx);
    utt.onend   = () => setSpeakingIdx(null);
    utt.onerror = () => setSpeakingIdx(null);
    synth.speak(utt);
  }

  function stop() { (globalThis as any).speechSynthesis?.cancel(); setSpeakingIdx(null); }

  return { speakingIdx, speak, stop };
}

// ─── Mic Button ───────────────────────────────────────────────────────────────
function MicButton({
  onText,
  onStart,
  onInterim,
}: {
  onText: (t: string) => void;
  onStart?: () => void;
  onInterim?: (t: string) => void;
}) {
  const opts = useRef({ onStart, onInterim });
  opts.current = { onStart, onInterim };
  const { listening, start, stop, pulse } = useSpeech(onText, opts.current);
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

const GOAL_STEPS = [
  { key: 'day',      emoji: '☀️', title: 'Что сделать сегодня?',      sub: 'Одно-три дела, которые реально сдвинут тебя вперёд прямо сейчас' },
  { key: 'week',     emoji: '📋', title: 'Фокус этой недели',          sub: 'Что должно быть сделано к концу недели, чтобы ты остался доволен?' },
  { key: 'month',    emoji: '📅', title: 'Цель месяца',                sub: 'Какой результат через 30 дней скажет тебе: «Не зря старался»?' },
  { key: 'year',     emoji: '🎯', title: 'Кем ты станешь за год?',     sub: 'Через 12 месяцев — что изменится в твоей жизни, карьере, здоровье?' },
  { key: 'fiveYear', emoji: '🚀', title: 'Твоя жизнь через 5 лет',     sub: 'Закрой глаза. Ты добился всего. Кто ты? Где живёшь? Чем занимаешься?' },
];

// ─── Onboarding ───────────────────────────────────────────────────────────────
function OnboardingScreen({ onDone }: { onDone: () => void }) {
  // step 0 = выбор провайдера, 1..5 = цели
  const [step, setStep] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [goalVals, setGoalVals] = useState<Record<string, string>>(
    Object.fromEntries(GOAL_STEPS.map(s => [s.key, '']))
  );
  const totalSteps = 1 + GOAL_STEPS.length;
  const isLast = step === totalSteps - 1;

  async function next() {
    if (step === 0) {
      if (!selectedProvider) { Alert.alert('Выбери ИИ провайдера'); return; }
      if (!apiKey.trim()) { Alert.alert('Введи API ключ'); return; }
      // Save under the explicitly selected provider, not auto-detected
      const ps = await storage.getProviderSettings();
      ps.keys[selectedProvider as ProviderId] = apiKey.trim();
      ps.activeProvider = selectedProvider as ProviderId;
      await storage.saveProviderSettings(ps);
      setStep(1);
      return;
    }
    if (isLast) {
      const goals: Goals = {
        day:      goalVals.day.split('\n').map(s => s.trim()).filter(Boolean),
        week:     goalVals.week.split('\n').map(s => s.trim()).filter(Boolean),
        month:    goalVals.month.split('\n').map(s => s.trim()).filter(Boolean),
        year:     goalVals.year.split('\n').map(s => s.trim()).filter(Boolean),
        fiveYear: goalVals.fiveYear.split('\n').map(s => s.trim()).filter(Boolean),
      };
      await storage.saveGoals(goals);
      await storage.setOnboarded();
      onDone();
    } else {
      setStep(s => s + 1);
    }
  }

  const goalStep = step > 0 ? GOAL_STEPS[step - 1] : null;

  return (
    <SafeAreaView style={st.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'android' ? undefined : 'padding'}>
        <ScrollView contentContainerStyle={st.obWrap} keyboardShouldPersistTaps="handled">

          {/* Progress dots */}
          <View style={st.dots}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <View key={i} style={[st.dot, i <= step && st.dotActive]} />
            ))}
          </View>

          {/* ── Step 0: Provider picker ── */}
          {step === 0 && (
            <>
              <Text style={st.obEmoji}>🤖</Text>
              <Text style={st.obTitle}>Выбери ИИ-помощника</Text>
              <Text style={st.obSub}>Все варианты поддерживают русский язык</Text>

              {PROVIDERS.map(p => {
                const isSelected = selectedProvider === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[st.provCard, isSelected && st.provCardActive]}
                    onPress={() => { setSelectedProvider(p.id); setApiKey(''); }}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827', flex: 1 }}>{p.name}</Text>
                      <View style={[st.badge, { backgroundColor: p.badgeColor }]}>
                        <Text style={{ fontSize: 11, fontWeight: '600', color: '#374151' }}>{p.badge}</Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 13, color: '#6B7280' }}>🔗 {p.desc}</Text>
                    <Text style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>{p.keyHint}</Text>

                    {isSelected && (
                      <View style={{ marginTop: 12 }}>
                        <TextInput
                          style={[st.obInput, { marginBottom: 0 }]}
                          value={apiKey}
                          onChangeText={setApiKey}
                          placeholder={p.keyPlaceholder}
                          placeholderTextColor="#9CA3AF"
                          secureTextEntry
                          autoCapitalize="none"
                          autoFocus
                        />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}

              <View style={{ height: 8 }} />
            </>
          )}

          {/* ── Steps 1-5: Goals ── */}
          {goalStep && (
            <>
              <Text style={st.obEmoji}>{goalStep.emoji}</Text>
              <Text style={st.obTitle}>{goalStep.title}</Text>
              <Text style={st.obSub}>{goalStep.sub}</Text>
              <View style={st.voiceInputWrap}>
                <TextInput
                  style={[st.obInput, { minHeight: 110, textAlignVertical: 'top', flex: 1, marginBottom: 0 }]}
                  value={goalVals[goalStep.key]}
                  onChangeText={v => setGoalVals(p => ({ ...p, [goalStep.key]: v }))}
                  placeholder={'Каждая цель — отдельная строка\nНапример: выучить английский'}
                  placeholderTextColor="#9CA3AF"
                  multiline
                />
                <View style={{ justifyContent: 'flex-end', paddingLeft: 8, paddingBottom: 4 }}>
                  <MicButton onText={t => setGoalVals(p => ({
                    ...p,
                    [goalStep.key]: p[goalStep.key] ? p[goalStep.key] + '\n' + t : t,
                  }))} />
                </View>
              </View>
              <Text style={{ color: '#9CA3AF', fontSize: 12, alignSelf: 'flex-start', marginBottom: 8 }}>
                🎤 Нажми микрофон чтобы надиктовать
              </Text>
            </>
          )}

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

// ─── Pomodoro Timer ───────────────────────────────────────────────────────────
const POMO_PHASES = [
  { name: 'Фокус',  duration: 25 * 60, color: '#4F46E5', bg: '#EEF2FF', emoji: '🎯' },
  { name: 'Пауза',  duration:  5 * 60, color: '#10B981', bg: '#D1FAE5', emoji: '☕' },
];

function PomodoroTimer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [phase,    setPhase]    = useState(0);
  const [timeLeft, setTimeLeft] = useState(POMO_PHASES[0].duration);
  const [running,  setRunning]  = useState(false);
  const [sessions, setSessions] = useState(0);
  const ivRef = useRef<any>(null);

  useEffect(() => {
    if (running) {
      ivRef.current = setInterval(() => {
        setTimeLeft(t => {
          if (t > 1) return t - 1;
          clearInterval(ivRef.current);
          const next = (phase + 1) % 2;
          if (next === 0) setSessions(s => s + 1);
          setPhase(next);
          setTimeLeft(POMO_PHASES[next].duration);
          setRunning(false);
          return POMO_PHASES[next].duration;
        });
      }, 1000);
    } else {
      clearInterval(ivRef.current);
    }
    return () => clearInterval(ivRef.current);
  }, [running, phase]);

  const cur  = POMO_PHASES[phase];
  const mins = Math.floor(timeLeft / 60).toString().padStart(2, '0');
  const secs = (timeLeft % 60).toString().padStart(2, '0');
  const pct  = ((cur.duration - timeLeft) / cur.duration) * 100;

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 28 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#111827' }}>⏱ Помодоро</Text>
              <TouchableOpacity onPress={onClose}>
                <Text style={{ fontSize: 24, color: '#9CA3AF' }}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={{ backgroundColor: cur.bg, borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: cur.color, marginBottom: 8 }}>
                {cur.emoji} {cur.name}
              </Text>
              <Text style={{ fontSize: 72, fontWeight: '800', color: cur.color, letterSpacing: 2 }}>
                {mins}:{secs}
              </Text>
              <View style={{ width: '100%', height: 8, backgroundColor: '#fff', borderRadius: 4, marginTop: 16 }}>
                <View style={{ width: `${pct}%` as any, height: 8, backgroundColor: cur.color, borderRadius: 4 }} />
              </View>
            </View>

            <Text style={{ textAlign: 'center', color: '#6B7280', marginBottom: 20, fontSize: 14 }}>
              🏆 Завершено сессий: <Text style={{ fontWeight: '700', color: '#111827' }}>{sessions}</Text>
            </Text>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: running ? '#FEE2E2' : cur.color,
                  borderRadius: 14, padding: 15, alignItems: 'center' }}
                onPress={() => setRunning(!running)}>
                <Text style={{ color: running ? '#DC2626' : '#fff', fontSize: 16, fontWeight: '700' }}>
                  {running ? '⏸ Пауза' : '▶ Старт'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ width: 50, backgroundColor: '#F3F4F6', borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => { setRunning(false); setTimeLeft(cur.duration); }}>
                <Text style={{ fontSize: 22 }}>↺</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              {POMO_PHASES.map((p, i) => (
                <TouchableOpacity key={i} onPress={() => { setPhase(i); setTimeLeft(p.duration); setRunning(false); }}
                  style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: phase === i ? p.bg : '#F9FAFB',
                    borderWidth: 1.5, borderColor: phase === i ? p.color : '#E5E7EB', alignItems: 'center' }}>
                  <Text style={{ fontSize: 16 }}>{p.emoji}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: phase === i ? p.color : '#6B7280', marginTop: 2 }}>
                    {p.name} {p.duration / 60} мин
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ height: 8 }} />
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────
const MOOD_EMOJIS   = ['😞', '😕', '😐', '😊', '🤩'];
const ENERGY_ICONS  = ['🪫', '🔋', '⚡', '⚡⚡', '🚀'];
type CheckinType = 'daily' | 'weekly' | 'evening';

function HomeScreen({ onSettings, onStats }: { onSettings: () => void; onStats: () => void }) {
  const [tasks,          setTasks]          = useState<Task[]>([]);
  const [hasKey,         setHasKey]         = useState(false);
  const [showCheckin,    setShowCheckin]    = useState(false);
  const [checkinType,    setCheckinType]    = useState<CheckinType>('daily');
  const [msgs,           setMsgs]           = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input,          setInput]          = useState('');
  const [loading,        setLoading]        = useState(false);
  const [todayMood,      setTodayMood]      = useState<MoodEntry | null>(null);
  const [draftMood,      setDraftMood]      = useState<{ mood: number; energy: number }>({ mood: 0, energy: 0 });
  const [quickWin,       setQuickWin]       = useState('');
  const [quickWinLoad,   setQuickWinLoad]   = useState(false);
  const [checkinPending, setCheckinPending] = useState(false);
  const [weeklyPending,  setWeeklyPending]  = useState(false);
  const [pomoVisible,    setPomoVisible]    = useState(false);
  const [weekDone,       setWeekDone]       = useState(0);
  const [topStreak,      setTopStreak]      = useState(0);
  const scrollRef    = useRef<ScrollView>(null);
  const voiceBaseRef = useRef('');
  const tts          = useTTS();

  const h       = new Date().getHours();
  const greet   = h < 5 ? 'Доброй ночи 🌙' : h < 12 ? 'Доброе утро ☀️' : h < 17 ? 'Добрый день 🌤' : 'Добрый вечер 🌙';
  const dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const isEvening = h >= 19;

  useEffect(() => { init(); }, []);

  async function init() {
    const key = await storage.getApiKey();
    setHasKey(!!key);

    const all = await storage.getTasks();
    setTasks(all.filter(t => t.date === todayString()));

    // Weekly stats
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekTasks = all.filter(t => new Date(t.date) >= weekAgo);
    setWeekDone(weekTasks.filter(t => t.done).length);

    // Top habit streak
    const [habits, logs] = await Promise.all([storage.getHabits(), storage.getHabitLogs()]);
    const maxStreak = habits.reduce((m, h) => Math.max(m, calcStreak(h.id, logs)), 0);
    setTopStreak(maxStreak);

    const mood = await storage.getTodayMood();
    setTodayMood(mood);

    if (!key) return;

    // Проверяем чек-ин — только флаг, без API-запроса
    const lastCheckin = await storage.getLastCheckin();
    if (lastCheckin !== todayString()) {
      setCheckinPending(true);
    }

    // Проверяем еженедельный разбор — только флаг
    const lastWeekly = await storage.getLastWeeklyReview();
    if (!lastWeekly) {
      await storage.setLastWeeklyReview(todayString());
    } else if ((Date.now() - new Date(lastWeekly).getTime()) / 86400000 >= 7) {
      setWeeklyPending(true);
    }
  }

  async function generateQuickWin() {
    setQuickWinLoad(true);
    const goals = await storage.getGoals();
    const r = await sendSystemMessage(QUICK_WIN_PROMPT(goals));
    if (r) setQuickWin(r.replace(/^⚡\s*/, '').trim());
    setQuickWinLoad(false);
  }

  async function startCheckin(type: CheckinType) {
    setLoading(true);
    const goals = await storage.getGoals();
    let reply = '';
    if (type === 'daily') {
      reply = await sendSystemMessage(DAILY_CHECKIN_PROMPT(goals));
    } else if (type === 'weekly') {
      const all = await storage.getTasks();
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      const wt = all.filter(t => new Date(t.date) >= weekAgo);
      reply = await sendSystemMessage(WEEKLY_REVIEW_PROMPT(goals, wt.filter(t=>t.done).length, wt.length));
    } else {
      const all = await storage.getTasks();
      const todayTasks = all.filter(t => t.date === todayString());
      reply = await sendSystemMessage(EVENING_RITUAL_PROMPT(goals, todayTasks.length, todayTasks.filter(t=>t.done).length));
    }
    const fallbacks: Record<CheckinType, string> = {
      daily:   'Привет! Как прошёл вчерашний день?',
      weekly:  'Привет! Давай разберём твою неделю.',
      evening: 'Добрый вечер! Как прошёл день?',
    };
    setMsgs([{ role: 'assistant', content: reply || fallbacks[type] }]);
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
    const lines = reply.split('\n').filter(l => l.match(/✅|^\d+\./));
    if (lines.length && checkinType !== 'evening') {
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
    if (checkinType === 'daily')  await storage.setLastCheckin(todayString());
    if (checkinType === 'weekly') await storage.setLastWeeklyReview(todayString());
    setShowCheckin(false); setMsgs([]);
  }

  async function toggleTask(id: string) {
    await storage.toggleTask(id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  }

  async function saveMood() {
    if (!draftMood.mood || !draftMood.energy) return;
    const entry: MoodEntry = { date: todayString(), mood: draftMood.mood, energy: draftMood.energy };
    await storage.saveMoodEntry(entry);
    setTodayMood(entry);
  }

  function openCheckin(type: CheckinType) {
    if (type === 'daily')  setCheckinPending(false);
    if (type === 'weekly') setWeeklyPending(false);
    setCheckinType(type); setMsgs([]); setShowCheckin(true); startCheckin(type);
  }

  const done        = tasks.filter(t => t.done).length;
  const checkinTitle: Record<CheckinType, string> = {
    daily: '☀️ Утренний чек-ин', weekly: '📊 Разбор недели', evening: '🌙 Вечерний ритуал',
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F0F2FF' }}>

      {/* ── Gradient-style header ── */}
      <View style={st.homeHeader}>
        <View style={{ flex: 1 }}>
          <Text style={st.homeGreet}>{greet}</Text>
          <Text style={st.homeDate}>{dateStr}</Text>
        </View>
        <TouchableOpacity onPress={() => setPomoVisible(true)}
          style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: 8 }}>
          <Text style={{ fontSize: 20 }}>⏱</Text>
        </TouchableOpacity>
      </View>

      {/* ── Stats row ── */}
      <View style={st.statsRow}>
        <View style={[st.statBox, { backgroundColor: '#EEF2FF' }]}>
          <Text style={[st.statNum, { color: '#4F46E5' }]}>{done}/{tasks.length}</Text>
          <Text style={st.statLabel}>задач сегодня</Text>
        </View>
        <View style={[st.statBox, { backgroundColor: '#FEF3C7' }]}>
          <Text style={[st.statNum, { color: '#D97706' }]}>{weekDone}</Text>
          <Text style={st.statLabel}>за неделю</Text>
        </View>
        <View style={[st.statBox, { backgroundColor: '#FEE2E2' }]}>
          <Text style={[st.statNum, { color: '#DC2626' }]}>{topStreak > 0 ? `🔥${topStreak}` : '—'}</Text>
          <Text style={st.statLabel}>лучший стрик</Text>
        </View>
        {todayMood && (
          <View style={[st.statBox, { backgroundColor: '#D1FAE5' }]}>
            <Text style={[st.statNum, { color: '#059669' }]}>{MOOD_EMOJIS[todayMood.mood - 1]}</Text>
            <Text style={st.statLabel}>настроение</Text>
          </View>
        )}
      </View>

      {/* ── Quick action bar ── */}
      <View style={st.actionBar}>
        <TouchableOpacity style={st.actionBarBtn} onPress={() => openCheckin('daily')}>
          <Text style={{ fontSize: 18 }}>☀️</Text>
          <Text style={st.actionBarLabel}>Чек-ин</Text>
        </TouchableOpacity>
        <View style={st.actionBarDivider} />
        <TouchableOpacity style={st.actionBarBtn} onPress={() => openCheckin('evening')}>
          <Text style={{ fontSize: 18 }}>🌙</Text>
          <Text style={st.actionBarLabel}>Вечер</Text>
        </TouchableOpacity>
        <View style={st.actionBarDivider} />
        <TouchableOpacity style={st.actionBarBtn} onPress={() => openCheckin('weekly')}>
          <Text style={{ fontSize: 18 }}>📊</Text>
          <Text style={st.actionBarLabel}>Неделя</Text>
        </TouchableOpacity>
        <View style={st.actionBarDivider} />
        <TouchableOpacity style={st.actionBarBtn} onPress={onStats}>
          <Text style={{ fontSize: 18 }}>📈</Text>
          <Text style={st.actionBarLabel}>Прогресс</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[st.content, { paddingBottom: 80 }]}>
        {!hasKey && (
          <TouchableOpacity style={st.warnCard} onPress={onSettings}>
            <Text style={st.warnText}>⚠️ Добавь API ключ в настройках — нажми сюда →</Text>
          </TouchableOpacity>
        )}

        {/* Pending checkin banner */}
        {checkinPending && hasKey && (
          <TouchableOpacity style={[st.card, { borderLeftWidth: 4, borderLeftColor: '#4F46E5', flexDirection: 'row', alignItems: 'center' }]}
            onPress={() => openCheckin('daily')}>
            <Text style={{ fontSize: 24, marginRight: 12 }}>☀️</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: '#4F46E5', fontSize: 14 }}>Начать утренний чек-ин</Text>
              <Text style={{ color: '#6B7280', fontSize: 12, marginTop: 2 }}>Макс ждёт — нажми чтобы начать</Text>
            </View>
            <Text style={{ fontSize: 18, color: '#4F46E5' }}>→</Text>
          </TouchableOpacity>
        )}

        {/* Pending weekly banner */}
        {weeklyPending && hasKey && (
          <TouchableOpacity style={[st.card, { borderLeftWidth: 4, borderLeftColor: '#7C3AED', flexDirection: 'row', alignItems: 'center' }]}
            onPress={() => openCheckin('weekly')}>
            <Text style={{ fontSize: 24, marginRight: 12 }}>📊</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: '#7C3AED', fontSize: 14 }}>Разбор недели готов</Text>
              <Text style={{ color: '#6B7280', fontSize: 12, marginTop: 2 }}>Прошло 7 дней — нажми для анализа</Text>
            </View>
            <Text style={{ fontSize: 18, color: '#7C3AED' }}>→</Text>
          </TouchableOpacity>
        )}

        {/* Quick win — on demand */}
        {quickWin ? (
          <View style={[st.card, { borderLeftWidth: 4, borderLeftColor: '#F59E0B' }]}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#D97706', marginBottom: 6, letterSpacing: 0.5 }}>
              ⚡ БЫСТРАЯ ПОБЕДА · 5 МИН
            </Text>
            <Text style={{ fontSize: 15, color: '#111827', lineHeight: 22 }}>{quickWin}</Text>
            <TouchableOpacity onPress={() => { setQuickWin(''); }} style={{ marginTop: 8, alignSelf: 'flex-start' }}>
              <Text style={{ fontSize: 12, color: '#9CA3AF' }}>↺ Другую задачу</Text>
            </TouchableOpacity>
          </View>
        ) : hasKey ? (
          <TouchableOpacity style={[st.card, { borderLeftWidth: 4, borderLeftColor: '#F59E0B', flexDirection: 'row', alignItems: 'center' }]}
            onPress={generateQuickWin} disabled={quickWinLoad}>
            <Text style={{ fontSize: 24, marginRight: 12 }}>⚡</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: '#D97706', fontSize: 14 }}>Быстрая победа</Text>
              <Text style={{ color: '#6B7280', fontSize: 12, marginTop: 2 }}>Задача на 5 минут от Макса</Text>
            </View>
            {quickWinLoad
              ? <ActivityIndicator color="#D97706" size="small" />
              : <Text style={{ fontSize: 18, color: '#D97706' }}>→</Text>
            }
          </TouchableOpacity>
        ) : null}

        {/* Mood tracker */}
        {!todayMood ? (
          <View style={[st.card, { borderLeftWidth: 4, borderLeftColor: '#8B5CF6' }]}>
            <Text style={st.sectionPill}>🌡️ Как ты сегодня?</Text>
            <Text style={{ color: '#6B7280', fontSize: 13, marginBottom: 10 }}>Настроение</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
              {MOOD_EMOJIS.map((e, i) => (
                <TouchableOpacity key={i} onPress={() => setDraftMood(p => ({ ...p, mood: i + 1 }))}
                  style={{ alignItems: 'center', padding: 6, borderRadius: 12,
                    backgroundColor: draftMood.mood === i + 1 ? '#EEF2FF' : 'transparent' }}>
                  <Text style={{ fontSize: 28 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: '#6B7280', fontSize: 13, marginBottom: 10 }}>Энергия</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
              {ENERGY_ICONS.map((e, i) => (
                <TouchableOpacity key={i} onPress={() => setDraftMood(p => ({ ...p, energy: i + 1 }))}
                  style={{ alignItems: 'center', padding: 8, borderRadius: 12,
                    backgroundColor: draftMood.energy === i + 1 ? '#EEF2FF' : 'transparent' }}>
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[st.primaryBtn, (!draftMood.mood || !draftMood.energy) && { backgroundColor: '#C7D2FE' }]}
              onPress={saveMood} disabled={!draftMood.mood || !draftMood.energy}>
              <Text style={st.primaryBtnText}>Сохранить</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[st.card, { flexDirection: 'row', alignItems: 'center', borderLeftWidth: 4, borderLeftColor: '#8B5CF6' }]}>
            <Text style={{ fontSize: 30, marginRight: 12 }}>{MOOD_EMOJIS[todayMood.mood - 1]}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: '#111827' }}>Самочувствие сегодня</Text>
              <Text style={{ color: '#6B7280', fontSize: 13, marginTop: 2 }}>
                {MOOD_EMOJIS[todayMood.mood - 1]} настроение  ·  {ENERGY_ICONS[todayMood.energy - 1]} энергия
              </Text>
            </View>
            <TouchableOpacity onPress={() => setTodayMood(null)}>
              <Text style={{ color: '#9CA3AF', fontSize: 12 }}>изменить</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Tasks */}
        <View style={[st.card, { borderLeftWidth: 4, borderLeftColor: '#4F46E5' }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={st.cardTitle}>✅ Задачи на сегодня</Text>
            <Text style={{ fontSize: 13, color: '#6B7280' }}>{done} / {tasks.length}</Text>
          </View>
          <View style={st.progBar}>
            <View style={[st.progFill, { width: tasks.length ? `${(done / tasks.length) * 100}%` as any : '0%' }]} />
          </View>
        </View>

        {tasks.length === 0 ? (
          <View style={[st.card, { alignItems: 'center', paddingVertical: 28 }]}>
            <Text style={{ fontSize: 44, marginBottom: 10 }}>🤖</Text>
            <Text style={[st.cardTitle, { textAlign: 'center', marginBottom: 6 }]}>Нет задач на сегодня</Text>
            <Text style={{ color: '#6B7280', textAlign: 'center', marginBottom: 18, fontSize: 14 }}>
              Пройди утренний чек-ин — коуч составит план
            </Text>
            <TouchableOpacity style={st.primaryBtn} onPress={() => openCheckin('daily')}>
              <Text style={st.primaryBtnText}>☀️ Начать чек-ин</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
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
          <View style={[st.card, { backgroundColor: '#D1FAE5', alignItems: 'center' }]}>
            <Text style={{ fontSize: 36, marginBottom: 4 }}>🏆</Text>
            <Text style={{ fontWeight: '800', color: '#065F46', fontSize: 16 }}>Все задачи выполнены!</Text>
            <Text style={{ color: '#047857', marginTop: 4, fontSize: 14 }}>Ты сегодня огонь 🔥</Text>
          </View>
        )}

      </ScrollView>

      <PomodoroTimer visible={pomoVisible} onClose={() => setPomoVisible(false)} />

      {/* Checkin Modal */}
      <Modal visible={showCheckin} animationType="slide" transparent={false} onRequestClose={closeCheckin}>
        <SafeAreaView style={st.safe}>
          <View style={[st.modalHeader, { backgroundColor: '#4F46E5' }]}>
            <TouchableOpacity onPress={closeCheckin} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: '#fff', fontSize: 20 }}>←</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 15 }}>Назад</Text>
            </TouchableOpacity>
            <Text style={[st.modalTitle, { color: '#fff', fontSize: 16 }]}>{checkinTitle[checkinType]}</Text>
            <TouchableOpacity onPress={closeCheckin}
              style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Готово</Text>
            </TouchableOpacity>
          </View>
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 20 }}>
            {msgs.map((m, i) => (
              <View key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', marginVertical: 4 }}>
                <View style={[st.bubble, m.role === 'user' ? st.bubbleUser : st.bubbleAI, { marginVertical: 0, alignSelf: 'stretch' }]}>
                  {m.role === 'assistant' && <Text style={{ fontSize: 20, marginRight: 8 }}>🤖</Text>}
                  <Text style={[st.bubbleText, m.role === 'user' && { color: '#fff' }]}>{m.content}</Text>
                </View>
                {m.role === 'assistant' && (
                  <TouchableOpacity onPress={() => tts.speak(m.content, i)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8, paddingTop: 4 }}>
                    <Text style={{ fontSize: 14 }}>{tts.speakingIdx === i ? '⏹' : '🔊'}</Text>
                    <Text style={{ fontSize: 11, color: '#9CA3AF' }}>{tts.speakingIdx === i ? 'Стоп' : 'Вслух'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {loading && (
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                <ActivityIndicator color="#4F46E5" size="small" />
                <Text style={{ color: '#6B7280', marginLeft: 8 }}>Коуч думает...</Text>
              </View>
            )}
          </ScrollView>
          <KeyboardAvoidingView behavior={Platform.OS === 'android' ? undefined : 'padding'}>
            <View style={st.inputRow}>
              <MicButton
                onStart={() => { voiceBaseRef.current = input; }}
                onInterim={t => setInput(voiceBaseRef.current + (voiceBaseRef.current && t ? ' ' : '') + t)}
                onText={t => setInput(voiceBaseRef.current + (voiceBaseRef.current && t ? ' ' : '') + t)}
              />
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
  const [msgs,         setMsgs]         = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input,        setInput]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [providerName, setProviderName] = useState('Коуч');
  const scrollRef    = useRef<ScrollView>(null);
  const voiceBaseRef = useRef('');
  const tts          = useTTS();

  useEffect(() => {
    storage.getProviderSettings().then(ps => {
      const p = PROVIDERS.find(p => p.id === ps.activeProvider);
      if (p) setProviderName(p.name);
    });
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

  async function clearChat() {
    Alert.alert('Новый диалог', 'Очистить историю переписки с этим ИИ?', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Очистить', style: 'destructive', onPress: async () => {
        await storage.clearHistory();
        setMsgs([]);
      }},
    ]);
  }

  const CHIPS = ['Дай задачи на сегодня', 'Как достичь моих целей?', 'Мотивируй меня!'];

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={[st.screenHeader, { flexDirection: 'row', alignItems: 'center' }]}>
        <View style={{ flex: 1 }}>
          <Text style={st.screenTitle}>🤖 {providerName}</Text>
          <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>Личный коуч · своя история для каждого ИИ</Text>
        </View>
        {msgs.length > 0 && (
          <TouchableOpacity onPress={clearChat}
            style={{ backgroundColor: '#FEE2E2', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ fontSize: 13, color: '#DC2626', fontWeight: '700' }}>🗑 Новый</Text>
          </TouchableOpacity>
        )}
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'android' ? undefined : 'padding'} keyboardVerticalOffset={80}>
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
              <View key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', marginVertical: 4 }}>
                <View style={[st.bubble, m.role === 'user' ? st.bubbleUser : st.bubbleAI, { marginVertical: 0, alignSelf: 'stretch' }]}>
                  {m.role === 'assistant' && <Text style={{ fontSize: 20, marginRight: 8 }}>🤖</Text>}
                  <Text style={[st.bubbleText, m.role === 'user' && { color: '#fff' }]}>{m.content}</Text>
                </View>
                {m.role === 'assistant' && (
                  <TouchableOpacity onPress={() => tts.speak(m.content, i)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8, paddingTop: 4 }}>
                    <Text style={{ fontSize: 14 }}>{tts.speakingIdx === i ? '⏹' : '🔊'}</Text>
                    <Text style={{ fontSize: 11, color: '#9CA3AF' }}>{tts.speakingIdx === i ? 'Стоп' : 'Вслух'}</Text>
                  </TouchableOpacity>
                )}
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
          <MicButton
            onStart={() => { voiceBaseRef.current = input; }}
            onInterim={t => setInput(voiceBaseRef.current + (voiceBaseRef.current && t ? ' ' : '') + t)}
            onText={t => setInput(voiceBaseRef.current + (voiceBaseRef.current && t ? ' ' : '') + t)}
          />
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

// ─── Habits ───────────────────────────────────────────────────────────────────
const HABIT_EMOJIS = ['⭐','💪','📚','🏃','🧘','💧','🥗','😴','✍️','🎯','🧠','❤️','🎸','💰','🌿','🚫','📵','🧹','🛁','🙏'];

function calcStreak(habitId: string, logs: HabitLog[]): number {
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 365; i++) {
    const ds = d.toISOString().split('T')[0];
    if (logs.some(l => l.habitId === habitId && l.date === ds)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else { break; }
  }
  return streak;
}

function getLast14(habitId: string, logs: HabitLog[]): boolean[] {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return logs.some(l => l.habitId === habitId && l.date === d.toISOString().split('T')[0]);
  });
}

function pluralDays(n: number) {
  if (n === 1) return 'день';
  if (n < 5) return 'дня';
  return 'дней';
}

function HabitsScreen() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('⭐');
  const today = todayString();

  useEffect(() => {
    Promise.all([storage.getHabits(), storage.getHabitLogs()]).then(([h, l]) => {
      setHabits(h); setLogs(l);
    });
  }, []);

  async function toggleHabit(habitId: string) {
    const updated = await storage.toggleHabitLog(habitId, today);
    setLogs(updated);
  }

  async function addHabit() {
    if (!newName.trim()) return;
    const habit: Habit = { id: Date.now().toString(), name: newName.trim(), emoji: newEmoji };
    const updated = [...habits, habit];
    await storage.saveHabits(updated);
    setHabits(updated);
    setNewName(''); setNewEmoji('⭐'); setShowAdd(false);
  }

  async function deleteHabit(id: string) {
    Alert.alert('Удалить привычку?', 'История отметок тоже удалится.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: async () => {
        const updated = habits.filter(h => h.id !== id);
        await storage.saveHabits(updated);
        setHabits(updated);
      }},
    ]);
  }

  const todayDone = habits.filter(h => logs.some(l => l.habitId === h.id && l.date === today)).length;

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={st.topBar}>
        <Text style={st.screenTitle}>🔗 Привычки</Text>
        <TouchableOpacity onPress={() => setShowAdd(true)}>
          <Text style={{ fontSize: 30, color: '#4F46E5', lineHeight: 34 }}>+</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[st.content, { gap: 10 }]}>
        {habits.length > 0 && (
          <View style={[st.card, { flexDirection: 'row', alignItems: 'center' }]}>
            <Text style={{ fontSize: 32, marginRight: 12 }}>
              {todayDone === habits.length ? '🏆' : '🎯'}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', fontSize: 16, color: '#111827' }}>
                {todayDone === habits.length ? 'Все привычки выполнены!' : `Сегодня: ${todayDone} из ${habits.length}`}
              </Text>
              <View style={st.progBar}>
                <View style={[st.progFill, { width: `${habits.length ? (todayDone / habits.length) * 100 : 0}%` as any }]} />
              </View>
            </View>
          </View>
        )}

        {habits.length === 0 ? (
          <View style={[st.card, { alignItems: 'center', paddingVertical: 40 }]}>
            <Text style={{ fontSize: 52, marginBottom: 12 }}>🌱</Text>
            <Text style={[st.cardTitle, { textAlign: 'center' }]}>Нет привычек</Text>
            <Text style={{ color: '#6B7280', textAlign: 'center', marginTop: 4, marginBottom: 20 }}>
              Добавь первую привычку — нажми + вверху
            </Text>
            <TouchableOpacity style={st.primaryBtn} onPress={() => setShowAdd(true)}>
              <Text style={st.primaryBtnText}>+ Добавить привычку</Text>
            </TouchableOpacity>
          </View>
        ) : (
          habits.map(habit => {
            const streak = calcStreak(habit.id, logs);
            const last14 = getLast14(habit.id, logs);
            const doneToday = logs.some(l => l.habitId === habit.id && l.date === today);
            return (
              <View key={habit.id} style={[st.card, doneToday && { borderWidth: 1.5, borderColor: '#10B981' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <Text style={{ fontSize: 30, marginRight: 12 }}>{habit.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>{habit.name}</Text>
                    <Text style={{ fontSize: 13, color: streak > 0 ? '#F59E0B' : '#9CA3AF', marginTop: 2 }}>
                      {streak > 0 ? `🔥 ${streak} ${pluralDays(streak)} подряд` : 'Начни сегодня!'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
                      doneToday ? { backgroundColor: '#D1FAE5' } : { backgroundColor: '#F3F4F6', borderWidth: 2, borderColor: '#E5E7EB' }]}
                    onPress={() => toggleHabit(habit.id)}>
                    <Text style={{ fontSize: 22 }}>{doneToday ? '✅' : '◯'}</Text>
                  </TouchableOpacity>
                </View>
                {/* 14-day mini calendar */}
                <View style={{ flexDirection: 'row', gap: 3, marginBottom: 4 }}>
                  {last14.map((done, i) => (
                    <View key={i} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: done ? '#4F46E5' : '#E5E7EB' }} />
                  ))}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, color: '#9CA3AF' }}>последние 14 дней</Text>
                  <TouchableOpacity onPress={() => deleteHabit(habit.id)}>
                    <Text style={{ fontSize: 12, color: '#EF4444' }}>удалить</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Add habit modal */}
      <Modal visible={showAdd} animationType="slide" transparent onRequestClose={() => setShowAdd(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'android' ? undefined : 'padding'}>
            <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={st.modalTitle}>Новая привычка</Text>
                <TouchableOpacity onPress={() => setShowAdd(false)}>
                  <Text style={{ fontSize: 22, color: '#6B7280' }}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={st.fieldLabel}>Иконка</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                {HABIT_EMOJIS.map(e => (
                  <TouchableOpacity key={e} onPress={() => setNewEmoji(e)}
                    style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
                      marginRight: 8, backgroundColor: newEmoji === e ? '#EEF2FF' : '#F3F4F6',
                      borderWidth: newEmoji === e ? 2 : 0, borderColor: '#4F46E5' }}>
                    <Text style={{ fontSize: 22 }}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={st.fieldLabel}>Название</Text>
              <TextInput
                style={[st.obInput, { marginBottom: 16 }]}
                value={newName} onChangeText={setNewName}
                placeholder="Например: Пить 2л воды" placeholderTextColor="#9CA3AF" autoFocus
              />
              <TouchableOpacity style={st.primaryBtn} onPress={addHabit}>
                <Text style={st.primaryBtnText}>Добавить привычку</Text>
              </TouchableOpacity>
              <View style={{ height: 8 }} />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const GOAL_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  day:      { border: '#F59E0B', bg: '#FFFBEB', text: '#92400E' },
  week:     { border: '#10B981', bg: '#ECFDF5', text: '#065F46' },
  month:    { border: '#3B82F6', bg: '#EFF6FF', text: '#1E40AF' },
  year:     { border: '#4F46E5', bg: '#EEF2FF', text: '#3730A3' },
  fiveYear: { border: '#7C3AED', bg: '#F5F3FF', text: '#4C1D95' },
};

// ─── Goals ────────────────────────────────────────────────────────────────────
function GoalsScreen({ onSettings }: { onSettings: () => void }) {
  const [goals,       setGoals]       = useState<Goals>({ day: [], week: [], month: [], year: [], fiveYear: [], antiGoals: [] });
  const [editingKey,  setEditingKey]  = useState<string | null>(null);
  const [draft,       setDraft]       = useState('');
  const [commitment,  setCommitment]  = useState<Commitment | null>(null);
  const [commDraft,   setCommDraft]   = useState('');
  const [commDate,    setCommDate]    = useState('');
  const [editComm,    setEditComm]    = useState(false);

  useEffect(() => {
    storage.getGoals().then(setGoals);
    storage.getCommitment().then(setCommitment);
  }, []);

  async function saveGoal(key: string) {
    const vals = draft.split('\n').map(s => s.trim()).filter(Boolean);
    const updated = { ...goals, [key]: vals };
    setGoals(updated);
    await storage.saveGoals(updated);
    setEditingKey(null);
  }

  async function saveCommitment() {
    if (!commDraft.trim()) return;
    const c: Commitment = { text: commDraft.trim(), deadline: commDate, createdAt: todayString() };
    await storage.saveCommitment(c);
    setCommitment(c); setEditComm(false);
  }

  const daysLeft = (c: Commitment) => {
    if (!c.deadline) return null;
    const d = Math.ceil((new Date(c.deadline).getTime() - Date.now()) / 86400000);
    return d;
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={st.topBar}>
        <Text style={st.screenTitle}>🎯 Мои цели</Text>
      </View>
      <ScrollView contentContainerStyle={st.content}>

        {/* Commitment card */}
        <View style={[st.card, { borderLeftWidth: 4, borderLeftColor: '#EF4444' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Text style={[st.cardTitle, { flex: 1 }]}>🤝 Моё обязательство</Text>
            <TouchableOpacity onPress={() => {
              setCommDraft(commitment?.text || '');
              setCommDate(commitment?.deadline || '');
              setEditComm(!editComm);
            }}>
              <Text style={{ color: '#EF4444', fontWeight: '600', fontSize: 14 }}>
                {editComm ? 'Отмена' : commitment ? 'Изменить' : '+ Добавить'}
              </Text>
            </TouchableOpacity>
          </View>
          {editComm ? (
            <>
              <TextInput style={[st.obInput, { minHeight: 70, textAlignVertical: 'top' }]}
                value={commDraft} onChangeText={setCommDraft} multiline
                placeholder="Я обязуюсь... к такому-то результату" placeholderTextColor="#9CA3AF" autoFocus />
              <Text style={st.fieldLabel}>Дедлайн (ГГГГ-ММ-ДД)</Text>
              <TextInput style={st.obInput} value={commDate} onChangeText={setCommDate}
                placeholder="2025-12-31" placeholderTextColor="#9CA3AF" />
              <TouchableOpacity style={st.primaryBtn} onPress={saveCommitment}>
                <Text style={st.primaryBtnText}>Зафиксировать</Text>
              </TouchableOpacity>
            </>
          ) : commitment ? (
            <>
              <Text style={{ fontSize: 15, color: '#111827', lineHeight: 22, marginBottom: 6 }}>
                {commitment.text}
              </Text>
              {daysLeft(commitment) !== null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ backgroundColor: daysLeft(commitment)! > 7 ? '#FEE2E2' : '#FEF3C7',
                    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700',
                      color: daysLeft(commitment)! > 7 ? '#DC2626' : '#D97706' }}>
                      ⏰ {daysLeft(commitment)} {daysLeft(commitment) === 1 ? 'день' : 'дней'} до дедлайна
                    </Text>
                  </View>
                </View>
              )}
            </>
          ) : (
            <Text style={{ color: '#9CA3AF', fontSize: 14, fontStyle: 'italic' }}>
              Публичное обязательство с дедлайном — мощный инструмент. Добавь своё.
            </Text>
          )}
        </View>

        {/* Goals */}
        {GOAL_LABELS.map(({ key, emoji, title }) => {
          const c = GOAL_COLORS[key] || { border: '#4F46E5', bg: '#EEF2FF', text: '#3730A3' };
          return (
            <View key={key} style={[st.card, { borderLeftWidth: 4, borderLeftColor: c.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c.bg,
                  alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                  <Text style={{ fontSize: 18 }}>{emoji}</Text>
                </View>
                <Text style={[st.cardTitle, { flex: 1, color: c.text }]}>{title}</Text>
                <TouchableOpacity onPress={() => {
                  if (editingKey === key) { setEditingKey(null); }
                  else { setDraft((goals as any)[key].join('\n')); setEditingKey(key); }
                }}>
                  <Text style={{ color: c.border, fontWeight: '600', fontSize: 14 }}>
                    {editingKey === key ? 'Отмена' : 'Изменить'}
                  </Text>
                </TouchableOpacity>
              </View>
              {editingKey === key ? (
                <>
                  <View style={st.voiceInputWrap}>
                    <TextInput
                      style={[st.obInput, { minHeight: 90, textAlignVertical: 'top', marginBottom: 0, flex: 1 }]}
                      value={draft} onChangeText={setDraft} multiline
                      placeholder="Каждая цель — отдельная строка..." placeholderTextColor="#9CA3AF"
                    />
                    <View style={{ justifyContent: 'flex-end', paddingLeft: 8, paddingBottom: 4 }}>
                      <MicButton onText={t => setDraft(prev => prev ? prev + '\n' + t : t)} />
                    </View>
                  </View>
                  <TouchableOpacity style={[st.primaryBtn, { marginTop: 8, backgroundColor: c.border }]} onPress={() => saveGoal(key)}>
                    <Text style={st.primaryBtnText}>Сохранить</Text>
                  </TouchableOpacity>
                </>
              ) : (goals as any)[key].length === 0 ? (
                <Text style={{ color: '#9CA3AF', fontStyle: 'italic', fontSize: 14 }}>Нажми «Изменить» чтобы добавить</Text>
              ) : (
                (goals as any)[key].map((g: string, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', marginVertical: 3 }}>
                    <Text style={{ color: c.border, marginRight: 8, fontSize: 16 }}>•</Text>
                    <Text style={{ flex: 1, color: '#374151', fontSize: 15, lineHeight: 22 }}>{g}</Text>
                  </View>
                ))
              )}
            </View>
          );
        })}

        {/* Anti-goals */}
        <View style={[st.card, { borderLeftWidth: 4, borderLeftColor: '#6B7280' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#F3F4F6',
              alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
              <Text style={{ fontSize: 18 }}>🚫</Text>
            </View>
            <Text style={[st.cardTitle, { flex: 1, color: '#374151' }]}>Чего избегать</Text>
            <TouchableOpacity onPress={() => {
              if (editingKey === 'antiGoals') { setEditingKey(null); }
              else { setDraft(goals.antiGoals.join('\n')); setEditingKey('antiGoals'); }
            }}>
              <Text style={{ color: '#6B7280', fontWeight: '600', fontSize: 14 }}>
                {editingKey === 'antiGoals' ? 'Отмена' : 'Изменить'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={{ color: '#9CA3AF', fontSize: 12, marginBottom: 8 }}>
            Паттерны, привычки и ситуации, которые тебя тормозят
          </Text>
          {editingKey === 'antiGoals' ? (
            <>
              <View style={st.voiceInputWrap}>
                <TextInput
                  style={[st.obInput, { minHeight: 80, textAlignVertical: 'top', marginBottom: 0, flex: 1 }]}
                  value={draft} onChangeText={setDraft} multiline
                  placeholder="Прокрастинация, соц. сети с утра..." placeholderTextColor="#9CA3AF"
                />
                <View style={{ justifyContent: 'flex-end', paddingLeft: 8, paddingBottom: 4 }}>
                  <MicButton onText={t => setDraft(prev => prev ? prev + '\n' + t : t)} />
                </View>
              </View>
              <TouchableOpacity style={[st.primaryBtn, { marginTop: 8, backgroundColor: '#374151' }]} onPress={() => saveGoal('antiGoals')}>
                <Text style={st.primaryBtnText}>Сохранить</Text>
              </TouchableOpacity>
            </>
          ) : goals.antiGoals.length === 0 ? (
            <Text style={{ color: '#9CA3AF', fontStyle: 'italic', fontSize: 14 }}>Не добавлено. Коуч будет напоминать об этом.</Text>
          ) : (
            goals.antiGoals.map((g, i) => (
              <View key={i} style={{ flexDirection: 'row', marginVertical: 3 }}>
                <Text style={{ color: '#EF4444', marginRight: 8, fontSize: 15 }}>✗</Text>
                <Text style={{ flex: 1, color: '#374151', fontSize: 15, lineHeight: 22 }}>{g}</Text>
              </View>
            ))
          )}
        </View>

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
  const [city, setCity] = useState<City | null>(null);
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [citySearch, setCitySearch] = useState('');

  useEffect(() => {
    storage.getProviderSettings().then(s => {
      setPs(s);
      setDraftKeys(s.keys);
      setDraftModels(s.models);
    });
    storage.getCity().then(setCity);
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

        {/* City / timezone */}
        <View style={st.card}>
          <Text style={st.cardTitle}>🌍 Часовой пояс</Text>
          <Text style={{ color: '#6B7280', fontSize: 13, marginBottom: 12 }}>
            ИИ будет знать твоё текущее время и адаптировать советы под день/вечер/утро
          </Text>
          {city ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>{city.name}</Text>
                <Text style={{ fontSize: 13, color: '#6B7280' }}>
                  UTC{city.utcOffset >= 0 ? '+' : ''}{city.utcOffset}  ·  сейчас {getCityTime(city).timeStr}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={{ color: '#9CA3AF', fontSize: 14, marginBottom: 10 }}>Город не выбран</Text>
          )}
          <TouchableOpacity style={st.primaryBtn} onPress={() => setShowCityPicker(true)}>
            <Text style={st.primaryBtnText}>{city ? 'Изменить город' : 'Выбрать город'}</Text>
          </TouchableOpacity>
        </View>

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

      {/* City picker modal */}
      <Modal visible={showCityPicker} animationType="slide" transparent onRequestClose={() => setShowCityPicker(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' }}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>🌍 Выбери город</Text>
              <TouchableOpacity onPress={() => { setShowCityPicker(false); setCitySearch(''); }}>
                <Text style={{ fontSize: 22, color: '#6B7280' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }}>
              <TextInput
                style={[st.obInput, { marginBottom: 0 }]}
                value={citySearch}
                onChangeText={setCitySearch}
                placeholder="🔍 Поиск города..."
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                clearButtonMode="while-editing"
              />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {CITIES.filter(c => c.name.toLowerCase().includes(citySearch.toLowerCase())).map(c => {
                const isSelected = city?.name === c.name;
                return (
                  <TouchableOpacity
                    key={c.name}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', backgroundColor: isSelected ? '#F5F3FF' : '#fff' }}
                    onPress={async () => {
                      await storage.saveCity(c);
                      setCity(c);
                      setShowCityPicker(false);
                      setCitySearch('');
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: isSelected ? '700' : '400', color: isSelected ? '#4F46E5' : '#111827' }}>{c.name}</Text>
                      <Text style={{ fontSize: 13, color: '#9CA3AF' }}>UTC{c.utcOffset >= 0 ? '+' : ''}{c.utcOffset} · {getCityTime(c).timeStr}</Text>
                    </View>
                    {isSelected && <Text style={{ fontSize: 20 }}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
              <View style={{ height: 30 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Statistics ───────────────────────────────────────────────────────────────
function StatsScreen({ onBack }: { onBack: () => void }) {
  const [tasks,  setTasks]  = useState<Task[]>([]);
  const [moods,  setMoods]  = useState<MoodEntry[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs,   setLogs]   = useState<HabitLog[]>([]);

  useEffect(() => {
    Promise.all([
      storage.getTasks(),
      storage.getMoodEntries(),
      storage.getHabits(),
      storage.getHabitLogs(),
    ]).then(([t, m, h, l]) => {
      setTasks(t); setMoods(m); setHabits(h); setLogs(l);
    });
  }, []);

  // Build last N days as YYYY-MM-DD strings
  function buildDays(n: number) {
    return Array.from({ length: n }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (n - 1 - i));
      return d.toISOString().split('T')[0];
    });
  }

  const days14 = buildDays(14);
  const days30 = buildDays(30);

  // Per-day data for 14 days
  const dayData = days14.map(ds => {
    const d = new Date(ds + 'T00:00:00');
    const dayTasks = tasks.filter(t => t.date === ds);
    const done  = dayTasks.filter(t => t.done).length;
    const total = dayTasks.length;
    const mood  = moods.find(m => m.date === ds);
    const dayNum = d.getDate();
    const dayLabel = d.toLocaleDateString('ru-RU', { weekday: 'short' });
    return { ds, done, total, mood, dayNum, dayLabel };
  });

  // Summary stats
  const totalDone   = tasks.filter(t => t.done).length;
  const month30Done = tasks.filter(t => t.done && days30.includes(t.date)).length;
  const moodEntries7 = moods.filter(m => days14.slice(-7).includes(m.date));
  const avgMood = moodEntries7.length ? Math.round(moodEntries7.reduce((s, m) => s + m.mood, 0) / moodEntries7.length) : 0;
  const bestStreak = habits.reduce((m, h) => Math.max(m, calcStreak(h.id, logs)), 0);

  // Day-of-week performance (last 30 days)
  const weekdayLabels = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  const weekdayStats = weekdayLabels.map((label, d) => {
    const daysForWeekday = days30.filter(ds => new Date(ds + 'T00:00:00').getDay() === d);
    const done  = daysForWeekday.reduce((s, ds) => s + tasks.filter(t => t.date === ds && t.done).length, 0);
    const total = daysForWeekday.reduce((s, ds) => s + tasks.filter(t => t.date === ds).length, 0);
    return { label, pct: total > 0 ? done / total : 0, done, total };
  });
  // Reorder Mon–Sun
  const weekdayStatsOrdered = [1,2,3,4,5,6,0].map(i => weekdayStats[i]);

  const moodColors = ['#EF4444','#F97316','#EAB308','#22C55E','#10B981'];
  const energyColors = ['#94A3B8','#60A5FA','#34D399','#FBBF24','#F472B6'];

  return (
    <View style={{ flex: 1, backgroundColor: '#F0F2FF' }}>
      {/* Header */}
      <View style={[st.homeHeader, { flexDirection: 'row', alignItems: 'center' }]}>
        <TouchableOpacity onPress={onBack} style={{ marginRight: 12,
          backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>← Назад</Text>
        </TouchableOpacity>
        <Text style={[st.homeGreet, { flex: 1 }]}>📈 Мой прогресс</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}>

        {/* Summary cards */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={[st.statBox, { backgroundColor: '#EEF2FF', flex: 1 }]}>
            <Text style={[st.statNum, { color: '#4F46E5' }]}>{totalDone}</Text>
            <Text style={st.statLabel}>всего задач{'\n'}выполнено</Text>
          </View>
          <View style={[st.statBox, { backgroundColor: '#D1FAE5', flex: 1 }]}>
            <Text style={[st.statNum, { color: '#059669' }]}>{month30Done}</Text>
            <Text style={st.statLabel}>за 30 дней</Text>
          </View>
          <View style={[st.statBox, { backgroundColor: '#FEF3C7', flex: 1 }]}>
            <Text style={[st.statNum, { color: '#D97706' }]}>
              {avgMood > 0 ? MOOD_EMOJIS[avgMood - 1] : '—'}
            </Text>
            <Text style={st.statLabel}>настроение{'\n'}за неделю</Text>
          </View>
          <View style={[st.statBox, { backgroundColor: '#FEE2E2', flex: 1 }]}>
            <Text style={[st.statNum, { color: '#DC2626' }]}>{bestStreak > 0 ? `🔥${bestStreak}` : '—'}</Text>
            <Text style={st.statLabel}>лучший{'\n'}стрик</Text>
          </View>
        </View>

        {/* Task completion bar chart */}
        <View style={[st.card, { padding: 16 }]}>
          <Text style={[st.sectionPill, { marginBottom: 12 }]}>✅ Задачи за 14 дней</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 80, gap: 2, marginBottom: 6 }}>
            {dayData.map((d, i) => {
              const pct = d.total > 0 ? d.done / d.total : 0;
              const barH = d.total > 0 ? Math.max(pct * 64, 4) : 0;
              const color = pct >= 1 ? '#10B981' : pct > 0 ? '#F59E0B' : (d.total > 0 ? '#FEE2E2' : '#E5E7EB');
              return (
                <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                  <View style={{ height: 64, width: '100%', justifyContent: 'flex-end' }}>
                    {d.total > 0 && (
                      <View style={{ height: d.total > 0 ? 64 : 0, width: '100%', backgroundColor: '#F3F4F6', borderRadius: 3 }}>
                        <View style={{ height: barH, width: '100%', backgroundColor: color, borderRadius: 3, position: 'absolute', bottom: 0 }} />
                      </View>
                    )}
                    {d.total === 0 && (
                      <View style={{ height: 4, width: '100%', backgroundColor: '#E5E7EB', borderRadius: 3 }} />
                    )}
                  </View>
                  <Text style={{ fontSize: 9, color: '#9CA3AF', marginTop: 4 }}>{d.dayNum}</Text>
                </View>
              );
            })}
          </View>
          {/* Legend */}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#10B981' }} />
              <Text style={{ fontSize: 11, color: '#6B7280' }}>Все выполнены</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#F59E0B' }} />
              <Text style={{ fontSize: 11, color: '#6B7280' }}>Частично</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#E5E7EB' }} />
              <Text style={{ fontSize: 11, color: '#6B7280' }}>Нет задач</Text>
            </View>
          </View>
        </View>

        {/* Mood & Energy chart */}
        <View style={[st.card, { padding: 16 }]}>
          <Text style={[st.sectionPill, { marginBottom: 12 }]}>🌡️ Настроение и энергия</Text>
          {/* Mood row */}
          <Text style={{ fontSize: 11, color: '#6B7280', marginBottom: 6, fontWeight: '600' }}>Настроение</Text>
          <View style={{ flexDirection: 'row', marginBottom: 12 }}>
            {dayData.map((d, i) => {
              const color = d.mood ? moodColors[d.mood.mood - 1] : '#E5E7EB';
              const emoji = d.mood ? MOOD_EMOJIS[d.mood.mood - 1] : '';
              return (
                <View key={i} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: color,
                    alignItems: 'center', justifyContent: 'center' }}>
                    {d.mood ? <Text style={{ fontSize: 11 }}>{emoji}</Text> : null}
                  </View>
                  <Text style={{ fontSize: 8, color: '#9CA3AF' }}>{d.dayNum}</Text>
                </View>
              );
            })}
          </View>
          {/* Energy row */}
          <Text style={{ fontSize: 11, color: '#6B7280', marginBottom: 6, fontWeight: '600' }}>Энергия</Text>
          <View style={{ flexDirection: 'row' }}>
            {dayData.map((d, i) => {
              const energyPct = d.mood ? d.mood.energy / 5 : 0;
              const color = d.mood ? energyColors[d.mood.energy - 1] : '#E5E7EB';
              return (
                <View key={i} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                  <View style={{ height: 32, width: '80%', justifyContent: 'flex-end' }}>
                    <View style={{
                      height: d.mood ? Math.max(energyPct * 28, 3) : 3,
                      backgroundColor: color, borderRadius: 3
                    }} />
                  </View>
                  <Text style={{ fontSize: 8, color: '#9CA3AF' }}>{d.dayNum}</Text>
                </View>
              );
            })}
          </View>
          {moods.length === 0 && (
            <Text style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', marginTop: 12 }}>
              Начни отмечать настроение на главной странице
            </Text>
          )}
        </View>

        {/* Habit heatmap */}
        {habits.length > 0 && (
          <View style={[st.card, { padding: 16 }]}>
            <Text style={[st.sectionPill, { marginBottom: 4 }]}>🔗 Привычки — 30 дней</Text>
            <Text style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 12 }}>
              Каждый квадрат = один день
            </Text>
            {habits.map(habit => {
              const streak = calcStreak(habit.id, logs);
              return (
                <View key={habit.id} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                    <Text style={{ fontSize: 16, marginRight: 6 }}>{habit.emoji}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#111827', flex: 1 }} numberOfLines={1}>
                      {habit.name}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#6B7280' }}>
                      {streak > 0 ? `🔥 ${streak} д.` : '—'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 3, flexWrap: 'nowrap' }}>
                    {days30.map((ds, i) => {
                      const done = logs.some(l => l.habitId === habit.id && l.date === ds);
                      const d = new Date(ds + 'T00:00:00');
                      const isToday = ds === todayString();
                      return (
                        <View key={i} style={{
                          flex: 1, aspectRatio: 1,
                          backgroundColor: done ? '#10B981' : '#E5E7EB',
                          borderRadius: 3,
                          borderWidth: isToday ? 1 : 0,
                          borderColor: '#4F46E5',
                        }} />
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Productivity by day of week */}
        <View style={[st.card, { padding: 16 }]}>
          <Text style={[st.sectionPill, { marginBottom: 12 }]}>📅 Активность по дням недели</Text>
          <Text style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 12 }}>За последние 30 дней</Text>
          {weekdayStatsOrdered.map((day, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#374151', width: 24 }}>{day.label}</Text>
              <View style={{ flex: 1, height: 18, backgroundColor: '#F3F4F6', borderRadius: 9, overflow: 'hidden' }}>
                <View style={{
                  height: '100%',
                  width: `${Math.round(day.pct * 100)}%`,
                  backgroundColor: day.pct >= 0.8 ? '#10B981' : day.pct >= 0.5 ? '#F59E0B' : day.pct > 0 ? '#60A5FA' : '#E5E7EB',
                  borderRadius: 9,
                }} />
              </View>
              <Text style={{ fontSize: 11, color: '#6B7280', width: 36, textAlign: 'right' }}>
                {day.total > 0 ? `${Math.round(day.pct * 100)}%` : '—'}
              </Text>
            </View>
          ))}
          {tasks.length === 0 && (
            <Text style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center' }}>
              Задачи появятся после утреннего чек-ина с Максом
            </Text>
          )}
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
const TABS: { key: Screen; label: string; emoji: string }[] = [
  { key: 'home',     label: 'Главная',   emoji: '🏠' },
  { key: 'chat',     label: 'Коуч',      emoji: '💬' },
  { key: 'goals',    label: 'Цели',      emoji: '🎯' },
  { key: 'habits',   label: 'Привычки',  emoji: '🔗' },
  { key: 'settings', label: 'Настройки', emoji: '⚙️' },
];

export default function App() {
  const [screen,         setScreen]         = useState<Screen | null>(null);
  const [tab,            setTab]            = useState<Screen>('home');
  const [activeProvider, setActiveProvider] = useState<string>('groq');

  useEffect(() => {
    storage.isOnboarded().then(done => setScreen(done ? 'home' : 'onboarding'));
    storage.getProviderSettings().then(ps => setActiveProvider(ps.activeProvider));
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

  function goTab(t: Screen) {
    // При уходе из настроек — перечитываем активный провайдер
    if (tab === 'settings') {
      storage.getProviderSettings().then(ps => setActiveProvider(ps.activeProvider));
    }
    setTab(t);
    setScreen(t);
  }

  return (
    <SafeAreaView style={st.safe}>
      <StatusBar style="dark" />
      {screen === 'stats' ? (
        <StatsScreen onBack={() => { setScreen(tab); }} />
      ) : (
        <>
          <View style={{ flex: 1 }}>
            {tab === 'home'     && <HomeScreen onSettings={() => goTab('settings')} onStats={() => setScreen('stats')} />}
            {tab === 'chat'     && <ChatScreen key={activeProvider} />}
            {tab === 'goals'    && <GoalsScreen onSettings={() => goTab('settings')} />}
            {tab === 'habits'   && <HabitsScreen />}
            {tab === 'settings' && <SettingsScreen onBack={() => goTab('home')} onReset={() => { setTab('home'); setScreen('onboarding'); }} />}
          </View>
          <View style={st.tabBar}>
            {TABS.map(t => (
              <TouchableOpacity key={t.key} style={st.tabItem} onPress={() => goTab(t.key)} activeOpacity={0.7}>
                <Text style={{ fontSize: 22 }}>{t.emoji}</Text>
                <Text style={[st.tabLabel, tab === t.key && st.tabLabelActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: '#F9FAFB' },
  // Home header
  homeHeader:   { backgroundColor: '#4F46E5', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center' },
  homeGreet:    { fontSize: 22, fontWeight: '800', color: '#fff' },
  homeDate:     { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2, textTransform: 'capitalize' },
  // Stats
  statsRow:     { flexDirection: 'row', backgroundColor: '#4F46E5', paddingHorizontal: 12, paddingBottom: 16, gap: 8 },
  statBox:      { flex: 1, borderRadius: 14, padding: 10, alignItems: 'center' },
  statNum:      { fontSize: 18, fontWeight: '800' },
  statLabel:    { fontSize: 10, color: '#6B7280', marginTop: 2, textAlign: 'center', fontWeight: '500' },
  // Section pill
  sectionPill:  { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 8 },
  // Action bar
  actionBar:       { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  actionBarBtn:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 3 },
  actionBarLabel:  { fontSize: 11, fontWeight: '700', color: '#374151' },
  actionBarDivider:{ width: 1, backgroundColor: '#E5E7EB', marginVertical: 8 },
  // Action buttons (legacy, keep for other screens)
  actionBtn:    { flex: 1, borderRadius: 16, padding: 14, alignItems: 'center', gap: 6 },
  actionBtnText:{ fontSize: 12, fontWeight: '700', textAlign: 'center' },
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
  provCard:       { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#E5E7EB', padding: 14, marginBottom: 10, width: '100%' },
  provCardActive: { borderColor: '#4F46E5', backgroundColor: '#F5F3FF' },
  voiceInputWrap: { flexDirection: 'row', alignItems: 'stretch', width: '100%', marginBottom: 6 },
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
  tabLabel:     { fontSize: 10, color: '#9CA3AF', marginTop: 1, fontWeight: '500' },
  tabLabelActive: { color: '#4F46E5', fontWeight: '700' },
});
