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
  const { user, token, bookings, cancelBooking, serviceById, barberById, resetDraft, setDraft, business, refreshBookings } = useApp();
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
    router.push('/book/service');
  };

  if (!user) {
    return (
      <Screen tab>
        <Title>{t('bookings.title')}</Title>
        <Empty icon="calendar-outline" text="Intră în cont ca să-ți vezi programările." />
        <View style={{ gap: space.sm }}>
          <Button title="Intră în cont" onPress={() => router.push('/login')} />
          <Button title="Creează cont" variant="ghost" onPress={() => router.push({ pathname: '/login', params: { mode: 'register' } })} />
        </View>
      </Screen>
    );
  }

  const now = Date.now();
  const sorted = [...bookings].sort((a, b) => a.start.localeCompare(b.start));
  // Cererile în așteptare stau tot la „Urmează”, cu eticheta lor.
  const upcoming = sorted.filter((b) => (b.status === 'confirmed' || b.status === 'requested') && new Date(b.start).getTime() >= now);
  const past = sorted.filter((b) => !upcoming.includes(b)).reverse();

  const notify = (msg: string) => (Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Anulare', msg));
  const doCancel = (b: Booking) =>
    cancelBooking(b.id).catch((e) => {
      notify(errorMessage(e, 'Nu am putut anula programarea.'));
      refreshBookings();
    });
  const confirmCancel = (b: Booking) => {
    const msg = b.status === 'requested' ? t('bookings.withdrawAsk') : 'Sigur vrei să anulezi programarea?';
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) doCancel(b);
      return;
    }
    Alert.alert('Anulare', msg, [
      { text: 'Nu', style: 'cancel' },
      { text: 'Da, anulează', style: 'destructive', onPress: () => doCancel(b) },
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
  const STATUS: Record<string, string> = { requested: t('bookings.pending'), cancelled: 'Anulată', completed: 'Finalizată', no_show: 'Neprezentare' };
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
        <Text style={styles.muted}>
          cu {barberById(b.barberId)?.name ?? b.barberName} ·{' '}
          {b.payment === 'subscription' ? 'pe abonament' : `${b.payment === 'paid' ? b.paidAmount : (b.price ?? service?.price)} lei`}
          {b.onlinePaid ? (b.onlineRefunded ? ' · banii returnați pe card' : ' · plătită online') : ''}
        </Text>
        {canCancel && !pending(b) && business?.onlinePayments && !b.onlinePaid && (b.price ?? 0) > 0 ? (
          <View style={{ marginTop: space.sm }}>
            <Button title="Plătește acum cu cardul" variant="ghost" onPress={() => pay(b)} />
          </View>
        ) : null}
        {canCancel && pending(b) ? (
          // O cerere neconfirmată se poate retrage oricând.
          <View style={{ marginTop: space.sm }}>
            <Button title={t('bookings.withdraw')} variant="ghost" onPress={() => confirmCancel(b)} />
          </View>
        ) : canCancel && start.getTime() - Date.now() < cancelMs ? (
          <Text style={[styles.muted, { fontSize: 12, marginTop: space.xs }]}>
            Se mai poate anula doar telefonic (mai puțin de {business?.cancelHours} ore până la programare).
          </Text>
        ) : canCancel ? (
          <View style={{ marginTop: space.sm }}>
            <Button title="Anulează" variant="danger" onPress={() => confirmCancel(b)} />
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
      { text: 'Nu', style: 'cancel' },
      { text: t('wait.remove'), style: 'destructive', onPress: () => leave(w) },
    ]);
  };
  const seeTimes = (w: WaitlistEntry) => {
    resetDraft();
    setDraft({ serviceId: w.serviceId, barberId: w.barberId });
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
                cu {w.barberId ? (barberById(w.barberId)?.name ?? w.barberName) : t('wait.anyBarber')} · {waitStatus(w)}
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
          <Text style={[styles.title, { fontSize: 22, textAlign: 'center' }]}>Nu s-au găsit programări</Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            {tab === 0 ? 'Nu ai nicio programare viitoare.' : 'Nu ai încă programări în istoric.'}
          </Text>
          <Button title="Rezervă o programare" onPress={book} />
        </Card>
      ) : (
        list.map((b) => renderItem(b, tab === 0))
      )}
    </Screen>
  );
}
