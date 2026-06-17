import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { storage } from '../services/storage';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);

  useEffect(() => {
    storage.isOnboarded().then(val => {
      setOnboarded(val);
      setReady(true);
    });
  }, []);

  if (!ready) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {!onboarded ? (
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      ) : (
        <>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" />
        </>
      )}
    </Stack>
  );
}
