// Service Worker nur fuer Web Push (kein Offline-Caching). Zeigt die taegliche
// Depotstand-Benachrichtigung an, die die "push-daily" Supabase Edge Function
// per Cron verschickt, und oeffnet beim Antippen die App.
self.addEventListener("push", event => {
  let data = { title: "Belegio", body: "Neuer Depotstand verfügbar.", url: "./" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      tag: "belegio-daily",
      data: { url: data.url || "./" },
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./", self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const client of list) if (client.url === url && "focus" in client) return client.focus();
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
