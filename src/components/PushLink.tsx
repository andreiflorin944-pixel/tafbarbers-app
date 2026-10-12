import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import { pushTarget, registerPush } from '@/lib/push';
import { useApp } from '@/state/AppState';

/**
 * Leagă telefonul de clientul din cont (notificările pe telefon) și, la atingerea unei notificări,
 * deschide ecranul potrivit: programările, plata, abonamentele, comenzile sau programarea.
 */
export function PushLink() {
  const { token } = useApp();
  useEffect(() => {
    if (token) registerPush(token);
  }, [token]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (r: Notifications.NotificationResponse | null) => {
      const target = pushTarget(r?.notification.request.content.data as Record<string, unknown> | undefined);
      if (!target) return;
      if (target.url) Linking.openURL(target.url).catch(() => undefined);
      else if (target.route) router.push(target.route as never);
    };
    // Aplicația pornită chiar din notificare.
    Notifications.getLastNotificationResponseAsync().then(open, () => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
  return null;
}
