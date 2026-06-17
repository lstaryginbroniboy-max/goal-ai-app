import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, SafeAreaView, TouchableOpacity
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { storage, Goals } from '../../services/storage';
import GoalCard from '../../components/GoalCard';

const GOAL_SECTIONS = [
  { key: 'day' as keyof Goals, emoji: '☀️', title: 'Цели на сегодня' },
  { key: 'week' as keyof Goals, emoji: '📋', title: 'Цели на неделю' },
  { key: 'month' as keyof Goals, emoji: '📅', title: 'Цели на месяц' },
  { key: 'year' as keyof Goals, emoji: '🎯', title: 'Цели на год' },
  { key: 'fiveYear' as keyof Goals, emoji: '🚀', title: 'Цели на 5 лет' },
];

export default function GoalsScreen() {
  const router = useRouter();
  const [goals, setGoals] = useState<Goals>({ day: [], week: [], month: [], year: [], fiveYear: [] });

  useFocusEffect(
    useCallback(() => {
      storage.getGoals().then(setGoals);
    }, [])
  );

  async function handleSave(key: keyof Goals, values: string[]) {
    const updated = { ...goals, [key]: values };
    setGoals(updated);
    await storage.saveGoals(updated);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Мои цели</Text>
        <TouchableOpacity onPress={() => router.push('/settings' as any)}>
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.hint}>
          Нажми «Изменить» чтобы редактировать цели. Коуч будет использовать их для составления задач.
        </Text>

        {GOAL_SECTIONS.map(({ key, emoji, title }) => (
          <GoalCard
            key={key}
            emoji={emoji}
            title={title}
            goals={goals[key]}
            onSave={(vals) => handleSave(key, vals)}
          />
        ))}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, paddingTop: 16,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  settingsIcon: { fontSize: 24 },
  content: { padding: 16, paddingTop: 0 },
  hint: {
    fontSize: 13, color: '#6B7280', backgroundColor: '#F3F4F6',
    borderRadius: 10, padding: 12, marginBottom: 12, lineHeight: 18,
  },
});
