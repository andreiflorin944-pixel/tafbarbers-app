import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { useT } from '@/i18n';
import { colors } from '@/theme';

/**
 * Butonul „Înapoi” din colțul ecranelor deschise ca fereastră (modal): pe iPhone ele n-au săgeată de întoarcere,
 * iar clienții nu știu să tragă fereastra în jos. Închide fereastra sau, dacă nu are unde reveni, duce la Acasă.
 */
export function HeaderBack() {
  const { t } = useT();
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      hitSlop={12}
      style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 8 }}
      accessibilityRole="button"
      accessibilityLabel={t('nav.back')}
    >
      <Ionicons name="chevron-back" size={24} color={colors.gold} />
      <Text style={{ color: colors.gold, fontSize: 16, fontWeight: '600' }}>{t('nav.back')}</Text>
    </Pressable>
  );
}
