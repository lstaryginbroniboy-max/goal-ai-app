import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Modal, ActivityIndicator, KeyboardAvoidingView, Platform,
  SafeAreaView, Alert, Animated, Easing
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { storage, Goals, Task, Habit, HabitLog, MoodEntry, Commitment, todayString, ProviderId, ProviderSettings } from './services/storage';
import { sendMessage, sendSystemMessage, PROVIDERS } from './services/ai';
import { DAILY_CHECKIN_PROMPT, WEEKLY_REVIEW_PROMPT, EVENING_RITUAL_PROMPT } from './constants/prompts';
import { CITIES, City, getCityTime, fetchWeather } from './constants/cities';

type Screen = 'home' | 'todos' | 'goals' | 'habits' | 'settings' | 'onboarding' | 'stats';

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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

// ─── Pomodoro ─────────────────────────────────────────────────────────────────
function playAlarm() {
  try {
    const AudioCtx = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [0, 0.45, 0.9].forEach(delay => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.7, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.35);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.35);
    });
  } catch (_) {}
}

const POMO_PHASES = [
  { name: 'Фокус',  duration: 25 * 60, color: '#4F46E5', bg: '#EEF2FF', emoji: '🎯' },
  { name: 'Пауза',  duration:  5 * 60, color: '#10B981', bg: '#D1FAE5', emoji: '☕' },
];

function usePomodoro() {
  const [phase,    setPhase]    = useState(0);
  const [timeLeft, setTimeLeft] = useState(POMO_PHASES[0].duration);
  const [running,  setRunning]  = useState(false);
  const [sessions, setSessions] = useState(0);
  const [visible,  setVisible]  = useState(false);
  const ivRef = useRef<any>(null);

  useEffect(() => {
    if (running) {
      ivRef.current = setInterval(() => {
        setTimeLeft(t => {
          if (t > 1) return t - 1;
          clearInterval(ivRef.current);
          playAlarm();
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

  return { phase, timeLeft, running, sessions, visible,
           setVisible, setRunning, setPhase, setTimeLeft, setSessions, cur, mins, secs };
}

type PomoState = ReturnType<typeof usePomodoro>;

// Круглая кнопка в шапке — выглядит как старый FAB, показывает таймер когда работает
function PomodoroButton({ pomo }: { pomo: PomoState }) {
  const { running, cur, mins, secs, setVisible } = pomo;
  return (
    <TouchableOpacity
      onPress={() => setVisible(true)}
      style={{
        backgroundColor: running ? cur.color : 'rgba(255,255,255,0.2)',
        borderRadius: 28, width: 52, height: 52,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOpacity: running ? 0.25 : 0,
        shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: running ? 4 : 0,
      }}>
      <Text style={{ fontSize: 22 }}>⏱</Text>
      {running && (
        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', position: 'absolute', bottom: 7, letterSpacing: 0.5 }}>
          {mins}:{secs}
        </Text>
      )}
    </TouchableOpacity>
  );
}

// Модальное окно помодоро — рендерится на уровне App, живёт вечно
function PomodoroModal({ pomo }: { pomo: PomoState }) {
  const { phase, timeLeft, running, sessions, visible,
          setVisible, setRunning, setPhase, setTimeLeft, cur, mins, secs } = pomo;
  const pct = ((cur.duration - timeLeft) / cur.duration) * 100;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => { setRunning(false); setVisible(false); }}>
      <TouchableOpacity activeOpacity={1} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        onPress={() => { setRunning(false); setVisible(false); }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}
          style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 28 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#111827' }}>⏱ Помодоро</Text>
            <TouchableOpacity onPress={() => { setRunning(false); setVisible(false); }}>
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
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Daily quotes ─────────────────────────────────────────────────────────────
const QUOTES: { text: string; author: string }[] = [
  { text: 'Путь в тысячу миль начинается с первого шага.', author: 'Лао-цзы' },
  { text: 'Успех — это сумма небольших усилий, повторяемых день за днём.', author: 'Роберт Кольер' },
  { text: 'Не важно, как медленно ты идёшь, главное — не останавливаться.', author: 'Конфуций' },
  { text: 'Единственный способ сделать великое дело — любить то, что ты делаешь.', author: 'Стив Джобс' },
  { text: 'Жизнь — это то, что происходит с тобой, пока ты строишь другие планы.', author: 'Джон Леннон' },
  { text: 'Неважно, насколько медленно ты движешься, если только ты не останавливаешься.', author: 'Уинстон Черчилль' },
  { text: 'Стремись не к успеху, а к ценностям, которые он даёт.', author: 'Альберт Эйнштейн' },
  { text: 'Лучшее время посадить дерево было 20 лет назад. Следующее лучшее время — сейчас.', author: 'Китайская мудрость' },
  { text: 'Вы никогда не измените свою жизнь, пока не измените что-то, что делаете ежедневно.', author: 'Майк Мурдок' },
  { text: 'Сделай сегодня то, что другие не хотят делать, и завтра ты будешь жить так, как другие не могут.', author: 'Джаррод Кинц' },
  { text: 'Мечтай по-крупному и осмеливайся потерпеть неудачу.', author: 'Норман Воан' },
  { text: 'Никто не может вернуться назад и начать заново, но каждый может начать сейчас и создать новый конец.', author: 'Карл Бард' },
  { text: 'Поверь в себя и в то, что ты делаешь. Знай, что в тебе есть нечто, что превыше любого препятствия.', author: 'Кристиан Ларсон' },
  { text: 'Успех — это не конечная точка, неудача — не смертельна. Важна смелость продолжать.', author: 'Уинстон Черчилль' },
  { text: 'Наша жизнь — это то, что мы делаем из неё.', author: 'Марк Аврелий' },
  { text: 'Великие дела не делаются силой, ловкостью или быстростой, а только при помощи настойчивости.', author: 'Сэмюэл Джонсон' },
  { text: 'Препятствие — это то, что видно, когда отводишь глаза от цели.', author: 'Генри Форд' },
  { text: 'Всё кажется невозможным, пока оно не сделано.', author: 'Нельсон Мандела' },
  { text: 'Будущее принадлежит тем, кто верит в красоту своей мечты.', author: 'Элеонора Рузвельт' },
  { text: 'Не жди идеального момента — бери момент и делай его идеальным.', author: 'Зиг Зиглар' },
  { text: 'Человек становится великим ровно в той мере, в какой он работает для блага своих ближних.', author: 'Махатма Ганди' },
  { text: 'Дисциплина — это мост между целями и достижениями.', author: 'Джим Рон' },
  { text: 'Не бойся двигаться медленно. Бойся стоять на месте.', author: 'Китайская мудрость' },
  { text: 'Ты никогда не провалишься, если никогда не сдашься.', author: 'Альберт Эйнштейн' },
  { text: 'Чтобы победить, нужно сначала поверить в то, что ты можешь это сделать.', author: 'Ник Фолдс' },
  { text: 'Секрет достижения результатов — начать.', author: 'Марк Твен' },
  { text: 'Трудности — это те вещи, которые видишь, когда отводишь взгляд от своей цели.', author: 'Томас Карлейль' },
  { text: 'Ни одна великая вещь не была достигнута без энтузиазма.', author: 'Ральф Уолдо Эмерсон' },
  { text: 'Либо ты управляешь своим днём, либо день управляет тобой.', author: 'Джим Рон' },
  { text: 'Изменить себя — значит изменить мир.', author: 'Лев Толстой' },
  { text: 'Величайшая слава — не никогда не падать, а подниматься каждый раз, когда падаешь.', author: 'Конфуций' },
  { text: 'Думай о великих мыслях, но получай удовольствие от маленьких радостей.', author: 'Генри Ван Дайк' },
  { text: 'Действие — основополагающий ключ к любому успеху.', author: 'Пабло Пикассо' },
  { text: 'Счастье — это не что-то готовое. Оно приходит от твоих собственных действий.', author: 'Далай-лама' },
  { text: 'Знание без действия — это безумие. Действие без знания — это опасность.', author: 'Гёте' },
  { text: 'Верь, что можешь, и ты уже на полпути.', author: 'Теодор Рузвельт' },
  { text: 'Для тех, кто не знает, куда плыть, ни один ветер не будет попутным.', author: 'Сенека' },
  { text: 'Те, кто говорит "это невозможно", не должны мешать тем, кто это делает.', author: 'Джордж Бернард Шоу' },
  { text: 'Каждое утро ты имеешь два выбора: продолжать спать и мечтать, или проснуться и преследовать свои мечты.', author: 'Сократ' },
  { text: 'Успех — это упасть девять раз и встать десять.', author: 'Бон Джови' },
  { text: 'Жизнь не в том, чтобы ждать, пока пройдёт буря, а в том, чтобы научиться танцевать под дождём.', author: 'Вивиан Грин' },
  { text: 'Чем больше я практикую, тем больше мне везёт.', author: 'Гэри Плеер' },
  { text: 'Сначала они тебя не замечают, потом смеются над тобой, затем борются с тобой. А потом ты побеждаешь.', author: 'Махатма Ганди' },
  { text: 'Начни там, где ты есть. Используй то, что у тебя есть. Делай то, что можешь.', author: 'Артур Эш' },
  { text: 'Смелость — это не отсутствие страха, а понимание того, что есть нечто важнее страха.', author: 'Нельсон Мандела' },
  { text: 'Самое большое открытие моего поколения: человек может изменить свою жизнь, изменив свою позицию.', author: 'Уильям Джеймс' },
  { text: 'Вы не провалились. Вы только что нашли 10 000 способов, которые не работают.', author: 'Томас Эдисон' },
  { text: 'Разница между обычным и экстраординарным — это маленькое "экстра".', author: 'Джимми Джонсон' },
  { text: 'Хочешь узнать, кто ты? Не спрашивай. Действуй! Действие откроет и определит тебя.', author: 'Гёте' },
  { text: 'Два самых важных дня в твоей жизни — день, когда ты родился, и день, когда ты понял, зачем.', author: 'Марк Твен' },
  { text: 'Мы — то, что мы делаем постоянно. Совершенство, следовательно, не поступок, а привычка.', author: 'Аристотель' },
  { text: 'Всё, что ум может задумать и во что может поверить, он способен достичь.', author: 'Наполеон Хилл' },
  { text: 'Победа — это состояние ума.', author: 'Билл Расселл' },
  { text: 'Позаботься о своих мыслях, ведь они станут словами. Позаботься о словах, ведь они станут действиями.', author: 'Лао-цзы' },
  { text: 'Первый шаг к успеху — начать.', author: 'Марк Твен' },
  { text: 'Ничего великого в мире не было достигнуто без страсти.', author: 'Гегель' },
  { text: 'Терпение, настойчивость и пот — непобедимая комбинация.', author: 'Наполеон Хилл' },
  { text: 'Где есть воля, там есть и путь.', author: 'Уильям Блейк' },
  { text: 'Одно действие стоит тысячи слов.', author: 'Конфуций' },
  { text: 'Тот, кто двигается вперёд, не стоит на месте.', author: 'Конфуций' },
  { text: 'Человек, который встаёт, всегда сильнее того, кто остался лежать.', author: 'Ремарк' },
];

function getTodayQuote() {
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  return QUOTES[dayIndex % QUOTES.length];
}

// ─── Home ─────────────────────────────────────────────────────────────────────
const MOOD_EMOJIS   = ['😞', '😕', '😐', '😊', '🤩'];
const ENERGY_ICONS  = ['🪫', '🔋', '⚡', '⚡⚡', '🚀'];
type CheckinType = 'daily' | 'weekly' | 'evening';

function HomeScreen({ onSettings, onStats, pomo }: { onSettings: () => void; onStats: () => void; pomo: PomoState }) {
  const [tasks,          setTasks]          = useState<Task[]>([]);
  const [hasKey,         setHasKey]         = useState(false);
  const [showCheckin,    setShowCheckin]    = useState(false);
  const [checkinType,    setCheckinType]    = useState<CheckinType>('daily');
  const [msgs,           setMsgs]           = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input,          setInput]          = useState('');
  const [loading,        setLoading]        = useState(false);
  const [todayMood,      setTodayMood]      = useState<MoodEntry | null>(null);
  const [draftMood,      setDraftMood]      = useState<{ mood: number; energy: number }>({ mood: 0, energy: 0 });
  const [checkinPending, setCheckinPending] = useState(false);
  const [weeklyPending,  setWeeklyPending]  = useState(false);
  const [weekDone,       setWeekDone]       = useState(0);
  const [topStreak,      setTopStreak]      = useState(0);
  const [weather,        setWeather]        = useState<{ current: number; max: number } | null>(null);
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

    // Погода
    const city = await storage.getCity();
    if (city) fetchWeather(city).then(w => w && setWeather(w));

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
        done: false, date: todayString(), source: 'coach' as const,
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
          {weather && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 6 }}>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 10,
                paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={{ fontSize: 15 }}>🌡</Text>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
                  {weather.current > 0 ? '+' : ''}{weather.current}°
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>сейчас</Text>
              </View>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 10,
                paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={{ fontSize: 15 }}>☀️</Text>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
                  {weather.max > 0 ? '+' : ''}{weather.max}°
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>макс</Text>
              </View>
            </View>
          )}
        </View>
        <PomodoroButton pomo={pomo} />
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

        {/* Daily quote + Mood — одна строка когда настроение указано */}
        {(() => {
          const q = getTodayQuote();
          if (todayMood) {
            return (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {/* Цитата — левая карточка */}
                <View style={[st.card, { flex: 3, borderLeftWidth: 3, borderLeftColor: '#F59E0B', backgroundColor: '#FFFBEB' }]}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#D97706', marginBottom: 5, letterSpacing: 0.5 }}>⚡ ЦИТАТА ДНЯ</Text>
                  <Text style={{ fontSize: 12, color: '#111827', lineHeight: 17, fontStyle: 'italic' }} numberOfLines={5}>«{q.text}»</Text>
                  <Text style={{ fontSize: 11, color: '#B45309', marginTop: 5, fontWeight: '600' }}>— {q.author}</Text>
                </View>
                {/* Самочувствие — правая карточка */}
                <View style={[st.card, { flex: 2, borderLeftWidth: 3, borderLeftColor: '#8B5CF6', alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 26 }}>{MOOD_EMOJIS[todayMood.mood - 1]}</Text>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#111827', marginTop: 4, textAlign: 'center' }}>Самочувствие</Text>
                  <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 3, textAlign: 'center' }}>{ENERGY_ICONS[todayMood.energy - 1]} энергия</Text>
                  <TouchableOpacity onPress={() => setTodayMood(null)} style={{ marginTop: 6 }}>
                    <Text style={{ color: '#9CA3AF', fontSize: 11 }}>изменить</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }
          // Настроение не выбрано — цитата компактно + форма
          return (
            <>
              <View style={[st.card, { borderLeftWidth: 4, borderLeftColor: '#F59E0B', backgroundColor: '#FFFBEB' }]}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#D97706', marginBottom: 6, letterSpacing: 0.5 }}>⚡ ЦИТАТА ДНЯ</Text>
                <Text style={{ fontSize: 13, color: '#111827', lineHeight: 20, fontStyle: 'italic' }}>«{q.text}»</Text>
                <Text style={{ fontSize: 12, color: '#B45309', marginTop: 6, fontWeight: '600' }}>— {q.author}</Text>
              </View>
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
            </>
          );
        })()}

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
            {(() => {
              const isCoachTask = (t: Task) =>
                t.source === 'coach' || (!t.source && (t.id.includes('_') || t.id.startsWith('chat') || t.id.startsWith('extra')));
              const userActive  = tasks.filter(t => !isCoachTask(t) && !t.done);
              const coachActive = tasks.filter(t =>  isCoachTask(t) && !t.done);
              const doneTasks   = tasks.filter(t => t.done);
              const row = (task: Task) => (
                <TouchableOpacity key={task.id} style={st.taskRow} onPress={() => toggleTask(task.id)} activeOpacity={0.7}>
                  <View style={[st.checkbox, task.done && st.checkboxDone]}>
                    {task.done && <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>✓</Text>}
                  </View>
                  <Text style={[st.taskText, task.done && st.taskDone]}>{task.text}</Text>
                </TouchableOpacity>
              );
              const divider = (label: string) => (
                <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 6 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: '#E5E7EB' }} />
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.5 }}>{label}</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: '#E5E7EB' }} />
                </View>
              );
              return (
                <>
                  {userActive.length  > 0 && <>{divider('📝 МОИ ЗАДАЧИ')}{userActive.map(row)}</>}
                  {coachActive.length > 0 && <>{divider('🤖 ОТ КОУЧА')}{coachActive.map(row)}</>}
                  {doneTasks.length   > 0 && <>{divider('✅ ВЫПОЛНЕНО')}{doneTasks.map(row)}</>}
                </>
              );
            })()}
          </>
        )}

        {done > 0 && done === tasks.length && (
          <View style={[st.card, { backgroundColor: '#D1FAE5', alignItems: 'center' }]}>
            <Text style={{ fontSize: 36, marginBottom: 4 }}>🏆</Text>
            <Text style={{ fontWeight: '800', color: '#065F46', fontSize: 16 }}>Все задачи выполнены!</Text>
            <Text style={{ color: '#047857', marginTop: 4, fontSize: 14, marginBottom: 14 }}>Ты сегодня огонь 🔥</Text>
            <TouchableOpacity
              style={{ backgroundColor: '#059669', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
              onPress={async () => {
                const goals = await storage.getGoals();
                const reply = await sendSystemMessage(`Я выполнил все задачи на сегодня! Дай мне ещё 3 новые конкретные задачи на сегодня, основанные на моих целях: ${JSON.stringify(goals.day)}`);
                if (reply) {
                  const parsed = parseTasksFromText(reply);
                  if (parsed.length > 0) {
                    const today = todayString();
                    const existing = await storage.getTasks();
                    const existingTexts = new Set(existing.filter(t => t.date === today).map(t => t.text.toLowerCase()));
                    const newTasks: Task[] = parsed
                      .filter(t => !existingTexts.has(t.toLowerCase()))
                      .map((t, i) => ({ id: `extra_${Date.now()}_${i}`, text: t, done: false, date: today, source: 'coach' as const }));
                    if (newTasks.length > 0) {
                      const all = [...existing, ...newTasks];
                      await storage.saveTasks(all);
                      setTasks(all.filter(t => t.date === today));
                    }
                  }
                }
              }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>🤖 Ещё задачи</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>

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

// Извлекает задачи из ответа ИИ (нумерованные/маркированные списки)
function parseTasksFromText(text: string): string[] {
  const results: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = line.match(/^(?:\*{0,2}\d+[.)]\*{0,2}\s+|\*{0,2}[-•✅]\*{0,2}\s+)(.+)/);
    if (!m) continue;
    const task = m[1].replace(/\*\*/g, '').trim();
    if (task.length >= 8 && task.length <= 250) results.push(task);
  }
  // Минимум 2 строки — защита от случайных одиночных пунктов
  return results.length >= 2 ? results : [];
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
function ChatScreen() {
  const [msgs,         setMsgs]         = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input,        setInput]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [providerName, setProviderName] = useState('Коуч');
  const [tasksBanner,  setTasksBanner]  = useState(0); // кол-во добавленных задач
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

    // Парсим задачи из ответа и сохраняем на главную
    const parsed = parseTasksFromText(reply);
    if (parsed.length > 0) {
      const today = todayString();
      const existing = await storage.getTasks();
      const existingTexts = new Set(existing.filter(t => t.date === today).map(t => t.text.toLowerCase()));
      const newTasks: Task[] = parsed
        .filter(t => !existingTexts.has(t.toLowerCase()))
        .map((t, i) => ({ id: `chat_${Date.now()}_${i}`, text: t, done: false, date: today, source: 'coach' as const }));
      if (newTasks.length > 0) {
        await storage.saveTasks([...existing, ...newTasks]);
        setTasksBanner(newTasks.length);
        setTimeout(() => setTasksBanner(0), 4000);
      }
    }
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
      {tasksBanner > 0 && (
        <View style={{ backgroundColor: '#D1FAE5', paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 16 }}>✅</Text>
          <Text style={{ color: '#065F46', fontWeight: '600', fontSize: 14 }}>
            {tasksBanner} {tasksBanner === 1 ? 'задача добавлена' : tasksBanner < 5 ? 'задачи добавлены' : 'задач добавлено'} на главную
          </Text>
        </View>
      )}
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

// ─── Todos ────────────────────────────────────────────────────────────────────
type TodoFilter = 'active' | 'bydate' | 'done';

const TASK_COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#14B8A6', '#3B82F6', '#8B5CF6', '#EC4899',
];

function TodosScreen() {
  const [tasks,       setTasks]       = useState<Task[]>([]);
  const [editTask,    setEditTask]    = useState<Task | null>(null);
  const [isNew,       setIsNew]       = useState(false);
  const [formText,    setFormText]    = useState('');
  const [formColor,   setFormColor]   = useState<string | undefined>(undefined);
  const [formDate,    setFormDate]    = useState(todayString());
  const [filter,      setFilter]      = useState<TodoFilter>('active');
  const [selDate,     setSelDate]     = useState(todayString());
  const today = todayString();

  useEffect(() => { storage.getTasks().then(setTasks); }, []);

  function openAdd() {
    setFormText(''); setFormColor(undefined); setFormDate(today); setIsNew(true);
    setEditTask({ id: '', text: '', done: false, date: today });
  }
  function openEdit(task: Task) {
    setFormText(task.text); setFormColor(task.color); setFormDate(task.date); setIsNew(false); setEditTask(task);
  }
  async function saveTask() {
    if (!formText.trim()) return;
    let updated: Task[];
    if (isNew) {
      updated = [...tasks, { id: Date.now().toString(), text: formText.trim(), done: false, date: formDate, source: 'user' as const, color: formColor }];
    } else {
      updated = tasks.map(t => t.id === editTask!.id ? { ...t, text: formText.trim(), color: formColor, date: formDate } : t);
    }
    await storage.saveTasks(updated);
    setTasks(updated);
    setEditTask(null);
  }
  async function toggleTask(id: string) {
    await storage.toggleTask(id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  }
  async function deleteTask(id: string) {
    const doDelete = async () => {
      const updated = tasks.filter(t => t.id !== id);
      await storage.saveTasks(updated);
      setTasks(updated);
    };
    if (Platform.OS === 'web') {
      if ((globalThis as any).confirm('Удалить задачу?')) await doDelete();
    } else {
      Alert.alert('Удалить?', '', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: doDelete },
      ]);
    }
  }

  const isCoach = (t: Task) =>
    t.source === 'coach' || (!t.source && (t.id.includes('_') || t.id.startsWith('chat') || t.id.startsWith('extra')));

  // Все уникальные даты с задачами, отсортированные по возрастанию
  const taskDates = [...new Set(tasks.map(t => t.date))].sort((a, b) => a.localeCompare(b));

  function shiftDate(ds: string, delta: number): string {
    const d = new Date(ds + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return localDateString(d);
  }

  function formatDateNav(ds: string): string {
    const d = new Date(ds + 'T00:00:00');
    if (ds === today) return 'Сегодня';
    if (ds === shiftDate(today, -1)) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
  }

  const prevDate = shiftDate(selDate, -1);
  const nextDate = shiftDate(selDate, 1);
  const maxFuture = shiftDate(today, 60); // навигатор "По дням" — до 60 дней вперёд

  const activeCount = tasks.filter(t => !t.done).length;
  const doneCount   = tasks.filter(t => t.done).length;

  function friendlyDate(ds: string): string {
    if (ds === today) return 'Сегодня';
    if (ds === shiftDate(today, -1)) return 'Вчера';
    if (ds === shiftDate(today, 1)) return 'Завтра';
    const d = new Date(ds + 'T00:00:00');
    const label = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
    if (ds < today) return `⚠️ Просрочено · ${label}`;
    return `📅 ${label}`;
  }

  const filtered = filter === 'bydate'
    ? tasks.filter(t => t.date === selDate)
    : tasks.filter(t => filter === 'active' ? !t.done : t.done)
        .sort((a, b) => filter === 'active'
          ? a.date.localeCompare(b.date)   // ближайшие первые
          : b.date.localeCompare(a.date)); // в готово — новые первые

  const coachTasks = filtered.filter(isCoach);
  const userTasks  = filtered.filter(t => !isCoach(t));

  const FILTERS: [TodoFilter, string][] = [
    ['active', `Активные · ${activeCount}`],
    ['bydate', 'По дням 📅'],
    ['done',   `Готово · ${doneCount}`],
  ];

  function SectionDivider({ label }: { label: string }) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: '#E5E7EB' }} />
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#6B7280', letterSpacing: 0.5 }}>{label}</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: '#E5E7EB' }} />
      </View>
    );
  }

  function TaskCard({ task }: { task: Task }) {
    const accent = task.color;
    const isFuture  = task.date > today;
    const isOverdue = !task.done && task.date < today;
    const dateColor = isOverdue ? '#EF4444' : isFuture ? '#6366F1' : '#C4C9D4';
    return (
      <View style={[st.card, { padding: 0, overflow: 'hidden', flexDirection: 'row',
        opacity: isFuture && !task.done ? 0.88 : 1 }]}>
        <View style={{ width: 5, backgroundColor: accent ?? (isOverdue ? '#FCA5A5' : isFuture ? '#C7D2FE' : '#E5E7EB'),
          borderTopLeftRadius: 12, borderBottomLeftRadius: 12 }} />
        <View style={{ flex: 1, padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
            <TouchableOpacity onPress={() => toggleTask(task.id)}
              style={[{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, marginTop: 2,
                alignItems: 'center', justifyContent: 'center' },
                task.done
                  ? { backgroundColor: accent ?? '#4F46E5', borderColor: accent ?? '#4F46E5' }
                  : { borderColor: accent ?? '#D1D5DB' }]}>
              {task.done && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text>}
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, color: task.done ? '#9CA3AF' : '#111827', lineHeight: 22,
                textDecorationLine: task.done ? 'line-through' : 'none' }}>{task.text}</Text>
              {filter !== 'bydate' && (
                <Text style={{ fontSize: 11, color: dateColor, marginTop: 3, fontWeight: isOverdue ? '600' : '400' }}>
                  {friendlyDate(task.date)}
                </Text>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <TouchableOpacity onPress={() => openEdit(task)}
                style={{ padding: 6, backgroundColor: accent ? accent + '22' : '#EEF2FF', borderRadius: 8 }}>
                <Text style={{ fontSize: 15 }}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => deleteTask(task.id)}
                style={{ padding: 6, backgroundColor: '#FEE2E2', borderRadius: 8 }}>
                <Text style={{ fontSize: 15 }}>🗑</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  }

  function TaskSections() {
    if (filtered.length === 0) {
      return (
        <View style={[st.card, { alignItems: 'center', paddingVertical: 40 }]}>
          <Text style={{ fontSize: 44, marginBottom: 12 }}>📭</Text>
          <Text style={[st.cardTitle, { textAlign: 'center' }]}>Нет задач</Text>
          {filter === 'active' && (
            <TouchableOpacity style={[st.primaryBtn, { marginTop: 16 }]} onPress={openAdd}>
              <Text style={st.primaryBtnText}>+ Добавить дело</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }
    return (
      <>
        {userTasks.length > 0 && (
          <><SectionDivider label="📝 МОИ ЗАДАЧИ" />{userTasks.map(t => <TaskCard key={t.id} task={t} />)}</>
        )}
        {coachTasks.length > 0 && (
          <>
            <SectionDivider label="🤖 ОТ КОУЧА" />
            {coachTasks.map(t => <TaskCard key={t.id} task={t} />)}
          </>
        )}
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={st.topBar}>
        <Text style={st.screenTitle}>📝 Мои дела</Text>
        <TouchableOpacity onPress={openAdd}>
          <Text style={{ fontSize: 30, color: '#4F46E5', lineHeight: 34 }}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Filter tabs */}
      <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }}>
        {FILTERS.map(([key, label]) => (
          <TouchableOpacity key={key} onPress={() => { setFilter(key); if (key === 'bydate') setSelDate(today); }}
            style={{ flex: 1, paddingVertical: 11, alignItems: 'center',
              borderBottomWidth: 2.5, borderBottomColor: filter === key ? '#4F46E5' : 'transparent' }}>
            <Text style={{ fontSize: 12, fontWeight: filter === key ? '700' : '500',
              color: filter === key ? '#4F46E5' : '#6B7280' }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Навигатор по дням */}
      {filter === 'bydate' && (
        <View style={{ backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', paddingVertical: 10, paddingHorizontal: 16 }}>
          {/* Стрелки навигации */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <TouchableOpacity onPress={() => setSelDate(prevDate)}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18, color: '#4F46E5' }}>‹</Text>
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>{formatDateNav(selDate)}</Text>
              {selDate !== today && (
                <TouchableOpacity onPress={() => setSelDate(today)}>
                  <Text style={{ fontSize: 11, color: '#4F46E5', marginTop: 2 }}>← Вернуться к сегодня</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity onPress={() => selDate < maxFuture && setSelDate(nextDate)}
              style={{ width: 36, height: 36, borderRadius: 18,
                backgroundColor: selDate < maxFuture ? '#EEF2FF' : '#F3F4F6',
                alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18, color: selDate < maxFuture ? '#4F46E5' : '#D1D5DB' }}>›</Text>
            </TouchableOpacity>
          </View>
          {/* Мини-полоска дней с задачами */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {taskDates.slice(0, 14).map(ds => {
              const dayTasks = tasks.filter(t => t.date === ds);
              const doneCnt  = dayTasks.filter(t => t.done).length;
              const allDone  = doneCnt === dayTasks.length;
              const isActive = ds === selDate;
              const d = new Date(ds + 'T00:00:00');
              return (
                <TouchableOpacity key={ds} onPress={() => setSelDate(ds)}
                  style={{ alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
                    backgroundColor: isActive ? '#4F46E5' : '#F3F4F6',
                    borderWidth: 1.5, borderColor: isActive ? '#4F46E5' : '#E5E7EB' }}>
                  <Text style={{ fontSize: 10, fontWeight: '600',
                    color: isActive ? 'rgba(255,255,255,0.8)' : '#9CA3AF' }}>
                    {d.toLocaleDateString('ru-RU', { weekday: 'short' })}
                  </Text>
                  <Text style={{ fontSize: 14, fontWeight: '800',
                    color: isActive ? '#fff' : '#111827' }}>
                    {d.getDate()}
                  </Text>
                  <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 3,
                    backgroundColor: isActive ? 'rgba(255,255,255,0.7)' : allDone ? '#10B981' : '#F59E0B' }} />
                  <Text style={{ fontSize: 9, color: isActive ? 'rgba(255,255,255,0.7)' : '#9CA3AF', marginTop: 1 }}>
                    {doneCnt}/{dayTasks.length}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <ScrollView contentContainerStyle={[st.content, { gap: 8 }]}>
        <TaskSections />
      </ScrollView>

      {/* Add / Edit modal */}
      <Modal visible={editTask !== null} animationType="slide" transparent onRequestClose={() => setEditTask(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'android' ? undefined : 'padding'}>
            <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={st.modalTitle}>{isNew ? 'Новое дело' : 'Редактировать'}</Text>
                <TouchableOpacity onPress={() => setEditTask(null)}>
                  <Text style={{ fontSize: 22, color: '#6B7280' }}>✕</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={[st.obInput, { marginBottom: 14, minHeight: 80, textAlignVertical: 'top' }]}
                value={formText} onChangeText={setFormText}
                placeholder="Что нужно сделать?" placeholderTextColor="#9CA3AF"
                multiline autoFocus
              />
              {/* Дата задачи */}
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 8 }}>Дата задачи</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 7, paddingBottom: 4 }}
                style={{ marginBottom: 14 }}>
                {Array.from({ length: 15 }, (_, i) => {
                  const ds = shiftDate(today, i);
                  const d  = new Date(ds + 'T00:00:00');
                  const sel = ds === formDate;
                  const dayLabel = i === 0 ? 'Сег' : i === 1 ? 'Завт' :
                    d.toLocaleDateString('ru-RU', { weekday: 'short' });
                  return (
                    <TouchableOpacity key={ds} onPress={() => setFormDate(ds)}
                      style={{ alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7,
                        borderRadius: 10, minWidth: 52,
                        backgroundColor: sel ? '#4F46E5' : '#F3F4F6',
                        borderWidth: 1.5, borderColor: sel ? '#4F46E5' : '#E5E7EB' }}>
                      <Text style={{ fontSize: 10, fontWeight: '600',
                        color: sel ? 'rgba(255,255,255,0.8)' : '#9CA3AF' }}>{dayLabel}</Text>
                      <Text style={{ fontSize: 16, fontWeight: '800',
                        color: sel ? '#fff' : '#111827' }}>{d.getDate()}</Text>
                      <Text style={{ fontSize: 9, color: sel ? 'rgba(255,255,255,0.7)' : '#C4C9D4', marginTop: 1 }}>
                        {d.toLocaleDateString('ru-RU', { month: 'short' })}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              {/* Выбор цвета */}
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 8 }}>Цвет метки</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                {/* Без цвета */}
                <TouchableOpacity onPress={() => setFormColor(undefined)}
                  style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 2.5,
                    borderColor: formColor === undefined ? '#4F46E5' : '#D1D5DB',
                    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' }}>
                  {formColor === undefined && <Text style={{ fontSize: 14, color: '#4F46E5' }}>✕</Text>}
                </TouchableOpacity>
                {TASK_COLORS.map(c => (
                  <TouchableOpacity key={c} onPress={() => setFormColor(c)}
                    style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c,
                      borderWidth: 2.5, borderColor: formColor === c ? '#111827' : 'transparent',
                      alignItems: 'center', justifyContent: 'center' }}>
                    {formColor === c && <Text style={{ fontSize: 14, color: '#fff', fontWeight: '900' }}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={[st.primaryBtn, formColor ? { backgroundColor: formColor } : {}]} onPress={saveTask}>
                <Text style={st.primaryBtnText}>{isNew ? 'Добавить' : 'Сохранить'}</Text>
              </TouchableOpacity>
              <View style={{ height: 8 }} />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

// ─── Habits ───────────────────────────────────────────────────────────────────
const HABIT_EMOJIS = ['⭐','💪','📚','🏃','🧘','💧','🥗','😴','✍️','🎯','🧠','❤️','🎸','💰','🌿','🚫','📵','🧹','🛁','🙏'];
const DAY_LABELS   = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function calcStreak(habitId: string, logs: HabitLog[]): number {
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 365; i++) {
    const ds = localDateString(d);
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
    d.setDate(d.getDate() - i); // i=0 сегодня (слева), i=13 — 13 дней назад (справа)
    return logs.some(l => l.habitId === habitId && l.date === localDateString(d));
  });
}

function pluralDays(n: number) {
  if (n === 1) return 'день';
  if (n < 5) return 'дня';
  return 'дней';
}

function HabitsScreen() {
  const [habits,     setHabits]     = useState<Habit[]>([]);
  const [logs,       setLogs]       = useState<HabitLog[]>([]);
  const [editHabit,  setEditHabit]  = useState<Habit | null>(null);
  const [isNew,      setIsNew]      = useState(false);
  const [formName,   setFormName]   = useState('');
  const [formEmoji,  setFormEmoji]  = useState('⭐');
  const [formDays,   setFormDays]   = useState<number[]>([0,1,2,3,4,5,6]);
  const today    = todayString();
  const todayDow = (new Date().getDay() + 6) % 7; // JS Sun=0 → Пн=0

  useEffect(() => {
    Promise.all([storage.getHabits(), storage.getHabitLogs()]).then(([h, l]) => {
      setHabits(h); setLogs(l);
    });
  }, []);

  function openAdd() {
    setFormName(''); setFormEmoji('⭐'); setFormDays([0,1,2,3,4,5,6]);
    setIsNew(true);
    setEditHabit({ id: '', name: '', emoji: '⭐' });
  }

  function openEdit(habit: Habit) {
    setFormName(habit.name);
    setFormEmoji(habit.emoji);
    setFormDays(habit.days ?? [0,1,2,3,4,5,6]);
    setIsNew(false);
    setEditHabit(habit);
  }

  async function saveHabit() {
    if (!formName.trim()) return;
    let updated: Habit[];
    if (isNew) {
      updated = [...habits, { id: Date.now().toString(), name: formName.trim(), emoji: formEmoji, days: formDays }];
    } else {
      updated = habits.map(h => h.id === editHabit!.id
        ? { ...h, name: formName.trim(), emoji: formEmoji, days: formDays }
        : h);
    }
    await storage.saveHabits(updated);
    setHabits(updated);
    setEditHabit(null);
  }

  async function deleteHabit(id: string) {
    const doDelete = async () => {
      const updated = habits.filter(h => h.id !== id);
      await storage.saveHabits(updated);
      setHabits(updated);
    };
    if (Platform.OS === 'web') {
      if ((globalThis as any).confirm('Удалить привычку? История отметок тоже удалится.')) await doDelete();
    } else {
      Alert.alert('Удалить привычку?', 'История отметок тоже удалится.', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: doDelete },
      ]);
    }
  }

  async function toggleHabit(habitId: string) {
    const updated = await storage.toggleHabitLog(habitId, today);
    setLogs(updated);
  }

  function toggleDay(d: number) {
    setFormDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  }

  const todayHabits = habits.filter(h => !h.days || h.days.includes(todayDow));
  const todayDone   = todayHabits.filter(h => logs.some(l => l.habitId === h.id && l.date === today)).length;

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={st.topBar}>
        <Text style={st.screenTitle}>🔗 Привычки</Text>
        <TouchableOpacity onPress={openAdd}>
          <Text style={{ fontSize: 30, color: '#4F46E5', lineHeight: 34 }}>+</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[st.content, { gap: 10 }]}>
        {habits.length > 0 && (
          <View style={[st.card, { flexDirection: 'row', alignItems: 'center' }]}>
            <Text style={{ fontSize: 32, marginRight: 12 }}>
              {todayHabits.length > 0 && todayDone >= todayHabits.length ? '🏆' : '🎯'}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', fontSize: 16, color: '#111827' }}>
                {todayHabits.length > 0 && todayDone >= todayHabits.length
                  ? 'Все привычки выполнены!'
                  : `Сегодня: ${todayDone} из ${todayHabits.length}`}
              </Text>
              <View style={st.progBar}>
                <View style={[st.progFill, { width: `${todayHabits.length ? (todayDone / todayHabits.length) * 100 : 0}%` as any }]} />
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
            <TouchableOpacity style={st.primaryBtn} onPress={openAdd}>
              <Text style={st.primaryBtnText}>+ Добавить привычку</Text>
            </TouchableOpacity>
          </View>
        ) : (
          habits.map(habit => {
            const streak     = calcStreak(habit.id, logs);
            const last14     = getLast14(habit.id, logs);
            const doneToday  = logs.some(l => l.habitId === habit.id && l.date === today);
            const activeToday = !habit.days || habit.days.includes(todayDow);
            return (
              <View key={habit.id} style={[st.card,
                doneToday && { borderWidth: 1.5, borderColor: '#10B981' },
                !activeToday && { opacity: 0.55 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <Text style={{ fontSize: 30, marginRight: 12 }}>{habit.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>{habit.name}</Text>
                    <Text style={{ fontSize: 13, color: streak > 0 ? '#F59E0B' : '#9CA3AF', marginTop: 2 }}>
                      {streak > 0 ? `🔥 ${streak} ${pluralDays(streak)} подряд` : 'Начни сегодня!'}
                    </Text>
                    {habit.days && habit.days.length < 7 && (
                      <View style={{ flexDirection: 'row', gap: 3, marginTop: 5 }}>
                        {DAY_LABELS.map((d, i) => (
                          <View key={i} style={{ paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5,
                            backgroundColor: habit.days!.includes(i) ? '#4F46E5' : '#F3F4F6' }}>
                            <Text style={{ fontSize: 10, fontWeight: '700',
                              color: habit.days!.includes(i) ? '#fff' : '#D1D5DB' }}>{d}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                  <TouchableOpacity
                    style={[{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
                      doneToday ? { backgroundColor: '#D1FAE5' } : { backgroundColor: '#F3F4F6', borderWidth: 2, borderColor: '#E5E7EB' }]}
                    onPress={() => toggleHabit(habit.id)}>
                    <Text style={{ fontSize: 22 }}>{doneToday ? '✅' : '◯'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: 'row', gap: 3, marginBottom: 6 }}>
                  {last14.map((done, i) => (
                    <View key={i} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: done ? '#4F46E5' : '#E5E7EB' }} />
                  ))}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, color: '#9CA3AF' }}>последние 14 дней</Text>
                  <View style={{ flexDirection: 'row', gap: 14 }}>
                    <TouchableOpacity onPress={() => openEdit(habit)}>
                      <Text style={{ fontSize: 12, color: '#4F46E5', fontWeight: '600' }}>✏️ изменить</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteHabit(habit.id)}>
                      <Text style={{ fontSize: 12, color: '#EF4444' }}>удалить</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Add / Edit habit modal */}
      <Modal visible={editHabit !== null} animationType="slide" transparent onRequestClose={() => setEditHabit(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'android' ? undefined : 'padding'}>
            <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={st.modalTitle}>{isNew ? 'Новая привычка' : 'Редактировать'}</Text>
                <TouchableOpacity onPress={() => setEditHabit(null)}>
                  <Text style={{ fontSize: 22, color: '#6B7280' }}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={st.fieldLabel}>Иконка</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                {HABIT_EMOJIS.map(e => (
                  <TouchableOpacity key={e} onPress={() => setFormEmoji(e)}
                    style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
                      marginRight: 8, backgroundColor: formEmoji === e ? '#EEF2FF' : '#F3F4F6',
                      borderWidth: formEmoji === e ? 2 : 0, borderColor: '#4F46E5' }}>
                    <Text style={{ fontSize: 22 }}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={st.fieldLabel}>Название</Text>
              <TextInput
                style={[st.obInput, { marginBottom: 16 }]}
                value={formName} onChangeText={setFormName}
                placeholder="Например: Пить 2л воды" placeholderTextColor="#9CA3AF"
              />

              <Text style={st.fieldLabel}>Дни недели</Text>
              <View style={{ flexDirection: 'row', gap: 5, marginBottom: 20 }}>
                {DAY_LABELS.map((d, i) => (
                  <TouchableOpacity key={i} onPress={() => toggleDay(i)}
                    style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
                      backgroundColor: formDays.includes(i) ? '#4F46E5' : '#F3F4F6',
                      borderWidth: 1.5, borderColor: formDays.includes(i) ? '#4F46E5' : '#E5E7EB' }}>
                    <Text style={{ fontSize: 12, fontWeight: '700',
                      color: formDays.includes(i) ? '#fff' : '#9CA3AF' }}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={st.primaryBtn} onPress={saveHabit}>
                <Text style={st.primaryBtnText}>{isNew ? 'Добавить привычку' : 'Сохранить'}</Text>
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

  const daysLeft = (c: Commitment): number | null => {
    if (!c.deadline) return null;
    const s = c.deadline.trim();
    let date = new Date(s);
    if (isNaN(date.getTime())) {
      // ДД.ММ.ГГ или ДД.ММ.ГГГГ
      const p = s.split('.');
      if (p.length === 3) {
        let y = p[2];
        if (y.length <= 2) y = '20' + y.padStart(2, '0');
        date = new Date(`${y}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`);
      }
    }
    if (isNaN(date.getTime())) return null;
    return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  };

  const daysWord = (n: number) => n === 1 ? 'день' : n >= 2 && n <= 4 ? 'дня' : 'дней';

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
              <Text style={st.fieldLabel}>Дедлайн (ДД.ММ.ГГГГ или ГГГГ-ММ-ДД)</Text>
              <TextInput style={st.obInput} value={commDate} onChangeText={setCommDate}
                placeholder="31.12.2025" placeholderTextColor="#9CA3AF" />
              <TouchableOpacity style={st.primaryBtn} onPress={saveCommitment}>
                <Text style={st.primaryBtnText}>Зафиксировать</Text>
              </TouchableOpacity>
            </>
          ) : commitment ? (
            <>
              <Text style={{ fontSize: 15, color: '#111827', lineHeight: 22, marginBottom: 6 }}>
                {commitment.text}
              </Text>
              {(() => { const d = daysLeft(commitment); return d !== null ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ backgroundColor: d > 7 ? '#FEE2E2' : '#FEF3C7',
                    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700',
                      color: d > 7 ? '#DC2626' : '#D97706' }}>
                      ⏰ {d > 0 ? `${d} ${daysWord(d)} до дедлайна` : d === 0 ? 'Дедлайн сегодня!' : 'Дедлайн прошёл'}
                    </Text>
                  </View>
                </View>
              ) : null; })()}
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
      return localDateString(d);
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
  { key: 'todos',    label: 'Дела',      emoji: '📝' },
  { key: 'goals',    label: 'Цели',      emoji: '🎯' },
  { key: 'habits',   label: 'Привычки',  emoji: '🔗' },
  { key: 'settings', label: 'Настройки', emoji: '⚙️' },
];

export default function App() {
  const [screen,         setScreen]         = useState<Screen | null>(null);
  const [tab,            setTab]            = useState<Screen>('home');
  const [activeProvider, setActiveProvider] = useState<string>('groq');
  const pomo = usePomodoro();

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
    if (tab === 'settings') {
      storage.getProviderSettings().then(ps => setActiveProvider(ps.activeProvider));
    }
    setTab(t as any);
    setScreen(t);
  }

  return (
    <SafeAreaView style={st.safe}>
      <StatusBar style="dark" />
      <PomodoroModal pomo={pomo} />
      {screen === 'stats' ? (
        <StatsScreen onBack={() => { setScreen(tab); }} />
      ) : (
        <>
          <View style={{ flex: 1 }}>
            {tab === 'home'     && <HomeScreen onSettings={() => goTab('settings')} onStats={() => setScreen('stats')} pomo={pomo} />}
            {tab === 'todos'    && <TodosScreen />}
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
