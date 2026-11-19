import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Text, View } from 'react-native';
import { staffApi } from '@/api/staff';
import { AlbumGrid } from '@/components/AlbumGrid';
import { Button, Empty, Screen, styles as ui } from '@/components/ui';
import type { AlbumPhoto } from '@/data/types';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { pickImage } from '@/lib/pickImage';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';
import { colors, space } from '@/theme';

const MAX = 60;

// Albumul meu: frizerul își pune pozele cu tunsorile făcute (din galerie sau cu camera). Clienții le văd la profilul lui,
// în aplicație și pe site. Apăsare lungă pe o poză = ștergere.
export default function StaffAlbum() {
  const { staff, staffToken } = useStaff();
  const { reload } = useApp();
  const { t } = useT();
  const [list, setList] = useState<AlbumPhoto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState(0);

  const tell = (m: string) => (Platform.OS === 'web' ? window.alert(m) : Alert.alert(m));
  const load = useCallback(() => {
    if (!staffToken) return;
    staffApi.myAlbum(staffToken).then(setList, (e) => {
      setList([]);
      tell(errorMessage(e));
    });
  }, [staffToken]);
  useEffect(load, [load]);

  if (!staff || !staffToken) return null;

  const upload = async (camera: boolean) => {
    try {
      const uri = await pickImage({ camera, maxPx: 1280 });
      if (!uri) return;
      setBusy(true);
      const p = await staffApi.addAlbumPhoto(staffToken, uri);
      setList((l) => [p, ...(l ?? [])]);
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
    const yes = async () => {
      try {
        await staffApi.deleteAlbumPhoto(staffToken, p.id);
        setList((l) => (l ?? []).filter((x) => x.id !== p.id));
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
      <Button title={t('myAlbum.add')} onPress={add} loading={busy} disabled={busy || (list?.length ?? 0) >= MAX} />
      {list ? <Text style={[ui.muted, { marginVertical: space.sm, fontSize: 13 }]}>{t('myAlbum.count', { n: list.length, max: MAX })}{list.length ? ` · ${t('myAlbum.deleteHint')}` : ''}</Text> : null}
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
