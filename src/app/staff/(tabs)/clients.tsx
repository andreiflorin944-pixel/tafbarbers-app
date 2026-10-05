import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { staffApi, type StaffClient } from '@/api/staff';
import { styles as ui } from '@/components/ui';
import { formatDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

export default function StaffClients() {
  const { staff, staffToken } = useStaff();
  const [q, setQ] = useState('');
  const [list, setList] = useState<StaffClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!staffToken || !staff?.permissions.clients) return;
    const t = setTimeout(() => {
      staffApi.clients(staffToken, q.trim()).then(setList, (e) => setError(errorMessage(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [q, staffToken, staff]);

  if (!staff) return null;
  if (!staff.permissions.clients)
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: space.md }}>
        <Text style={ui.muted}>Contul tău nu are acces la lista de clienți. Cere-i proprietarului.</Text>
      </SafeAreaView>
    );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: space.md, paddingBottom: space.sm }}>
        <Text style={s.title}>Clienți</Text>
        <View style={s.search}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Caută după nume sau telefon" placeholderTextColor={colors.muted} style={s.input} autoCorrect={false} />
        </View>
      </View>
      {error ? <Text style={{ color: colors.danger, paddingHorizontal: space.md }}>{error}</Text> : null}
      {list === null ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: space.xl }} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: 40 }}
          ListEmptyComponent={<Text style={ui.muted}>{q ? 'Niciun client găsit.' : 'Încă nu există clienți.'}</Text>}
          renderItem={({ item: c }) => (
            <Pressable onPress={() => router.push({ pathname: '/staff/client/[id]', params: { id: c.id } })} style={s.row}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{(c.name || '?').charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ui.cardTitle} numberOfLines={1}>
                  {c.name || 'fără nume'}
                </Text>
                <Text style={ui.muted}>
                  {c.phone}
                  {c.visits ? ` · ${c.visits} ${c.visits === 1 ? 'vizită' : 'vizite'}` : ''}
                  {c.lastVisit ? ` · ultima ${formatDate(new Date(c.lastVisit))}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 26, fontWeight: '800', marginBottom: space.sm },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md },
  input: { flex: 1, color: colors.text, fontSize: 16, height: 46 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm + 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.gold, fontWeight: '800', fontSize: 17 },
});
