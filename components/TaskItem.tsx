import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { Task } from '../services/storage';

interface Props {
  task: Task;
  onToggle: (id: string) => void;
}

export default function TaskItem({ task, onToggle }: Props) {
  return (
    <TouchableOpacity style={styles.container} onPress={() => onToggle(task.id)} activeOpacity={0.7}>
      <View style={[styles.checkbox, task.done && styles.checkboxDone]}>
        {task.done && <Text style={styles.checkmark}>✓</Text>}
      </View>
      <Text style={[styles.text, task.done && styles.textDone]}>{task.text}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4F46E5',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  text: { flex: 1, fontSize: 15, color: '#111827', lineHeight: 20 },
  textDone: { color: '#9CA3AF', textDecorationLine: 'line-through' },
});
