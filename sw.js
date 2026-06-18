const INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 часа

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

let timer = null;

function isQuietHours() {
  const h = new Date().getHours();
  return h >= 23 || h < 7;
}

self.addEventListener('message', event => {
  if (event.data?.type === 'TASKS_UPDATE') {
    clearTimeout(timer);
    if (event.data.remaining > 0) {
      scheduleNotif();
    }
  }
});

function scheduleNotif() {
  timer = setTimeout(() => {
    if (!isQuietHours()) {
      self.registration.showNotification('⏰ Незавершённые задачи', {
        body: 'У тебя есть задачи на сегодня — не забудь выполнить!',
        icon: '/goal-ai-app/favicon.ico',
        badge: '/goal-ai-app/favicon.ico',
        tag: 'task-reminder',
        renotify: true,
      });
    }
    scheduleNotif(); // запланировать следующее в любом случае
  }, INTERVAL_MS);
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow('/goal-ai-app/');
    })
  );
});
