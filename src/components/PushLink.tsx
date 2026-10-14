import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { useT } from '@/i18n';
import { shouldOfferNearby, startNearby } from '@/lib/nearby';
import { pushTarget, registerPush } from '@/lib/push';
import { useApp } from '@/state/AppState';

/**
 * Leagă telefonul de clientul din cont (notificările pe telefon) și, la atingerea unei notificări,
 * deschide ecranul potrivit: programările, plata, abonamentele, comenzile sau programarea.
 */
export function PushLink() {
  const { token, user } = useApp();
  const { t } = useT();
  const wantsOffers = !!user?.marketing?.push;
  useEffect(() => {
    if (!token) return;
    // Întâi voia pentru notificări, apoi (o singură dată) întrebarea „Anunță-mă când sunt lângă salon”, cu explicația
    // cerută de Google înainte de locația în fundal. Telefonul cere apoi voie la locație.
    let live = true;
    registerPush(token)
      .then(() => shouldOfferNearby(wantsOffers))
      .then((ask) => {
        if (!ask || !live) return;
        Alert.alert(t('nearby.offerTitle'), t('account.nearbyDisclosure'), [
          { text: t('nearby.notNow'), style: 'cancel' },
          { text: t('nearby.yes'), onPress: () => void startNearby().catch(() => undefined) },
        ]);
      });
    return () => {
      live = false;
    };
  }, [token, wantsOffers]);

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
