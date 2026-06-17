import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  SafeAreaView, Modal, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { storage, Task, todayString } from '../../services/storage';
import { sendSystemMessage, sendMessage } from '../../services/ai';
import { DAILY_CHECKIN_PROMPT } from '../../constants/prompts';
import TaskItem from '../../components/TaskItem';
import ChatBubble from '../../components/ChatBubble';

export default function HomeScreen() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinMessages, setCheckinMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [checkinInput, setCheckinInput] = useState('');
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinStarted, setCheckinStarted] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [apiKey, setApiKey] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    const key = await storage.getApiKey();
    setApiKey(key);
    const t = await storage.getTasks();
    const today = todayString();
    setTasks(t.filter(task => task.date === today));

    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Доброе утро! ☀️');
    else if (hour < 17) setGreeting('Добрый день! 🌤');
    else setGreeting('Добрый вечер! 🌙');

    const lastCheckin = await storage.getLastCheckin();
    if (lastCheckin !== today && key) {
      setShowCheckin(true);
      startCheckin();
    }
  }

  async function startCheckin() {
    setCheckinStarted(true);
    setCheckinLoading(true);
    const goals = await storage.getGoals();
    const prompt = DAILY_CHECKIN_PROMPT(goals);
    const reply = await sendSystemMessage(prompt);
    setCheckinMessages([{ role: 'assistant', content: reply || 'Привет! Как прошёл вчерашний день? Что удалось сделать?' }]);
    setCheckinLoading(false);
  }

  async function sendCheckinMessage() {
    if (!checkinInput.trim() || checkinLoading) return;
    const text = checkinInput.trim();
    setCheckinInput('');
    const newMessages = [...checkinMessages, { role: 'user' as const, content: text }];
    setCheckinMessages(newMessages);
    setCheckinLoading(true);

    const reply = await sendMessage(text);
    setCheckinMessages([...newMessages, { role: 'assistant' as const, content: reply }]);

    // Extract tasks from AI reply and save them
    const taskLines = reply.split('\n').filter(l => l.includes('✅') || l.match(/^\d+\./));
    if (taskLines.length > 0) {
      const today = todayString();
      const existingTasks = await storage.getTasks();
      const newTasks: Task[] = taskLines.map((line, i) => ({
        id: `${Date.now()}_${i}`,
        text: line.replace(/^✅\s*Задача\s*\d+:\s*/i, '').replace(/^\d+\.\s*/, '').trim(),
        done: false,
        date: today,
      }));
      await storage.saveTasks([...existingTasks, ...newTasks]);
      setTasks(newTasks);
    }
    setCheckinLoading(false);
  }

  async function closeCheckin() {
    await storage.setLastCheckin(todayString());
    setShowCheckin(false);
    loadData();
  }

  async function toggleTask(id: string) {
    await storage.toggleTask(id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  }

  const done = tasks.filter(t => t.done).length;
  const total = tasks.length;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.date}>{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/settings' as any)} style={styles.settingsBtn}>
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {!apiKey && (
          <TouchableOpacity style={styles.warningCard} onPress={() => router.push('/settings' as any)}>
            <Text style={styles.warningText}>⚠️ Добавь API ключ в настройках чтобы ИИ-коуч заработал →</Text>
          </TouchableOpacity>
        )}

        <View style={styles.progressCard}>
          <Text style={styles.progressTitle}>Задачи на сегодня</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: total > 0 ? `${(done / total) * 100}%` : '0%' }]} />
          </View>
          <Text style={styles.progressText}>{done} из {total} выполнено</Text>
        </View>

        {tasks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>🤖</Text>
            <Text style={styles.emptyTitle}>Нет задач на сегодня</Text>
            <Text style={styles.emptyText}>Пройди утренний чек-ин или напиши коучу в чат</Text>
            <TouchableOpacity style={styles.chatBtn} onPress={() => setShowCheckin(true)}>
              <Text style={styles.chatBtnText}>Начать чек-ин</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <Text style={styles.sectionTitle}>Мои задачи</Text>
            {tasks.map(task => (
              <TaskItem key={task.id} task={task} onToggle={toggleTask} />
            ))}
          </View>
        )}

        {done === total && total > 0 && (
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>🎉</Text>
            <Text style={styles.successText}>Все задачи выполнены! Отличная работа!</Text>
          </View>
        )}
      </ScrollView>

      {/* Daily check-in modal */}
      <Modal visible={showCheckin} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>☀️ Утренний чек-ин</Text>
            <TouchableOpacity onPress={closeCheckin}>
              <Text style={styles.closeBtn}>Готово</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.chatScroll} contentContainerStyle={{ padding: 12, paddingBottom: 20 }}>
            {checkinMessages.map((msg, i) => (
              <ChatBubble key={i} role={msg.role} content={msg.content} />
            ))}
            {checkinLoading && (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#4F46E5" size="small" />
                <Text style={styles.loadingText}>Коуч думает...</Text>
              </View>
            )}
          </ScrollView>

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.chatInput}
                value={checkinInput}
                onChangeText={setCheckinInput}
                placeholder="Напиши ответ..."
                placeholderTextColor="#9CA3AF"
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!checkinInput.trim() || checkinLoading) && styles.sendBtnDisabled]}
                onPress={sendCheckinMessage}
                disabled={!checkinInput.trim() || checkinLoading}
              >
                <Text style={styles.sendIcon}>➤</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8,
  },
  greeting: { fontSize: 22, fontWeight: '700', color: '#111827' },
  date: { fontSize: 14, color: '#6B7280', marginTop: 2, textTransform: 'capitalize' },
  settingsBtn: { padding: 8 },
  settingsIcon: { fontSize: 24 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  warningCard: {
    backgroundColor: '#FEF3C7', borderRadius: 12, padding: 14, marginBottom: 12,
  },
  warningText: { color: '#92400E', fontSize: 14, lineHeight: 20 },
  progressCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  progressTitle: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 10 },
  progressBar: { height: 8, backgroundColor: '#E5E7EB', borderRadius: 4, marginBottom: 6 },
  progressFill: { height: 8, backgroundColor: '#4F46E5', borderRadius: 4 },
  progressText: { fontSize: 13, color: '#6B7280' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 8 },
  emptyCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#111827', marginBottom: 6 },
  emptyText: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 16 },
  chatBtn: { backgroundColor: '#4F46E5', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  chatBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  successCard: {
    backgroundColor: '#D1FAE5', borderRadius: 16, padding: 20, alignItems: 'center', marginTop: 12,
  },
  successEmoji: { fontSize: 36, marginBottom: 8 },
  successText: { fontSize: 16, fontWeight: '600', color: '#065F46', textAlign: 'center' },
  // Modal
  modalSafe: { flex: 1, backgroundColor: '#F9FAFB' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
    backgroundColor: '#fff',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  closeBtn: { fontSize: 16, color: '#4F46E5', fontWeight: '600' },
  chatScroll: { flex: 1 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  loadingText: { color: '#6B7280', fontSize: 14 },
  inputRow: {
    flexDirection: 'row', padding: 12, borderTopWidth: 1,
    borderTopColor: '#E5E7EB', backgroundColor: '#fff', alignItems: 'flex-end',
  },
  chatInput: {
    flex: 1, backgroundColor: '#F3F4F6', borderRadius: 20, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 15, color: '#111827', maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: '#4F46E5', borderRadius: 22, width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  sendBtnDisabled: { backgroundColor: '#C7D2FE' },
  sendIcon: { color: '#fff', fontSize: 18 },
});
