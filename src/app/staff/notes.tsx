import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { panelUrl, staffApi, type StaffNote } from '@/api/staff';
import { Button, Card, Screen, styles as ui } from '@/components/ui';
import { formatDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

const KIND: Record<StaffNote['kind'], string> = { task: 'Sarcină', script: 'Script de filmat', note: 'Notiță' };
const TABS = [
  { key: 'open', label: 'De făcut' },
  { key: 'done', label: 'Făcute' },
];
const todayKey = () => new Date().toISOString().slice(0, 10);

// Sarcinile și scripturile de filmat date de admin. Frizerul le vede pe ale lui și pe cele pentru toată echipa
// și le bifează când le-a făcut; adminul le scrie din panou.
export default function StaffNotes() {
  const { staff, staffToken } = useStaff();
  const [tab, setTab] = useState('open');
  const [list, setList] = useState<StaffNote[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!staffToken) return;
    setList(null);
    staffApi.notes(staffToken, tab).then(setList, (e) => {
      setError(errorMessage(e));
      setList([]);
    });
  }, [staffToken, tab]);
  useEffect(load, [load]);

  if (!staff || !staffToken) return null;
  const manager = staff.role !== 'barber';

  const toggle = async (n: StaffNote) => {
    setError(null);
    try {
      await staffApi.setNoteDone(staffToken, n.id, !n.doneAt);
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen edges={['bottom']}>
      <View style={{ flexDirection: 'row', gap: space.xs, marginBottom: space.md }}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === t.key }}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 16,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: tab === t.key ? colors.gold : colors.border,
              backgroundColor: tab === t.key ? colors.gold : 'transparent',
            }}
          >
            <Text style={{ color: tab === t.key ? '#000' : colors.text, fontWeight: '700' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={{ color: colors.danger, marginBottom: space.sm }}>{error}</Text> : null}
      {!list ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: space.lg }} />
      ) : list.length === 0 ? (
        <Text style={ui.muted}>{tab === 'open' ? 'Nimic de făcut acum.' : 'Nicio notiță bifată încă.'}</Text>
      ) : (
        <View style={{ gap: space.sm }}>
          {list.map((n) => {
            const late = !n.doneAt && !!n.dueDay && n.dueDay < todayKey();
            const expanded = open === n.id || n.kind === 'script' || n.body.length < 160;
            return (
              <Card key={n.id} style={{ gap: 6, borderColor: late ? colors.danger : n.kind === 'script' ? colors.gold : colors.border }}>
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
                  <Pressable onPress={() => toggle(n)} accessibilityRole="checkbox" accessibilityState={{ checked: !!n.doneAt }} accessibilityLabel="Făcut" hitSlop={10}>
                    <Ionicons name={n.doneAt ? 'checkbox' : 'square-outline'} size={26} color={n.doneAt ? colors.success : colors.gold} />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={[ui.cardTitle, n.doneAt ? { textDecorationLine: 'line-through', color: colors.muted } : null]}>{n.title}</Text>
                    <Text style={[ui.muted, { fontSize: 12 }]}>
                      {KIND[n.kind]}
                      {manager ? ` · ${n.barberName ?? 'toată echipa'}` : !n.barberId ? ' · pentru toată echipa' : ''}
                      {n.dueDay ? ` · până pe ${formatDate(new Date(n.dueDay + 'T12:00:00Z'))}` : ''}
                      {late ? ' · întârziată' : ''}
                      {n.authorName ? ` · de la ${n.authorName}` : ''}
                    </Text>
                  </View>
                </View>
                {n.body ? (
                  expanded ? (
                    <Text selectable style={[ui.text, { lineHeight: 22 }]}>
                      {n.body}
                    </Text>
                  ) : (
                    <Text style={{ color: colors.gold, fontWeight: '700' }} onPress={() => setOpen(n.id)}>
                      Citește tot
                    </Text>
                  )
                ) : null}
                {n.doneAt ? (
                  <Text style={[ui.muted, { fontSize: 12 }]}>
                    Făcută pe {formatDate(new Date(n.doneAt))}
                    {n.doneByName ? ` de ${n.doneByName}` : ''}
                  </Text>
                ) : null}
              </Card>
            );
          })}
        </View>
      )}
      {manager ? (
        <View style={{ marginTop: space.lg }}>
          <Button
            title="Scrie o notiță nouă (în panou)"
            variant="ghost"
            onPress={() => {
              const url = panelUrl('notes');
              if (url) Linking.openURL(url);
            }}
          />
        </View>
      ) : null}
    </Screen>
  );
}
