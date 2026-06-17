import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList
} from 'react-native';

interface Props {
  title: string;
  emoji: string;
  goals: string[];
  onSave: (goals: string[]) => void;
}

export default function GoalCard({ title, emoji, goals, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goals.join('\n'));

  function handleSave() {
    const lines = draft.split('\n').map(l => l.trim()).filter(Boolean);
    onSave(lines);
    setEditing(false);
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.emoji}>{emoji}</Text>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity onPress={() => { setDraft(goals.join('\n')); setEditing(!editing); }}>
          <Text style={styles.editBtn}>{editing ? 'Отмена' : 'Изменить'}</Text>
        </TouchableOpacity>
      </View>

      {editing ? (
        <View>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder="Каждая цель с новой строки..."
            placeholderTextColor="#9CA3AF"
          />
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Text style={styles.saveBtnText}>Сохранить</Text>
          </TouchableOpacity>
        </View>
      ) : goals.length === 0 ? (
        <Text style={styles.empty}>Цели не добавлены. Нажми «Изменить»</Text>
      ) : (
        <FlatList
          data={goals}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => (
            <View style={styles.goalRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.goalText}>{item}</Text>
            </View>
          )}
          scrollEnabled={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  emoji: { fontSize: 22, marginRight: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: '600', color: '#111827' },
  editBtn: { fontSize: 14, color: '#4F46E5', fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 10,
    fontSize: 15,
    color: '#111827',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  saveBtn: {
    backgroundColor: '#4F46E5',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  empty: { color: '#9CA3AF', fontSize: 14, fontStyle: 'italic' },
  goalRow: { flexDirection: 'row', marginVertical: 2 },
  bullet: { color: '#4F46E5', marginRight: 8, fontSize: 16 },
  goalText: { flex: 1, fontSize: 15, color: '#374151', lineHeight: 22 },
});
