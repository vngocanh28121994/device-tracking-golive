// Shows the data-only pushes sent by app/lib/push.ts; no Firebase SDK is needed in the worker.
self.addEventListener("push", event => {
  let data = {};
  try { data = (event.data && event.data.json().data) || {}; } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || "Golive", { body: data.body || "", icon: "/favicon.svg", data: { link: data.link || "/" } }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => list.length ? list[0].focus() : self.clients.openWindow(event.notification.data.link)));
});
