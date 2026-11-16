/* Notifications only. No offline pages, fetch handler or API caching. */
self.addEventListener("push", event => {
  let id;
  try { id = event.data.json().eventId; } catch { /* Show a generic visible notice. */ }
  const valid = typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
  event.waitUntil(self.registration.showNotification("Office · Important update", {
    body: "A department Head has an important update. Open Office to read the brief.",
    icon: "/office-icon-192.png", badge: "/office-icon-192.png",
    tag: valid ? `office-${id}` : "office-update", data: valid ? { eventId: id } : {},
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const id = event.notification.data?.eventId;
  const valid = typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
  const target = new URL(valid ? `/office?notification=${id}` : "/office", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === "/office");
    if (existing) {
      // A live Office handles this without navigation, preserving drafts and calls.
      const channel = new MessageChannel();
      const acknowledged = await new Promise(resolve => {
        const timeout = setTimeout(() => resolve(false), 1200);
        channel.port1.onmessage = () => { clearTimeout(timeout); resolve(true); };
        existing.postMessage({ type: "office-notification", eventId: valid ? id : null }, [channel.port2]);
      });
      channel.port1.close();
      // An unresponsive/old page may contain a draft. Open a separate page instead.
      if (!acknowledged) return self.clients.openWindow(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});
