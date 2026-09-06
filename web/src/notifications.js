import { notificationText } from '../../shared/chat.js';
export async function enableNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('Browser ini belum mendukung notifikasi PWA. Gunakan Chrome Android melalui HTTPS.');
  // This function is called only by the user's explicit click.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifikasi belum diizinkan. Anda dapat mengubahnya melalui pengaturan browser.');
  return permission;
}
export async function notifyCompletion(job) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  if (!registration?.active) return;
  await registration.showNotification('TradingView Remote', {
    body: notificationText(job),
    tag: `analysis-${job.id}`,
    icon: `${import.meta.env.BASE_URL}icon-192.png`,
    data: {requestId:job.id},
  });
}
export function shouldNotify(previous, current) {
  return ['pending','processing'].includes(previous) && current === 'completed';
}
