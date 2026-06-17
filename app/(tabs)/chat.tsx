import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform,
  ActivityIndicator
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { storage, Message } from '../../services/storage';
import { sendMessage } from '../../services/ai';
import ChatBubble from '../../components/ChatBubble';

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<FlatList>(null);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [])
  );

  async function loadHistory() {
    const history = await storage.getHistory();
    setMessages(history.filter(m => m.role !== 'system'));
  }

  async function handleSend() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');

    const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    const reply = await sendMessage(text);
    const aiMsg: Message = { role: 'assistant', content: reply, timestamp: Date.now() };
    setMessages(prev => [...prev, aiMsg]);
    setLoading(false);

    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }

  const displayMessages = messages.filter(m => m.role !== 'system');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🤖 Коуч</Text>
        <Text style={styles.headerSub}>Помогает достигать твоих целей</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        {displayMessages.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>💬</Text>
            <Text style={styles.emptyTitle}>Начни разговор с коучем</Text>
            <Text style={styles.emptyText}>Расскажи о своих целях, спроси совет или попроси задачи на день</Text>
            <View style={styles.suggestions}>
              {['Дай задачи на сегодня', 'Как достичь моих целей?', 'Мотивируй меня!'].map(s => (
                <TouchableOpacity key={s} style={styles.chip} onPress={() => setInput(s)}>
                  <Text style={styles.chipText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={displayMessages}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => (
              <ChatBubble role={item.role as 'user' | 'assistant'} content={item.content} />
            )}
            contentContainerStyle={{ paddingVertical: 12 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#4F46E5" size="small" />
            <Text style={styles.loadingText}>Коуч думает...</Text>
          </View>
        )}

        <View style={styles.inputArea}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Написать коучу..."
            placeholderTextColor="#9CA3AF"
            multiline
            maxLength={1000}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || loading}
          >
            <Text style={styles.sendIcon}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    backgroundColor: '#fff', padding: 16,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },
  headerSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827', textAlign: 'center', marginBottom: 8 },
  emptyText: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  suggestions: { gap: 10, width: '100%' },
  chip: {
    backgroundColor: '#EEF2FF', borderRadius: 20, paddingHorizontal: 16,
    paddingVertical: 10, alignItems: 'center',
  },
  chipText: { color: '#4F46E5', fontSize: 14, fontWeight: '500' },
  loadingRow: {
    flexDirection: 'row', alignItems: 'center', padding: 12, paddingLeft: 20, gap: 8,
  },
  loadingText: { color: '#6B7280', fontSize: 14 },
  inputArea: {
    flexDirection: 'row', padding: 12, borderTopWidth: 1,
    borderTopColor: '#E5E7EB', backgroundColor: '#fff', alignItems: 'flex-end',
  },
  input: {
    flex: 1, backgroundColor: '#F3F4F6', borderRadius: 22, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 15, color: '#111827', maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: '#4F46E5', borderRadius: 22, width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  sendBtnDisabled: { backgroundColor: '#C7D2FE' },
  sendIcon: { color: '#fff', fontSize: 18 },
});
