import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Alert
} from 'react-native';
import { useRouter } from 'expo-router';
import { storage } from '../services/storage';

export default function SettingsScreen() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    storage.getApiKey().then(k => setApiKey(k || ''));
  }, []);

  async function handleSave() {
    await storage.saveApiKey(apiKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleReset() {
    Alert.alert(
      'Сбросить данные?',
      'Удалится вся история, задачи и цели. API ключ сохранится.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Сбросить', style: 'destructive',
          onPress: async () => {
            const key = await storage.getApiKey();
            await storage.clearAll();
            if (key) await storage.saveApiKey(key);
            router.replace('/onboarding');
          }
        }
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Настройки</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>🔑 API Ключ</Text>
          <Text style={styles.desc}>
            Для работы ИИ нужен API ключ. Получи бесплатно:{'\n\n'}
            🔵 <Text style={styles.link}>platform.deepseek.com</Text> — DeepSeek{'\n'}
            Почти бесплатно (~$0.14 за 1M токенов){'\n\n'}
            🟢 <Text style={styles.link}>console.groq.com</Text> — Groq{'\n'}
            Полностью бесплатно (ключ начинается с gsk_)
          </Text>

          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="sk-... или gsk_..."
            placeholderTextColor="#9CA3AF"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TouchableOpacity style={[styles.btn, saved && styles.btnSuccess]} onPress={handleSave}>
            <Text style={styles.btnText}>{saved ? '✓ Сохранено!' : 'Сохранить ключ'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>ℹ️ О приложении</Text>
          <Text style={styles.desc}>
            Goal AI Coach — твой персональный ИИ-коуч.{'\n\n'}
            Каждый день спрашивает о прогрессе, ставит задачи и помогает достигать целей шаг за шагом.{'\n\n'}
            Вся история хранится только на твоём устройстве.
          </Text>
        </View>

        <TouchableOpacity style={styles.dangerBtn} onPress={handleReset}>
          <Text style={styles.dangerText}>Сбросить все данные</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: '#fff',
  },
  back: { color: '#4F46E5', fontSize: 16, fontWeight: '500' },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  content: { padding: 16, gap: 16 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  desc: { fontSize: 14, color: '#6B7280', lineHeight: 22, marginBottom: 16 },
  link: { color: '#4F46E5', fontWeight: '500' },
  input: {
    backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 10, padding: 12, fontSize: 15, color: '#111827', marginBottom: 12,
  },
  btn: {
    backgroundColor: '#4F46E5', borderRadius: 12, padding: 14, alignItems: 'center',
  },
  btnSuccess: { backgroundColor: '#10B981' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  dangerBtn: {
    backgroundColor: '#FEE2E2', borderRadius: 12, padding: 14, alignItems: 'center',
  },
  dangerText: { color: '#DC2626', fontWeight: '600', fontSize: 15 },
});
