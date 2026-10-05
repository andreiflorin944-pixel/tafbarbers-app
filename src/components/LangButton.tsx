import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { LANGS, useT } from '@/i18n';
import { colors, radius, space } from '@/theme';

export function LangButton() {
  const { lang, setLang, t } = useT();
  const [open, setOpen] = useState(false);
  const current = LANGS.find((l) => l.code === lang)!;

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={s.btn} accessibilityLabel={t('lang.title')}>
        <Text style={s.flag}>{current.flag}</Text>
        <Text style={s.code}>{current.code.toUpperCase()}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.title}>{t('lang.title')}</Text>
            {LANGS.map((l) => (
              <Pressable
                key={l.code}
                onPress={() => {
                  setLang(l.code);
                  setOpen(false);
                }}
                style={[s.row, l.code === lang && { borderColor: colors.gold }]}
              >
                <Text style={s.flag}>{l.flag}</Text>
                <Text style={s.name}>{l.name}</Text>
                {l.code === lang ? <Ionicons name="checkmark" size={20} color={colors.gold} /> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 12, borderRadius: 22, backgroundColor: colors.cardAlt },
  flag: { fontSize: 20 },
  code: { color: colors.text, fontSize: 13, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: space.lg },
  sheet: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, gap: space.sm, width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  name: { flex: 1, color: colors.text, fontSize: 16 },
});
