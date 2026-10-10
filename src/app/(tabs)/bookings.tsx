import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, Text, View } from 'react-native';
import { api } from '@/api';
import { Button, Card, Empty, Screen, Segmented, Title, styles } from '@/components/ui';
import type { Booking, WaitlistEntry } from '@/data/types';
import { formatDate, formatTime, fromDayKey } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

export default function Bookings() {
  const { user, token, bookings, cancelBooking, serviceById, barberById, locationById, locations, resetDraft, setDraft, business, refreshBookings } = useApp();
  const [tab, setTab] = useState(0);
  // Lista de așteptare: se reîncarcă la fiecare intrare pe ecran (clientul s-a putut înscrie chiar acum, din alegerea orei).
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const loadWaitlist = useCallback(() => {
    if (token) api.getWaitlist(token).then(setWaitlist, () => undefined);
    else setWaitlist([]);
  }, [token]);
  useFocusEffect(loadWaitlist);
  // La întoarcerea de pe pagina de plată, reîncărcăm ca să apară „plătită online”.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refreshBookings());
    return () => sub.remove();
  }, [refreshBookings]);
  const { t } = useT();
  const book = () => {
    resetDraft();
    router.push('/book/location');
  };

  if (!user) {
    return (
      <Screen tab>
        <Title>{t('bookings.title')}</Title>
        <Empty icon="calendar-outline" text={t('bookings.loginHint')} />
        <View style={{ gap: space.sm }}>
          <Button title={t('common.login')} onPress={() => router.push('/login')} />
          <Button title={t('common.register')} variant="ghost" onPress={() => router.push({ pathname: '/login', params: { mode: 'register' } })} />
        </View>
      </Screen>
    );
  }

  const now = Date.now();
  const sorted = [...bookings].sort((a, b) => a.start.localeCompare(b.start));
  // Cererile în așteptare stau tot la „Urmează”, cu eticheta lor.
  const upcoming = sorted.filter((b) => (b.status === 'confirmed' || b.status === 'requested') && new Date(b.start).getTime() >= now);
  const past = sorted.filter((b) => !upcoming.includes(b)).reverse();

  const notify = (msg: string) => (Platform.OS === 'web' ? window.alert(msg) : Alert.alert(t('bookings.cancelTitle'), msg));
  const doCancel = (b: Booking) =>
    cancelBooking(b.id).catch((e) => {
      notify(errorMessage(e, t('bookings.cancelFailed')));
      refreshBookings();
    });
  const confirmCancel = (b: Booking) => {
    const msg = b.status === 'requested' ? t('bookings.withdrawAsk') : t('bookings.cancelAsk');
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) doCancel(b);
      return;
    }
    Alert.alert(t('bookings.cancelTitle'), msg, [
      { text: t('common.no'), style: 'cancel' },
      { text: t('bookings.cancelYes'), style: 'destructive', onPress: () => doCancel(b) },
    ]);
  };
  const cancelMs = (business?.cancelHours ?? 0) * 3_600_000;
  const pay = async (b: Booking) => {
    if (!token) return;
    try {
      const { url } = await api.payBooking(token, b.id);
      await Linking.openURL(url);
    } catch (e) {
      notify(errorMessage(e));
    }
  };
  const STATUS: Record<string, string> = { requested: t('bookings.pending'), cancelled: t('status.cancelled'), completed: t('status.completed'), no_show: t('status.noShow') };
  const pending = (b: Booking) => b.status === 'requested';

  const renderItem = (b: Booking, canCancel: boolean) => {
    const start = new Date(b.start);
    const service = serviceById(b.serviceId);
    return (
      <Card key={b.id} style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.cardTitle}>{formatTime(start)}</Text>
          <Text
            style={{
              color: b.status === 'cancelled' || b.status === 'no_show' ? colors.danger : pending(b) ? colors.gold : colors.muted,
              fontSize: 13,
              fontWeight: pending(b) ? '700' : undefined,
            }}
          >
            {STATUS[b.status] ?? formatDate(start)}
          </Text>
        </View>
        {pending(b) ? <Text style={[styles.muted, { fontSize: 12 }]}>{formatDate(start)} · {t('bookings.pendingHint')}</Text> : null}
        {b.requestOutcome === 'refused' ? (
          <Text style={[styles.muted, { fontSize: 12 }]}>
            {t('bookings.refused')}
            {b.refuseReason ? `: ${b.refuseReason}` : ''}
          </Text>
        ) : b.requestOutcome === 'expired' ? (
          <Text style={[styles.muted, { fontSize: 12 }]}>{t('bookings.expired')}</Text>
        ) : null}
        <Text style={styles.text}>{service?.name ?? b.serviceName}</Text>
        {/* Locația, doar când salonul are mai multe. */}
        {locations.length > 1 && (b.locationName || locationById(b.locationId)) ? (
          <Text style={styles.muted}>{locationById(b.locationId)?.name ?? b.locationName}</Text>
        ) : null}
        <Text style={styles.muted}>
          {t('common.with', { name: barberById(b.barberId)?.name ?? b.barberName ?? '' })} ·{' '}
          {b.payment === 'subscription' ? t('bookings.onSubscription') : t('common.lei', { n: (b.payment === 'paid' ? b.paidAmount : (b.price ?? service?.price)) ?? 0 })}
          {b.onlinePaid ? (b.onlineRefunded ? t('bookings.refunded') : t('bookings.paidOnline')) : ''}
        </Text>
        {canCancel && !pending(b) && business?.onlinePayments && !b.onlinePaid && (b.price ?? 0) > 0 ? (
          <View style={{ marginTop: space.sm }}>
            <Button title={t('bookings.payNow')} variant="ghost" onPress={() => pay(b)} />
          </View>
        ) : null}
        {canCancel && pending(b) ? (
          // O cerere neconfirmată se poate retrage oricând.
          <View style={{ marginTop: space.sm }}>
            <Button title={t('bookings.withdraw')} variant="ghost" onPress={() => confirmCancel(b)} />
          </View>
        ) : canCancel && start.getTime() - Date.now() < cancelMs ? (
          <Text style={[styles.muted, { fontSize: 12, marginTop: space.xs }]}>
            {t('bookings.phoneOnly', { h: business?.cancelHours ?? 0 })}
          </Text>
        ) : canCancel ? (
          <View style={{ marginTop: space.sm }}>
            <Button title={t('bookings.cancel')} variant="danger" onPress={() => confirmCancel(b)} />
          </View>
        ) : null}
      </Card>
    );
  };

  const list = tab === 0 ? upcoming : past;

  const leave = async (w: WaitlistEntry) => {
    if (!token) return;
    try {
      await api.leaveWaitlist(token, w.id);
    } catch (e) {
      notify(errorMessage(e));
    }
    loadWaitlist();
  };
  const confirmLeave = (w: WaitlistEntry) => {
    if (Platform.OS === 'web') {
      if (window.confirm(t('wait.removeAsk'))) leave(w);
      return;
    }
    Alert.alert(t('wait.title'), t('wait.removeAsk'), [
      { text: t('common.no'), style: 'cancel' },
      { text: t('wait.remove'), style: 'destructive', onPress: () => leave(w) },
    ]);
  };
  const seeTimes = (w: WaitlistEntry) => {
    resetDraft();
    setDraft({ serviceId: w.serviceId, presetService: true, barberId: w.barberId, locationId: w.barberId ? (barberById(w.barberId)?.locationId ?? null) : (w.locationId ?? null) });
    router.push({ pathname: '/book/time', params: { day: w.day } });
  };
  const waitStatus = (w: WaitlistEntry) =>
    w.status === 'booked' ? t('wait.booked') : !w.active ? t('wait.done', { n: String(w.notifyCount) }) : w.status === 'notified' ? t('wait.notified') : t('wait.waiting');
  // Se văd cele încă deschise și cele încheiate de curând (cu starea lor), cât timp ziua n-a trecut.
  const waiting = waitlist.filter((w) => w.status !== 'expired');

  return (
    <Screen tab>
      <Title>{t('bookings.title')}</Title>
      <Segmented options={[t('bookings.upcoming'), t('bookings.past')]} value={tab} onChange={setTab} />
      {tab === 0 && waiting.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Text style={styles.section}>{t('wait.title')}</Text>
          {waiting.map((w) => (
            <Card key={w.id} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                <Text style={styles.cardTitle}>{formatDate(fromDayKey(w.day))}</Text>
                <Text style={{ color: w.status === 'notified' && w.active ? colors.gold : colors.muted, fontSize: 13, flexShrink: 1, textAlign: 'right' }}>
                  {t(`wait.${w.part}`)}
                </Text>
              </View>
              <Text style={styles.text}>{serviceById(w.serviceId)?.name ?? w.serviceName}</Text>
              <Text style={styles.muted}>
                {t('common.with', { name: w.barberId ? (barberById(w.barberId)?.name ?? w.barberName ?? '') : t('wait.anyBarber') })} · {waitStatus(w)}
              </Text>
              {w.active ? (
                <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button title={t('wait.see')} variant="ghost" onPress={() => seeTimes(w)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title={t('wait.remove')} variant="danger" onPress={() => confirmLeave(w)} />
                  </View>
                </View>
              ) : null}
            </Card>
          ))}
        </View>
      ) : null}
      {list.length === 0 ? (
        <Card style={{ alignItems: 'center', gap: space.md, paddingVertical: space.lg }}>
          <Text style={[styles.title, { fontSize: 22, textAlign: 'center' }]}>{t('bookings.none')}</Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            {tab === 0 ? t('bookings.noneUpcoming') : t('bookings.nonePast')}
          </Text>
          <Button title={t('bookings.bookOne')} onPress={book} />
        </Card>
      ) : (
        list.map((b) => renderItem(b, tab === 0))
      )}
    </Screen>
  );
}
