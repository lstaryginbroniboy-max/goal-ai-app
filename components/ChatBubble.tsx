import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatBubble({ role, content }: Props) {
  const isUser = role === 'user';
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAI]}>
      {!isUser && <Text style={styles.avatar}>🤖</Text>}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}>
        <Text style={[styles.text, isUser ? styles.textUser : styles.textAI]}>{content}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: 4,
    paddingHorizontal: 12,
    alignItems: 'flex-end',
  },
  rowUser: { justifyContent: 'flex-end' },
  rowAI: { justifyContent: 'flex-start' },
  avatar: { fontSize: 20, marginRight: 6, marginBottom: 2 },
  bubble: {
    maxWidth: '80%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: '#4F46E5',
    borderBottomRightRadius: 4,
  },
  bubbleAI: {
    backgroundColor: '#F3F4F6',
    borderBottomLeftRadius: 4,
  },
  text: { fontSize: 15, lineHeight: 22 },
  textUser: { color: '#fff' },
  textAI: { color: '#111827' },
});
