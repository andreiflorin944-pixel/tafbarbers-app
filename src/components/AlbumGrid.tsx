import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { mediaUrl } from '@/api/staff';
import type { AlbumPhoto } from '@/data/types';
import { useT } from '@/i18n';
import { colors, radius } from '@/theme';

// Albumul cu lucrări al unui frizer: grilă cu 3 poze pe rând; la apăsare poza se deschide mare, pe tot ecranul,
// și se poate trece la următoarea cu degetul (stânga / dreapta). `onLongPress`: în aplicația echipei, pentru ștergere.

const GAP = 4;

export function AlbumGrid({ photos, width, onLongPress }: { photos: AlbumPhoto[]; width: number; onLongPress?: (p: AlbumPhoto) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const size = Math.floor((width - GAP * 2) / 3);
  return (
    <>
      <View style={s.grid}>
        {photos.map((p, i) => (
          <Pressable
            key={p.id}
            onPress={() => setOpen(i)}
            onLongPress={onLongPress ? () => onLongPress(p) : undefined}
            style={({ pressed }) => [{ width: size, height: size }, pressed && { opacity: 0.8 }]}
            accessibilityRole="imagebutton"
          >
            <Image source={{ uri: mediaUrl(p.url)! }} style={s.thumb} resizeMode="cover" />
          </Pressable>
        ))}
      </View>
      <PhotoViewer photos={photos} index={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** Pozele mari, pe tot ecranul, cu „1 / 12” sus și X de închidere. */
export function PhotoViewer({ photos, index, onClose }: { photos: AlbumPhoto[]; index: number | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const { t } = useT();
  const [at, setAt] = useState(0);
  return (
    <Modal visible={index !== null} animationType="fade" transparent={false} onRequestClose={onClose} onShow={() => setAt(index ?? 0)} supportedOrientations={['portrait', 'landscape']}>
      <View style={s.viewer}>
        {index !== null ? (
          <FlatList
            data={photos}
            keyExtractor={(p) => p.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={(e) => setAt(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => <Image source={{ uri: mediaUrl(item.url)! }} style={{ width, height }} resizeMode="contain" />}
          />
        ) : null}
        <SafeAreaView edges={['top']} style={s.top} pointerEvents="box-none">
          <Text style={s.counter}>{photos.length > 1 ? `${at + 1} / ${photos.length}` : ''}</Text>
          <Pressable onPress={onClose} hitSlop={12} style={s.close} accessibilityRole="button" accessibilityLabel={t('album.close')}>
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  thumb: { width: '100%', height: '100%', borderRadius: radius.sm, backgroundColor: colors.card },
  viewer: { flex: 1, backgroundColor: '#000000' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  counter: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
});
