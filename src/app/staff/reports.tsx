import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { panelUrl, staffApi, type Report, type ReportCol, type ReportMeta } from '@/api/staff';
import { Button, Card, Screen, styles as ui } from '@/components/ui';
import { addDays, dayKey } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

const lei = (n: number) => `${n.toLocaleString('ro-RO')} lei`;
const cell = (c: ReportCol, v: unknown) => (v === null || v === undefined || v === '' ? '' : c.type === 'money' ? lei(Number(v)) : c.type === 'pct' ? `${v}%` : String(v));
const numeric = (c: ReportCol) => c.type === 'int' || c.type === 'money' || c.type === 'pct';
const width = (c: ReportCol) => (c.type === 'datetime' ? 130 : c.type === 'text' ? 150 : 100);

function periods(range: ReportMeta['range']) {
  const t = new Date();
  const k = dayKey(t);
  if (range === 'day') return [{ label: 'Azi', from: k, to: k }, { label: 'Ieri', from: dayKey(addDays(t, -1)), to: dayKey(addDays(t, -1)) }];
  if (range === 'future')
    return [
      { label: 'Azi', from: k, to: k },
      { label: '7 zile', from: k, to: dayKey(addDays(t, 6)) },
      { label: '30 de zile', from: k, to: dayKey(addDays(t, 29)) },
    ];
  if (range === 'months') return [{ label: 'Ultimele 12 luni', from: dayKey(addDays(t, -364)).slice(0, 8) + '01', to: k }];
  return [
    { label: 'Azi', from: k, to: k },
    { label: '7 zile', from: dayKey(addDays(t, -6)), to: k },
    { label: '30 de zile', from: dayKey(addDays(t, -29)), to: k },
    { label: 'Luna aceasta', from: k.slice(0, 8) + '01', to: k },
    { label: '12 luni', from: dayKey(addDays(t, -364)), to: k },
  ];
}

// Rapoartele în aplicație: se văd pe ecran; descărcarea în Excel se face din panoul web.
export default function StaffReports() {
  const { staff, staffToken } = useStaff();
  const [list, setList] = useState<ReportMeta[] | null>(null);
  const [kind, setKind] = useState('day');
  const [period, setPeriod] = useState(0);
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    if (staffToken) staffApi.reports(staffToken).then(setList, (e) => setError(errorMessage(e)));
  }, [staffToken]);

  const meta = list?.find((r) => r.kind === kind);
  const options = periods(meta?.range ?? 'day');
  const p = options[Math.min(period, options.length - 1)];

  useEffect(() => {
    if (!staffToken || !list) return;
    let stale = false;
    setData(null);
    setError(null);
    setLimit(50);
    staffApi.report(staffToken, kind, p.from, p.to).then(
      (r) => !stale && setData(r),
      (e) => !stale && setError(errorMessage(e)),
    );
    return () => {
      stale = true;
    };
  }, [staffToken, list, kind, p.from, p.to]);

  if (!staff) return null;
  if (!list) return <Screen edges={['bottom']}>{error ? <Text style={{ color: colors.danger }}>{error}</Text> : <ActivityIndicator color={colors.gold} />}</Screen>;

  return (
    <Screen edges={['bottom']}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
        {list.map((r) => (
          <Chip key={r.kind} label={r.title} on={r.kind === kind} onPress={() => (setKind(r.kind), setPeriod(r.range === 'period' ? 2 : 0))} />
        ))}
      </ScrollView>
      <View style={[ui.row, { flexWrap: 'wrap', gap: space.xs, marginTop: space.xs }]}>
        {options.map((o, i) => (
          <Chip key={o.label} label={o.label} on={o === p} onPress={() => setPeriod(i)} small />
        ))}
      </View>
      {!staff.permissions.stats ? <Text style={[ui.muted, { fontSize: 12 }]}>Sumele de bani nu apar pentru contul tău.</Text> : null}
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      {!data && !error ? <ActivityIndicator color={colors.gold} style={{ marginTop: space.lg }} /> : null}
      {data ? (
        data.rows.length === 0 ? (
          <Text style={[ui.muted, { marginTop: space.md }]}>Nu sunt date în perioada aleasă.</Text>
        ) : (
          <>
          {data.columns.length > 3 ? <Text style={[ui.muted, { fontSize: 12 }]}>Trage tabelul spre stânga pentru celelalte coloane.</Text> : null}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <ScrollView horizontal>
              <View>
                <Row cols={data.columns} r={Object.fromEntries(data.columns.map((c) => [c.key, c.label]))} head />
                {data.rows.slice(0, limit).map((r, i) => (
                  <Row key={i} cols={data.columns} r={r} />
                ))}
                {data.totals && limit >= data.rows.length ? <Row cols={data.columns} r={data.totals} bold /> : null}
              </View>
            </ScrollView>
          </Card>
          </>
        )
      ) : null}
      {data && data.rows.length > limit ? <Button title={`Arată mai multe (${data.rows.length - limit})`} variant="ghost" onPress={() => setLimit(limit + 100)} /> : null}
      {panelUrl('reports') ? (
        <Pressable onPress={() => Linking.openURL(panelUrl('reports'))} style={{ marginTop: space.md }}>
          <Text style={[ui.muted, { textAlign: 'center' }]}>
            Pentru Excel, deschide <Text style={{ color: colors.gold }}>Rapoarte în panoul web</Text>
          </Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function Row({ cols, r, head, bold }: { cols: ReportCol[]; r: Record<string, string | number | null>; head?: boolean; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: head ? colors.cardAlt : undefined }}>
      {cols.map((c) => (
        <Text
          key={c.key}
          style={{
            width: width(c),
            paddingHorizontal: 10,
            paddingVertical: 8,
            color: head ? colors.muted : colors.text,
            fontSize: head ? 11 : 13,
            fontWeight: head || bold ? '700' : '400',
            textAlign: numeric(c) ? 'right' : 'left',
          }}
        >
          {head ? String(r[c.key]) : cell(c, r[c.key])}
        </Text>
      ))}
    </View>
  );
}

function Chip({ label, on, onPress, small }: { label: string; on: boolean; onPress: () => void; small?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.gold : colors.border, backgroundColor: on ? colors.gold : colors.card, paddingHorizontal: small ? 10 : 14, paddingVertical: small ? 5 : 8 }}
    >
      <Text style={{ color: on ? colors.onGold : colors.text, fontWeight: '600', fontSize: small ? 12 : 14 }}>{label}</Text>
    </Pressable>
  );
}
