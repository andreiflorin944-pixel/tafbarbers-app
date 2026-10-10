import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Text, TextInput, View } from 'react-native';
import { api } from '@/api';
import { useLoginGate } from '@/components/LoginGate';
import { PhotoGrid, PhotoViewer } from '@/components/PhotoViewer';
import { Button, Card, Screen, styles } from '@/components/ui';
import type { Identity, IdentityPhoto } from '@/data/types';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { pickImage } from '@/lib/pickImage';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

const MAX = 5;

// TAF Identity: până la 5 poze și o descriere a tunsorii dorite. Le vede și frizerul.
export default function IdentityScreen() {
  const { token } = useApp();
  const { t } = useT();
  const gate = useLoginGate();
  const [data, setData] = useState<Identity | null>(null);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getIdentity(token).then(
      (d) => {
        setData(d);
        setNote(d.note);
      },
      (e) => setError(errorMessage(e)),
    );
  }, [token]);

  if (gate) return gate;
  if (!data) {
    return (
      <Screen edges={[]}>
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : <ActivityIndicator color={colors.gold} />}
      </Screen>
    );
  }

  const add = async (camera: boolean) => {
    if (!token) return;
    setError(null);
    try {
      const uri = await pickImage({ camera });
      if (!uri) return;
      setBusy(true);
      const p = await api.addIdentityPhoto(token, uri);
      setData((d) => d && { ...d, photos: [...d.photos, p] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseSource = () => {
    if (Platform.OS === 'web') return add(false);
    Alert.alert(t('photo.add'), undefined, [
      { text: t('photo.gallery'), onPress: () => add(false) },
      { text: t('photo.camera'), onPress: () => add(true) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const remove = (p: IdentityPhoto) => {
    const go = async () => {
      if (!token) return;
      try {
        await api.removeIdentityPhoto(token, p.id);
        setOpen(null);
        setData((d) => d && { ...d, photos: d.photos.filter((x) => x.id !== p.id) });
      } catch (e) {
        setError(errorMessage(e));
      }
    };
    if (Platform.OS === 'web') return window.confirm(t('photo.deleteAsk')) && go();
    Alert.alert(t('photo.deleteAsk'), undefined, [
      { text: t('common.no'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: go },
    ]);
  };

  const saveNote = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api.saveIdentityNote(token, note.trim());
      setData(d);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Text style={[styles.muted, { marginBottom: space.md }]}>{t('identity.intro')}</Text>

      <Text style={styles.label}>{t('identity.photos', { n: data.photos.length, max: MAX })}</Text>
      <PhotoGrid photos={data.photos} onOpen={setOpen} onAdd={data.photos.length < MAX ? chooseSource : undefined} busy={busy} />
      {data.photos.length ? (
        <Text style={[styles.muted, { fontSize: 12, marginTop: space.xs }]}>{t('identity.tapHint')}</Text>
      ) : null}

      <Text style={[styles.label, { marginTop: space.lg }]}>{t('identity.noteTitle')}</Text>
      <TextInput
        value={note}
        onChangeText={(v) => {
          setNote(v);
          setSaved(false);
        }}
        multiline
        maxLength={1000}
        placeholder={t('identity.notePh')}
        placeholderTextColor={colors.muted}
        style={[styles.input, { minHeight: 110, textAlignVertical: 'top', paddingTop: 12 }]}
      />
      <View style={{ marginTop: space.md }}>
        <Button title={saved && note.trim() === data.note ? t('identity.saved') : t('identity.saveNote')} onPress={saveNote} loading={busy} disabled={note.trim() === data.note} />
      </View>
      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}

      <Card style={{ marginTop: space.lg }}>
        <Text style={styles.muted}>{t('identity.privacy')}</Text>
      </Card>

      <PhotoViewer photos={data.photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} onDelete={remove} />
    </Screen>
  );
}
