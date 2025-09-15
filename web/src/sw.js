self.addEventListener('push', (event) => {
  try {
    const data = event.data ? event.data.json() : {};
    event.waitUntil(self.registration.showNotification(data.title || 'Message', {
      body: data.body || '',
      tag: data.tag || undefined,
    }));
  } catch (e) {
    // ignore
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});


