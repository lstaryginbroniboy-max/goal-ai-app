import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, SafeAreaView, KeyboardAvoidingView, Platform
} from 'react-native';
import { useRouter } from 'expo-router';
import { storage, Goals } from '../services/storage';

const STEPS = [
  {
    key: 'apiKey',
    title: 'Настройка ИИ',
    subtitle: 'Введи API ключ для работы ИИ-коуча',
    description: 'Получи БЕСПЛАТНЫЙ ключ:\n\n🔵 DeepSeek: platform.deepseek.com\n   (очень дёшево, почти бесплатно)\n\n🟢 Groq: console.groq.com\n   (полностью бесплатно, начинается с gsk_)',
    placeholder: 'sk-... или gsk_...',
  },
  { key: 'fiveYear', emoji: '🚀', title: 'Цели на 5 лет', subtitle: 'Кем ты хочешь стать через 5 лет?', placeholder: 'Например: открыть свой бизнес' },
  { key: 'year', emoji: '🎯', title: 'Цели на год', subtitle: 'Что хочешь достичь в этом году?', placeholder: 'Например: выучить английский до B2' },
  { key: 'month', emoji: '📅', title: 'Цели на месяц', subtitle: 'Что важно сделать в этом месяце?', placeholder: 'Например: прочитать 2 книги' },
  { key: 'week', emoji: '📋', title: 'Цели на неделю', subtitle: 'Фокус этой недели?', placeholder: 'Например: сделать 3 тренировки' },
  { key: 'day', emoji: '☀️', title: 'Цели на сегодня', subtitle: 'Что важно сделать сегодня?', placeholder: 'Например: написать 500 слов' },
];

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({
    apiKey: '', fiveYear: '', year: '', month: '', week: '', day: '',
  });

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  async function handleNext() {
    if (step === 0) {
      const key = values.apiKey.trim();
      if (!key) { alert('Введи API ключ чтобы продолжить'); return; }
      await storage.saveApiKey(key);
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
      router.replace('/');
    } else {
      setStep(s => s + 1);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.progress}>
            {STEPS.map((_, i) => (
              <View key={i} style={[styles.dot, i <= step && styles.dotActive]} />
            ))}
          </View>

          {current.emoji && <Text style={styles.emoji}>{current.emoji}</Text>}
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.subtitle}>{current.subtitle}</Text>

          {current.description && (
            <View style={styles.descBox}>
              <Text style={styles.desc}>{current.description}</Text>
            </View>
          )}

          <TextInput
            style={[styles.input, current.key !== 'apiKey' && { minHeight: 100 }]}
            value={values[current.key]}
            onChangeText={v => setValues(prev => ({ ...prev, [current.key]: v }))}
            placeholder={current.placeholder}
            placeholderTextColor="#9CA3AF"
            multiline={current.key !== 'apiKey'}
            secureTextEntry={current.key === 'apiKey'}
            autoCapitalize="none"
            textAlignVertical={current.key !== 'apiKey' ? 'top' : 'center'}
          />

          <TouchableOpacity style={styles.btn} onPress={handleNext}>
            <Text style={styles.btnText}>{isLast ? 'Начать!' : 'Далее →'}</Text>
          </TouchableOpacity>

          {step > 0 && (
            <TouchableOpacity onPress={() => setStep(s => s - 1)}>
              <Text style={styles.back}>← Назад</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9FAFB' },
  container: { padding: 24, paddingTop: 40, alignItems: 'center' },
  progress: { flexDirection: 'row', gap: 8, marginBottom: 32 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D1D5DB' },
  dotActive: { backgroundColor: '#4F46E5', width: 24 },
  emoji: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 26, fontWeight: '700', color: '#111827', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#6B7280', textAlign: 'center', marginBottom: 20 },
  descBox: { backgroundColor: '#EEF2FF', borderRadius: 12, padding: 16, marginBottom: 20, width: '100%' },
  desc: { fontSize: 14, color: '#4338CA', lineHeight: 22 },
  input: {
    width: '100%',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#111827',
    marginBottom: 20,
  },
  btn: {
    width: '100%',
    backgroundColor: '#4F46E5',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  back: { color: '#6B7280', fontSize: 15 },
});
