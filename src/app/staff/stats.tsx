import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { staffApi, type StaffDashboard } from '@/api/staff';
import { Button, Card, Screen, Segmented, styles as ui } from '@/components/ui';
import { formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

const MONTHS = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const shortDay = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const lei = (n: number) => `${n.toLocaleString('ro-RO')} lei`;
const TAGS: Record<string, { label: string; color: string }> = {
  new: { label: 'Client nou', color: '#7FB6E6' },
  top: { label: 'Client de top', color: colors.gold },
  back: { label: 'Revine după mult timp', color: '#8FC79A' },
};

// Tabloul de bord în aplicația echipei: aceleași cifre ca în panou, limitate de drepturile contului.
export default function StaffStats() {
  const { staff, staffToken } = useStaff();
  const [d, setD] = useState<StaffDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState(0);

  useEffect(() => {
    if (staffToken) staffApi.dashboard(staffToken).then(setD, (e) => setError(errorMessage(e)));
  }, [staffToken]);

  if (!staff) return null;
  if (!d)
    return <Screen edges={['bottom']}>{error ? <Text style={{ color: colors.danger }}>{error}</Text> : <ActivityIndicator color={colors.gold} />}</Screen>;

  const money = d.canSeeMoney && metric === 0;
  const { current: cur, previous: prev } = d.week;

  return (
    <Screen edges={['bottom']}>
      {!staff.permissions.bookings_all ? <Text style={ui.muted}>Vezi doar cifrele tale.</Text> : null}
      <Text style={ui.section}>Ultimele 7 zile față de cele 7 dinainte</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Kpi l="programări" v={cur.bookings} p={prev.bookings} />
        {cur.revenue !== null ? <Kpi l="încasări" v={cur.revenue} p={prev.revenue ?? 0} money /> : null}
        <Kpi l="clienți serviți" v={cur.clients} p={prev.clients} />
        <Kpi l="clienți noi" v={cur.newClients} p={prev.newClients} />
        <Kpi l="anulări și neprezentări" v={cur.cancelled + cur.noShow} p={prev.cancelled + prev.noShow} inverse />
        <Kpi l="programări viitoare" v={d.upcoming} />
      </View>

      <Text style={ui.section}>Ultimele 30 de zile</Text>
      <Card>
        {d.canSeeMoney ? <Segmented options={['Încasări', 'Programări']} value={metric} onChange={setMetric} /> : null}
        <Bars values={d.daily.map((x) => (money ? x.revenue : x.bookings) ?? 0)} labels={d.daily.map((x) => shortDay(x.day))} money={money} />
      </Card>

      <Text style={ui.section}>Clienți</Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Kpi l={`noi în 30 de zile, din ${d.last30.clients}`} v={d.last30.newClients} />
        <Kpi l={`păstrare: ${d.retention.returned} din ${d.retention.base} au revenit`} v={d.retention.rate} pct />
      </View>

      <Text style={ui.section}>Clienții de azi ({d.todayClients.length})</Text>
      {d.todayClients.length === 0 ? <Text style={ui.muted}>Nicio programare azi.</Text> : null}
      <View style={{ gap: space.sm }}>
        {d.todayClients.map((c) => (
          <Card key={c.bookingId} onPress={staff.permissions.clients ? () => router.push(`/staff/client/${c.clientId}`) : undefined}>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={[ui.cardTitle, { flex: 1 }]}>
                {formatTime(new Date(c.start))} · {c.name}
              </Text>
              <Text style={ui.muted}>{c.tags.includes('new') ? 'prima vizită' : c.visits === 1 ? 'o vizită' : `${c.visits} vizite`}</Text>
            </View>
            <Text style={ui.muted}>
              {c.serviceName} · {c.barberName}
            </Text>
            {c.tags.length ? (
              <View style={[ui.row, { flexWrap: 'wrap', gap: 6, marginTop: 6 }]}>
                {c.tags.map((t) => (
                  <Text key={t} style={{ color: TAGS[t].color, borderColor: TAGS[t].color, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, fontSize: 12, fontWeight: '700' }}>
                    {TAGS[t].label}
                  </Text>
                ))}
              </View>
            ) : null}
          </Card>
        ))}
      </View>

      {staff.permissions.clients && d.atRisk.length ? (
        <>
          <Text style={ui.section}>Clienți în pericol</Text>
          <Text style={ui.muted}>Veneau regulat, dar nu au mai venit de mult și nu au nicio programare.</Text>
          <View style={{ gap: space.sm }}>
            {d.atRisk.map((c) => (
              <Card key={c.clientId} onPress={() => router.push(`/staff/client/${c.clientId}`)}>
                <View style={[ui.row, { justifyContent: 'space-between' }]}>
                  <Text style={[ui.cardTitle, { flex: 1 }]}>{c.name}</Text>
                  <Text style={{ color: colors.danger, fontWeight: '700' }}>{c.daysSince} zile</Text>
                </View>
                <Text style={ui.muted}>
                  {c.visits} vizite, de obicei la {c.avgGapDays} zile
                </Text>
              </Card>
            ))}
          </View>
        </>
      ) : null}

      {staff.permissions.clients && d.topClients.length ? (
        <>
          <Text style={ui.section}>Top clienți, ultimul an</Text>
          <Card style={{ paddingVertical: space.xs }}>
            {d.topClients.map((c, i) => (
              <Pressable key={c.clientId} onPress={() => router.push(`/staff/client/${c.clientId}`)} style={[ui.row, { paddingVertical: 8, borderBottomWidth: i < d.topClients.length - 1 ? 1 : 0, borderBottomColor: colors.border }]}>
                <Text style={[ui.muted, { width: 22 }]}>{i + 1}</Text>
                <Text style={[ui.text, { flex: 1, fontWeight: '600' }]}>{c.name}</Text>
                <Text style={ui.muted}>{c.visits} viz.</Text>
                {c.spent !== null ? <Text style={[ui.text, { width: 90, textAlign: 'right' }]}>{lei(c.spent)}</Text> : null}
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}

      <View style={{ marginTop: space.md }}>
        <Button title="Rapoarte" variant="ghost" onPress={() => router.push('/staff/reports')} />
      </View>
    </Screen>
  );
}

function Kpi({ l, v, p, money, inverse, pct }: { l: string; v: number; p?: number; money?: boolean; inverse?: boolean; pct?: boolean }) {
  const diff = p === undefined ? null : p ? Math.round(((v - p) / p) * 100) : v ? 100 : 0;
  const good = diff !== null && (inverse ? diff < 0 : diff > 0);
  return (
    <View style={[ui.card, { flexGrow: 1, flexBasis: '45%', padding: space.sm + 4 }]}>
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>{money ? lei(v) : pct ? `${v}%` : v}</Text>
      <Text style={[ui.muted, { fontSize: 12 }]}>{l}</Text>
      {diff !== null ? (
        <Text style={{ fontSize: 12, fontWeight: '700', color: diff === 0 ? colors.muted : good ? '#8FC79A' : colors.danger }}>
          {diff === 0 ? '= la fel' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}%`} <Text style={[ui.muted, { fontSize: 12, fontWeight: '400' }]}>înainte: {money ? lei(p!) : p}</Text>
        </Text>
      ) : null}
    </View>
  );
}

function Bars({ values, labels, money }: { values: number[]; labels: string[]; money: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <View>
      <Text style={[ui.muted, { fontSize: 11 }]}>{money ? lei(max) : max}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 2, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {values.map((v, i) => (
          <View key={i} style={{ flex: 1, height: `${Math.max(1, (v / max) * 100)}%`, backgroundColor: colors.gold, borderTopLeftRadius: 2, borderTopRightRadius: 2, opacity: v ? 1 : 0.25 }} />
        ))}
      </View>
      <View style={[ui.row, { justifyContent: 'space-between', marginTop: 4 }]}>
        <Text style={[ui.muted, { fontSize: 11 }]}>{labels[0]}</Text>
        <Text style={[ui.muted, { fontSize: 11 }]}>{labels[Math.floor(labels.length / 2)]}</Text>
        <Text style={[ui.muted, { fontSize: 11 }]}>{labels[labels.length - 1]}</Text>
      </View>
    </View>
  );
}
