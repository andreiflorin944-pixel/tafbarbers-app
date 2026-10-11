import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { staffApi, type StaffActivity, type StaffBooking } from "@/api/staff";
import { Button, styles as ui } from "@/components/ui";
import { useT, type Key } from "@/i18n";
import { addDays, dayKey, dayOfMonth, formatDate, formatTime, fromDayKey, shortDay, shortMonth, startOfDay } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { useApp } from "@/state/AppState";
import { useStaff } from "@/state/Staff";
import { colors, radius, space } from "@/theme";

/**
 * „Modifică programarea” din aplicația echipei, ca „Salvează modificările” din panou: altă zi și oră (dintre cele libere,
 * ora de acum contând ca liberă), alt serviciu, alt frizer (cine vede tot salonul) și alt preț sau o reducere (cine vede încasările).
 */
export function BookingEdit({ booking: b, onCancel, onDone }: { booking: StaffBooking; onCancel: () => void; onDone: (b: StaffBooking, msg: string) => void }) {
  const { staff, staffToken } = useStaff();
  const { services, barbers } = useApp();
  const { t } = useT();
  const p = staff!.permissions;
  const canPickBarber = p.bookings_all || !staff!.barberId;
  const [serviceId, setServiceId] = useState(b.serviceId);
  const [barberId, setBarberId] = useState(b.barberId);
  const firstDay = dayKey(new Date(Math.min(Date.now(), new Date(b.start).getTime())));
  const days = useMemo(() => Array.from({ length: 45 }, (_, i) => addDays(startOfDay(fromDayKey(firstDay)), i)), [firstDay]);
  const [day, setDay] = useState(dayKey(new Date(b.start)));
  const [start, setStart] = useState<string | null>(b.start);
  const [slots, setSlots] = useState<Array<{ start: string; membersOnly?: boolean }> | null>(null);
  const [price, setPrice] = useState(String(b.price));
  const [discount, setDiscount] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!staffToken) return;
    setSlots(null);
    staffApi.freeSlots(staffToken, serviceId, barberId, day, b.id).then(
      (list) => {
        setSlots(list);
        // Ora aleasă rămâne doar dacă e liberă și în ziua nouă (la alt serviciu sau frizer se alege din nou).
        setStart((cur) => (cur && list.some((x) => x.start === cur) ? cur : null));
      },
      () => setSlots([]),
    );
  }, [serviceId, barberId, day, staffToken, b.id]);

  const barber = barbers.find((x) => x.id === barberId);
  const service = services.find((x) => x.id === serviceId);
  const listPrice = serviceId === b.serviceId && barberId === b.barberId ? b.price : (barber?.prices?.[serviceId] ?? service?.price ?? b.price);
  const priceNum = Number(price.replace(",", "."));
  const priceChanged = p.stats && price.trim() !== "" && priceNum !== listPrice;
  const moved = !!start && (start !== b.start || barberId !== b.barberId);
  const changed = moved || serviceId !== b.serviceId || barberId !== b.barberId || priceChanged;
  const needsTime = (serviceId !== b.serviceId || barberId !== b.barberId || day !== dayKey(new Date(b.start))) && !start;
  // La alt serviciu (sau frizer), prețul urmează lista, cât timp nu l-ai schimbat de mână.
  useEffect(() => {
    if (!discount) setPrice(String(listPrice));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listPrice]);

  const applyDiscount = (pct: number) => {
    setPrice(String(Math.round(listPrice * (1 - pct / 100))));
    setDiscount(`${pct}%`);
  };

  const save = async () => {
    if (!staffToken) return;
    setBusy(true);
    setError(null);
    try {
      const nb = await staffApi.editBooking(staffToken, b.id, {
        ...(start && start !== b.start && { start }),
        ...(barberId !== b.barberId && { barberId }),
        ...(serviceId !== b.serviceId && { serviceId }),
        ...(priceChanged && !(priceNum >= 0) ? {} : priceChanged ? { price: priceNum, discount } : {}),
        notify,
      });
      onDone(nb, moved && notify ? t("sedit.savedMoved") : t("sedit.saved"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <Text style={ui.label}>{t("snew.service")}</Text>
      <View style={s.wrap}>
        {services.map((sv) => (
          <Pressable key={sv.id} onPress={() => setServiceId(sv.id)} style={[s.chip, sv.id === serviceId && s.chipOn]} accessibilityState={{ selected: sv.id === serviceId }}>
            <Text style={[s.chipText, sv.id === serviceId && { color: colors.onGold }]}>
              {sv.name.split(" / ")[0]} · {barber?.durations?.[sv.id] ?? sv.durationMin}m
            </Text>
          </Pressable>
        ))}
      </View>

      {canPickBarber ? (
        <>
          <Text style={ui.label}>{t("snew.barber")}</Text>
          <View style={s.wrap}>
            {barbers.map((x) => (
              <Pressable key={x.id} onPress={() => setBarberId(x.id)} style={[s.chip, x.id === barberId && s.chipOn]} accessibilityState={{ selected: x.id === barberId }}>
                <Text style={[s.chipText, x.id === barberId && { color: colors.onGold }]}>{x.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <Text style={ui.label}>{t("snew.day")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {days.map((d) => {
          const key = dayKey(d);
          const on = key === day;
          return (
            <Pressable key={key} onPress={() => setDay(key)} style={[s.day, on && s.dayOn]} accessibilityState={{ selected: on }}>
              <Text style={[s.small, on && { color: colors.onGold }]}>{shortDay(d)}</Text>
              <Text style={[s.num, on && { color: colors.onGold }]}>{dayOfMonth(d)}</Text>
              <Text style={[s.small, on && { color: colors.onGold }]}>{shortMonth(d)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={ui.label}>{t("snew.time")}</Text>
      {slots === null ? (
        <ActivityIndicator color={colors.gold} />
      ) : slots.length === 0 ? (
        <Text style={ui.muted}>{t("snew.noSlots")}</Text>
      ) : (
        <View style={s.wrap}>
          {slots.map((sl) => (
            <Pressable key={sl.start} onPress={() => setStart(sl.start)} style={[s.chip, sl.start === start && s.chipOn]} accessibilityState={{ selected: sl.start === start }}>
              <Text style={[s.chipText, sl.start === start && { color: colors.onGold }]}>
                {formatTime(new Date(sl.start))}
                {sl.start === b.start ? ` · ${t("sedit.now")}` : ""}
                {sl.membersOnly ? " ★" : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {p.stats ? (
        <>
          <Text style={ui.label}>{t("sedit.price")}</Text>
          <View style={[ui.row, { gap: space.sm, flexWrap: "wrap" }]}>
            <TextInput
              value={price}
              onChangeText={(v) => {
                setPrice(v);
                setDiscount(null);
              }}
              keyboardType="numeric"
              style={[ui.input, { width: 110 }]}
              accessibilityLabel={t("sedit.price")}
            />
            {[10, 20, 50].map((pct) => (
              <Pressable key={pct} onPress={() => applyDiscount(pct)} style={[s.chip, discount === `${pct}%` && s.chipOn]}>
                <Text style={[s.chipText, discount === `${pct}%` && { color: colors.onGold }]}>−{pct}%</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[ui.muted, { fontSize: 12 }]}>{t("sedit.listPrice", { amount: t("common.lei", { n: listPrice }) })}</Text>
        </>
      ) : null}

      {moved ? (
        <View style={[ui.row, { justifyContent: "space-between" }]}>
          <Text style={[ui.text, { flex: 1 }]}>{t("sedit.notify")}</Text>
          <Switch value={notify} onValueChange={setNotify} trackColor={{ true: colors.gold, false: colors.border }} thumbColor={colors.text} />
        </View>
      ) : null}
      {needsTime ? <Text style={[ui.muted, { fontSize: 12 }]}>{t("sedit.pickTime")}</Text> : null}
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <Button title={t("sedit.save")} onPress={save} loading={busy} disabled={!changed || needsTime || (priceChanged && !(priceNum >= 0))} />
      <Button title={t("common.back")} variant="ghost" onPress={onCancel} />
    </View>
  );
}

const SOURCE: Record<string, Key> = { admin: "hlog.createdAdmin", app: "hlog.createdApp", web: "hlog.createdWeb" };
const MSG: Record<string, Key> = {
  confirm: "hmsg.confirm",
  reminder_24h: "hmsg.reminder24",
  reminder_2h: "hmsg.reminder2",
  cancel: "hmsg.cancel",
  booking_moved: "hmsg.moved",
  booking_request: "hmsg.request",
  booking_request_refused: "hmsg.refused",
  booking_request_expired: "hmsg.expired",
  review: "hmsg.review",
  pay_request: "hmsg.payRequest",
};
const CHANNEL: Record<string, Key> = { sms: "hmsg.sms", push: "hmsg.push", email: "hmsg.email" };
const METHOD: Record<string, Key> = { cash: "hpay.cash", card: "hpay.card", transfer: "hpay.transfer" };

/** Istoricul programării (Jurnal / Plăți / Notificări) și „Trimite linkul clientului”, ca în panou. */
export function BookingHistory({ booking: b }: { booking: StaffBooking }) {
  const { staffToken } = useStaff();
  const { t } = useT();
  const [data, setData] = useState<StaffActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"log" | "pay" | "msg">("log");
  useEffect(() => {
    if (!staffToken) return;
    staffApi.activity(staffToken, b.id).then(setData, (e) => setError(errorMessage(e)));
  }, [staffToken, b.id, b.start, b.price, b.status, b.serviceId, b.barberId]);

  const when = (iso: string) => `${formatDate(new Date(iso))} ${formatTime(new Date(iso))}`;
  const lei = (n: unknown) => t("common.lei", { n: Number(n ?? 0) });
  const logText = (e: StaffActivity["log"][number]) => {
    const d = e.detail ?? {};
    switch (e.kind) {
      case "created":
        return t(SOURCE[String(d.source)] ?? "hlog.createdAdmin");
      case "moved":
        return t(d.toBarber ? "hlog.movedBarber" : "hlog.moved", { from: when(String(d.from)), to: when(String(d.to)), fromBarber: String(d.fromBarber ?? ""), toBarber: String(d.toBarber ?? "") });
      case "service":
        return t("hlog.service", { from: String(d.from), to: String(d.to) });
      case "price":
        return d.discount ? t("hlog.priceDiscount", { from: lei(d.from), to: lei(d.to), discount: String(d.discount) }) : t("hlog.price", { from: lei(d.from), to: lei(d.to) });
      case "pay_requested":
        return t("hlog.payRequested", { amount: lei(d.amount) });
      case "completed":
        return t(d.payment === "subscription" ? "hlog.completedSub" : "hlog.completed");
      case "cancelled":
        return t(d.by === "client" ? "hlog.cancelledClient" : "hlog.cancelledSalon");
      case "accepted":
      case "refused":
      case "expired":
      case "no_show":
      case "reopened":
      case "uncompleted":
      case "review_sent":
        return t(`hlog.${e.kind === "no_show" ? "noShow" : e.kind === "review_sent" ? "reviewSent" : e.kind}` as Key);
      default:
        return e.kind;
    }
  };
  const payText = (x: StaffActivity["payments"][number]) => {
    switch (x.kind) {
      case "salon":
        return t("hpay.salon", { amount: lei(x.amount), method: t(METHOD[x.method ?? "cash"] ?? "hpay.cash") }) + (x.tip ? ` · ${t("hpay.tip", { amount: lei(x.tip) })}` : "");
      case "subscription":
        return t("hpay.sub");
      case "request":
        return t("hpay.request", { amount: lei(x.amount) }) + (x.status === "open" ? ` · ${t("hpay.unpaid")}` : "");
      case "online":
        return t("hpay.online", { amount: lei(x.amount) });
      case "refund":
        return t("hpay.refund", { amount: lei(x.amount) });
      default:
        return x.kind;
    }
  };
  const share = async () => {
    if (!data) return;
    try {
      if (Platform.OS === "web" && !(navigator as Navigator & { share?: unknown }).share) {
        await navigator.clipboard.writeText(data.link);
        window.alert(t("sedit.linkCopied"));
      } else await Share.share({ message: data.link });
    } catch {
      /* fereastra de trimitere închisă */
    }
  };

  const rows: Array<{ key: string; at: string; text: string; bad?: boolean }> = !data
    ? []
    : tab === "log"
      ? data.log.map((e, i) => ({ key: `l${i}`, at: e.at, text: logText(e) + (e.by ? ` · ${e.by}` : ""), bad: ["cancelled", "refused", "no_show"].includes(e.kind) }))
      : tab === "pay"
        ? data.payments.map((x, i) => ({ key: `p${i}`, at: x.at, text: payText(x), bad: x.kind === "refund" }))
        : data.messages.map((m, i) => ({
            key: `m${i}`,
            at: m.at,
            text: t("hmsg.line", { kind: t(MSG[m.kind] ?? "hmsg.other"), channel: t(CHANNEL[m.channel] ?? "hmsg.sms") }) + (m.status === "sent" ? "" : ` · ${t("hmsg.failed")}`),
            bad: m.status !== "sent",
          }));

  return (
    <View style={{ gap: space.sm }}>
      <View style={[ui.row, { gap: space.xs }]}>
        {(
          [
            ["log", "sedit.tabLog"],
            ["pay", "sedit.tabPay"],
            ["msg", "sedit.tabMsg"],
          ] as const
        ).map(([k, l]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[s.chip, tab === k && s.chipOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
            <Text style={[s.chipText, tab === k && { color: colors.onGold }]}>{t(l)}</Text>
          </Pressable>
        ))}
      </View>
      {error ? (
        <Text style={{ color: colors.danger }}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.gold} />
      ) : rows.length ? (
        rows.map((r) => (
          <View key={r.key} style={s.logRow}>
            <View style={[s.dot, { backgroundColor: r.bad ? colors.danger : colors.success }]} />
            <Text style={[ui.text, { flex: 1, fontSize: 13 }]}>
              <Text style={{ color: colors.muted }}>{r.at && r.at !== "null" ? `${when(r.at)}: ` : ""}</Text>
              {r.text}
            </Text>
          </View>
        ))
      ) : (
        <Text style={ui.muted}>{t(tab === "pay" ? "sedit.noPay" : "sedit.noMsg")}</Text>
      )}
      {data ? <Button title={t("sedit.share")} variant="ghost" onPress={share} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.text, fontWeight: "600", fontSize: 13 },
  day: { width: 56, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  dayOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  small: { color: colors.muted, fontSize: 11 },
  num: { color: colors.text, fontSize: 18, fontWeight: "800" },
  logRow: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
});
