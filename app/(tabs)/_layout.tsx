import { Tabs } from 'expo-router';
import { Text } from 'react-native';

function Icon({ label }: { label: string }) {
  return <Text style={{ fontSize: 22 }}>{label}</Text>;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#4F46E5',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#F3F4F6',
          paddingBottom: 6,
          height: 60,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Главная',
          tabBarIcon: ({ focused }) => <Icon label={focused ? '🏠' : '🏡'} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Коуч',
          tabBarIcon: ({ focused }) => <Icon label={focused ? '💬' : '🗨️'} />,
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: 'Цели',
          tabBarIcon: ({ focused }) => <Icon label={focused ? '🎯' : '⭕'} />,
        }}
      />
    </Tabs>
  );
}
