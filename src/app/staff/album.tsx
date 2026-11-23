import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { staffApi, type StaffBarber } from '@/api/staff';
import { AlbumGrid } from '@/components/AlbumGrid';
import { Button, Empty, Screen, styles as ui } from '@/components/ui';
import type { AlbumPhoto } from '@/data/types';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { pickImage } from '@/lib/pickImage';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

const MAX = 60;

// Albumul cu lucrări: frizerul își pune pozele cu tunsorile făcute (din galerie sau cu camera). Clienții le văd când intră
// pe frizer, în aplicație și pe site. Apăsare lungă pe o poză = ștergere. Patronul alege frizerul și lucrează în albumul
// oricui (și când contul lui nu e legat de un frizer).
export default function StaffAlbum() {
  const { staff, staffToken } = useStaff();
  const { reload } = useApp();
  const { t } = useT();
  const owner = !!staff?.owner;
  const [barbers, setBarbers] = useState<StaffBarber[]>([]);
  const [who, setWho] = useState<string | null>(staff?.barberId ?? null);
  const [list, setList] = useState<AlbumPhoto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState(0);
  // Albumul propriu merge prin /me/album; al altui frizer, doar pentru patron, prin /barbers/:id/album.
  const mine = !!who && who === staff?.barberId;

  const tell = (m: string) => (Platform.OS === 'web' ? window.alert(m) : Alert.alert(m));
  const load = useCallback(() => {
    if (!staffToken) return;
    setList(null);
    if (owner) {
      staffApi.barbers(staffToken).then(
        (bs) => {
          const active = bs.filter((b) => b.active);
          setBarbers(active);
          const pick = who ?? active[0]?.id ?? null;
          if (!who && pick) setWho(pick);
          setList(active.find((b) => b.id === pick)?.album ?? []);
        },
        (e) => {
          setList([]);
          tell(errorMessage(e));
        },
      );
    } else if (staff?.barberId) {
      staffApi.myAlbum(staffToken).then(setList, (e) => {
        setList([]);
        tell(errorMessage(e));
      });
    } else setList([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffToken, owner, who]);
  useEffect(load, [load]);

  if (!staff || !staffToken) return null;

  // Cont de frizer care nu e legat de profilul lui de frizer: nu are unde pune pozele.
  if (!owner && !staff.barberId) {
    return (
      <Screen edges={['bottom']}>
        <Empty icon="link-outline" text={t('myAlbum.noBarber')} />
      </Screen>
    );
  }

  const upload = async (camera: boolean) => {
    if (!who) return;
    try {
      const uri = await pickImage({ camera, maxPx: 1280 });
      if (!uri) return;
      setBusy(true);
      const p = mine ? await staffApi.addAlbumPhoto(staffToken, uri) : await staffApi.addBarberAlbumPhoto(staffToken, who, uri);
      setList((l) => [p, ...(l ?? [])]);
      setBarbers((bs) => bs.map((b) => (b.id === who ? { ...b, album: [p, ...(b.album ?? [])] } : b)));
      // Lista de frizeri a aplicației (profilul văzut de clienți) se reîncarcă, ca poza să apară imediat.
      reload();
    } catch (e) {
      tell(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    if (Platform.OS === 'web') return void upload(false);
    Alert.alert(t('myAlbum.add'), undefined, [
      { text: t('menu.photoCamera'), onPress: () => void upload(true) },
      { text: t('menu.photoGallery'), onPress: () => void upload(false) },
      { text: t('common.no'), style: 'cancel' },
    ]);
  };
  const remove = (p: AlbumPhoto) => {
    if (!who) return;
    const yes = async () => {
      try {
        if (mine) await staffApi.deleteAlbumPhoto(staffToken, p.id);
        else await staffApi.deleteBarberAlbumPhoto(staffToken, who, p.id);
        setList((l) => (l ?? []).filter((x) => x.id !== p.id));
        setBarbers((bs) => bs.map((b) => (b.id === who ? { ...b, album: (b.album ?? []).filter((x) => x.id !== p.id) } : b)));
        reload();
      } catch (e) {
        tell(errorMessage(e));
      }
    };
    if (Platform.OS === 'web') return window.confirm(t('myAlbum.deleteAsk')) && void yes();
    Alert.alert(t('myAlbum.deleteAsk'), undefined, [
      { text: t('common.no'), style: 'cancel' },
      { text: t('myAlbum.delete'), style: 'destructive', onPress: () => void yes() },
    ]);
  };

  return (
    <Screen edges={['bottom']}>
      <Text style={[ui.muted, { marginBottom: space.md, lineHeight: 20 }]}>{t('myAlbum.hint')}</Text>
      {owner && barbers.length > 1 ? (
        <>
          <Text style={[ui.label, { marginBottom: space.xs }]}>{t('myAlbum.whose')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, marginBottom: space.md }}>
            {barbers.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => {
                  setWho(b.id);
                  setList(b.album ?? []);
                }}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: b.id === who ? colors.gold : colors.border, backgroundColor: b.id === who ? colors.gold : 'transparent' }}
                accessibilityRole="button"
              >
                <Text style={{ color: b.id === who ? colors.onGold : colors.text, fontWeight: '600' }}>{b.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}
      <Button title={t('myAlbum.add')} onPress={add} loading={busy} disabled={busy || !who || (list?.length ?? 0) >= MAX} />
      {list ? (
        <Text style={[ui.muted, { marginVertical: space.sm, fontSize: 13 }]}>
          {t('myAlbum.count', { n: list.length, max: MAX })}
          {list.length ? ` · ${t('myAlbum.deleteHint')}` : ''}
        </Text>
      ) : null}
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {!list ? (
          <ActivityIndicator color={colors.gold} style={{ marginTop: space.lg }} />
        ) : !list.length ? (
          <Empty icon="images-outline" text={t('myAlbum.empty')} />
        ) : width ? (
          <AlbumGrid photos={list} width={width} onLongPress={remove} />
        ) : null}
      </View>
    </Screen>
  );
}
