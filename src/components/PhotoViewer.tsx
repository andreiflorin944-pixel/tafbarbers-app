import { Ionicons } from '@expo/vector-icons';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { mediaUrl } from '@/api/staff';
import type { IdentityPhoto } from '@/data/types';
import { useT } from '@/i18n';
import { colors, space } from '@/theme';

/** Poza pe tot ecranul, cu săgeți între poze; așa i-o arăți frizerului. */
export function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
  onDelete,
}: {
  photos: IdentityPhoto[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDelete?: (p: IdentityPhoto) => void;
}) {
  const { t } = useT();
  if (index === null || !photos[index]) return null;
  const p = photos[index];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Image source={{ uri: mediaUrl(p.url)! }} style={s.img} resizeMode="contain" accessibilityLabel={p.caption || t('photo.photo')} />
        <View style={s.top}>
          <Text style={s.count}>
            {index + 1} / {photos.length}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {onDelete ? (
              <Pressable onPress={() => onDelete(p)} style={s.btn} accessibilityLabel={t('photo.delete')}>
                <Ionicons name="trash-outline" size={22} color="#fff" />
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} style={s.btn} accessibilityLabel={t('common.close')}>
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>
        </View>
        {p.caption || p.addedBy ? (
          <Text style={s.caption}>
            {p.caption}
            {p.addedBy ? `${p.caption ? ' · ' : ''}${t('photo.addedBy', { name: p.addedBy })}` : ''}
          </Text>
        ) : null}
        {index > 0 ? (
          <Pressable onPress={() => onIndex(index - 1)} style={[s.nav, { left: space.sm }]} accessibilityLabel={t('photo.prev')}>
            <Ionicons name="chevron-back" size={30} color="#fff" />
          </Pressable>
        ) : null}
        {index < photos.length - 1 ? (
          <Pressable onPress={() => onIndex(index + 1)} style={[s.nav, { right: space.sm }]} accessibilityLabel={t('photo.next')}>
            <Ionicons name="chevron-forward" size={30} color="#fff" />
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)', justifyContent: 'center' },
  img: { width: '100%', height: '80%' },
  top: { position: 'absolute', top: 48, left: space.md, right: space.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { color: '#fff', fontWeight: '700' },
  btn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  caption: { position: 'absolute', bottom: 48, left: space.lg, right: space.lg, color: '#fff', textAlign: 'center', fontSize: 15 },
  nav: { position: 'absolute', top: '45%', width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
});

/** Grila de poze mici (3 pe rând), cu un pătrat „Adaugă” la final când e loc. */
export function PhotoGrid({ photos, onOpen, onAdd, busy }: { photos: IdentityPhoto[]; onOpen: (i: number) => void; onAdd?: () => void; busy?: boolean }) {
  const { t } = useT();
  return (
    <View style={g.grid}>
      {photos.map((p, i) => (
        <Pressable key={p.id} onPress={() => onOpen(i)} style={g.cell} accessibilityLabel={t('photo.n', { n: i + 1 })}>
          <Image source={{ uri: mediaUrl(p.url)! }} style={g.img} />
        </Pressable>
      ))}
      {onAdd ? (
        <Pressable onPress={onAdd} disabled={busy} style={[g.cell, g.add]} accessibilityLabel={t('photo.add')}>
          <Ionicons name={busy ? 'hourglass-outline' : 'add'} size={30} color={colors.gold} />
          <Text style={{ color: colors.gold, fontSize: 12, fontWeight: '700' }}>{busy ? t('photo.uploading') : t('common.add')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const g = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cell: { width: '31.5%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.card },
  img: { width: '100%', height: '100%' },
  add: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.gold, borderStyle: 'dashed', gap: 2 },
});
