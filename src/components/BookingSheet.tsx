import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { staffApi, type PaySent, type StaffBooking, type StaffCheckout } from "@/api/staff";
import { cutsText } from "@/components/SubscriptionRow";
import { Candle } from "@/components/Birthday";
import { Button, styles as ui } from "@/components/ui";
import { tr, useT, type Key } from "@/i18n";
import { formatDate, formatTime } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { useStaff } from "@/state/Staff";
import { colors, radius, space } from "@/theme";

export const BOOKING_STATUS: Record<
  StaffBooking["status"],
  { label: Key; color: string }
> = {
  requested: { label: "bst.requested", color: "#7FB6E6" },
  confirmed: { label: "bst.confirmed", color: colors.gold },
  completed: { label: "status.completed", color: "#4CAF7A" },
  no_show: { label: "status.noShow", color: colors.danger },
  cancelled: { label: "status.cancelled", color: colors.muted },
};

const ask = (msg: string, yes: () => void) => {
  if (Platform.OS === "web") return window.confirm(msg) && yes();
  Alert.alert(tr("common.confirmTitle"), msg, [
    { text: tr("common.no"), style: "cancel" },
    { text: tr("common.yes"), style: "destructive", onPress: yes },
  ]);
};

/** Detaliile unei programări, cu acțiunile permise contului: sună, finalizată, neprezentare, anulează. */
export function BookingSheet({
  booking: b,
  onClose,
  onChange,
}: {
  booking: StaffBooking | null;
  onClose: () => void;
  onChange: (b: StaffBooking) => void;
}) {
  const { staff, staffToken } = useStaff();
  const { t } = useT();
  const [checkout, setCheckout] = useState(false);
  useEffect(() => setCheckout(false), [b?.id]);
  if (!b || !staff || !staffToken) return null;
  const p = staff.permissions;
  const past = new Date(b.start).getTime() < Date.now();
  const st = BOOKING_STATUS[b.status];
  const minutes = Math.round(
    (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000,
  );

  const canComplete =
    p.bookings_manage &&
    past &&
    (b.status === "confirmed" || (b.status === "completed" && !b.payment));

  const setStatus = async (status: string) => {
    try {
      onChange({
        ...b,
        ...(await staffApi.setStatus(staffToken, b.id, status)),
      });
      onClose();
    } catch (e) {
      const m = errorMessage(e);
      Platform.OS === "web" ? window.alert(m) : Alert.alert("TAF", m);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          style={[StyleSheet.absoluteFill, s.backdrop]}
          onPress={onClose}
          accessibilityLabel={t("common.close")}
        />
        <View style={s.sheet}>
          <View style={s.handle} />
          <ScrollView keyboardShouldPersistTaps="handled">
          <View style={[ui.row, { justifyContent: "space-between" }]}>
            <Text style={s.title} numberOfLines={1}>
              {b.clientName || b.clientPhone || t("common.client")}
            </Text>
            <Text style={[s.status, { color: st.color }]}>{t(st.label)}</Text>
          </View>
          {b.clientBirthday ? (
            <View style={s.birthday}>
              <Candle size={22} />
              <Text style={[ui.text, { flex: 1 }]}>{t("sheet.birthday")}</Text>
            </View>
          ) : null}
          <Line
            icon="time-outline"
            text={`${formatDate(new Date(b.start))}, ${formatTime(new Date(b.start))} – ${formatTime(new Date(b.end))} · ${t("common.min", { n: minutes })}`}
          />
          <Line
            icon="cut-outline"
            text={`${b.serviceName} · ${b.barberName}`}
          />
          {p.stats ? (
            <Line icon="cash-outline" text={t("common.lei", { n: b.price })} />
          ) : null}
          {b.payment ? (
            <Line
              icon="checkmark-circle-outline"
              text={
                b.payment === "subscription"
                  ? t("sheet.onSub")
                  : t("sheet.paid", { amount: t("common.lei", { n: b.paidAmount ?? b.price }) })
              }
            />
          ) : null}
          {b.onlinePaid ? (
            <Line
              icon="card-outline"
              text={b.onlineRefunded ? t("sheet.onlineRefunded", { amount: b.onlinePaid }) : t("sheet.onlinePaidLine", { amount: b.onlinePaid })}
            />
          ) : null}
          {b.note ? (
            <Line icon="chatbubble-outline" text={`„${b.note}”`} />
          ) : null}
          <View style={{ gap: space.sm, marginTop: space.md }}>
            {b.clientPhone || b.clientId ? (
              <View style={{ flexDirection: "row", gap: space.sm }}>
                {b.clientPhone ? (
                  <View style={{ flex: 1 }}>
                    <Button
                      title={t("common.call")}
                      variant="ghost"
                      onPress={() => Linking.openURL(`tel:${b.clientPhone}`)}
                    />
                  </View>
                ) : null}
                {b.clientId ? (
                  <View style={{ flex: 1 }}>
                    <Button
                      title={t("sheet.clientFile")}
                      variant="ghost"
                      onPress={() => {
                        onClose();
                        router.push({
                          pathname: "/staff/client/[id]",
                          params: { id: b.clientId },
                        });
                      }}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
            {p.bookings_manage && b.status === "requested" ? (
              <RequestButtons
                booking={b}
                token={staffToken}
                onDone={(nb) => {
                  onChange({ ...b, ...nb });
                  onClose();
                }}
              />
            ) : null}
            {p.bookings_manage && !checkout && (b.status === "confirmed" || b.payDue) && !b.onlinePaid ? (
              <PayRequest
                booking={b}
                token={staffToken}
                on={!!staff.onlinePayments}
                onDone={(nb) => onChange({ ...b, ...nb })}
              />
            ) : null}
            {canComplete && checkout ? (
              <Checkout
                booking={b}
                token={staffToken}
                onCancel={() => setCheckout(false)}
                onDone={(nb) => {
                  onChange({ ...b, ...nb });
                  onClose();
                }}
              />
            ) : canComplete ? (
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title={t("sheet.complete")}
                    onPress={() => setCheckout(true)}
                  />
                </View>
                {b.status === "confirmed" ? (
                  <View style={{ flex: 1 }}>
                    <Button
                      title={t("sheet.noShow")}
                      variant="ghost"
                      onPress={() => setStatus("no_show")}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
            {p.bookings_manage && b.status === "confirmed" && !checkout ? (
              <Button
                title={t("sheet.cancelSms")}
                variant="danger"
                onPress={() =>
                  ask(t("sheet.cancelAsk"), () => setStatus("cancelled"))
                }
              />
            ) : null}
          </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Confirmarea tunsorii: frizerul alege „a plătit X lei” (suma se poate schimba) sau „pe abonament”
 * (doar când clientul are un abonament activ care acoperă serviciul) și, opțional, un bonus folosit.
 */
function Checkout({
  booking: b,
  token,
  onCancel,
  onDone,
}: {
  booking: StaffBooking;
  token: string;
  onCancel: () => void;
  onDone: (b: StaffBooking) => void;
}) {
  const { t } = useT();
  const [data, setData] = useState<StaffCheckout | null>(null);
  const [mode, setMode] = useState<"paid" | "subscription">("paid");
  const [amount, setAmount] = useState(String(b.price));
  const [bonusId, setBonusId] = useState<string | null>(null);
  const [tip, setTip] = useState("");
  const { staff } = useStaff();
  const appOn = !!staff?.onlinePayments && !b.onlinePaid;
  const [payMethod, setPayMethod] = useState<"cash" | "card" | "online" | "app">(b.onlinePaid ? "online" : "cash");
  const [giftCode, setGiftCode] = useState("");
  const [gift, setGift] = useState<{ code: string; take: number; balance: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const applyGift = async () => {
    setErr("");
    try {
      const g = await staffApi.checkGiftCard(token, giftCode);
      if (g.status !== "active") return setErr(g.status === "expired" ? t("sheet.giftExpired") : t("sheet.giftEmpty"));
      const take = Math.min(g.balance, b.price);
      setGift({ code: g.code, take, balance: g.balance });
      setAmount(String(Math.max(0, b.price - take)));
    } catch (e) {
      setGift(null);
      setErr(errorMessage(e));
    }
  };

  useEffect(() => {
    staffApi.checkout(token, b.id).then(
      (d) => {
        setData(d);
        if (d.subscription) setMode("subscription");
      },
      (e) => setErr(errorMessage(e)),
    );
  }, [token, b.id]);

  const confirm = async () => {
    const value = Number(amount.replace(",", "."));
    if (mode === "paid" && !(value >= 0)) return setErr(t("sheet.enterAmount"));
    const tipValue = tip.trim() ? Number(tip.replace(",", ".")) : 0;
    if (!(tipValue >= 0)) return setErr(t("sheet.tipInvalid"));
    setBusy(true);
    setErr("");
    try {
      const nb = await staffApi.complete(token, b.id, {
        payment: mode,
        ...(mode === "paid" && { amount: value, payMethod }),
        ...(mode === "paid" && gift && { giftCode: gift.code, giftAmount: gift.take }),
        tip: tipValue || null,
        bonusId,
      });
      // Plata cerută în aplicație: spunem dacă mesajul a plecat (altfel clientul o vede doar când deschide aplicația).
      if (nb.sent) {
        const m = nb.sent.sms || nb.sent.push || nb.sent.email ? t("sheet.payRequestSent", { amount: value }) : t("sheet.payRequestInApp");
        Platform.OS === "web" ? window.alert(m) : Alert.alert("TAF", m);
      }
      onDone(nb);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };

  if (!data)
    return err ? (
      <Text style={{ color: colors.danger }}>{err}</Text>
    ) : (
      <Text style={ui.muted}>{t("common.loading")}</Text>
    );
  const sub = data.subscription;

  return (
    <View style={{ gap: space.sm }}>
      <Text style={[ui.label, { marginTop: 0 }]}>{t("sheet.howPaid")}</Text>
      <Choice
        selected={mode === "paid"}
        onPress={() => setMode("paid")}
        title={t("sheet.paidTitle")}
      >
        {mode === "paid" ? (
          <View style={[ui.row, { marginTop: space.sm }]}>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              style={[ui.input, { flex: 1, marginTop: 0 }]}
              accessibilityLabel={t("sheet.amountPaid")}
              selectTextOnFocus
            />
            <Text style={ui.text}>{t("sheet.currency")}</Text>
          </View>
        ) : null}
        {mode === "paid" ? (
          <View style={[ui.row, { gap: space.sm, marginTop: space.sm }]}>
            {(b.onlinePaid ? (["online", "cash", "card"] as const) : appOn ? (["cash", "card", "app"] as const) : (["cash", "card"] as const)).map((m) => (
              <Pressable
                key={m}
                onPress={() => setPayMethod(m)}
                accessibilityRole="radio"
                accessibilityState={{ selected: payMethod === m }}
                style={{
                  flex: 1,
                  alignItems: "center",
                  paddingVertical: 10,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: payMethod === m ? colors.gold : colors.border,
                  backgroundColor: payMethod === m ? colors.gold : "transparent",
                }}
              >
                <Text style={{ color: payMethod === m ? colors.onGold : colors.text, fontWeight: "700" }}>
                  {t(m === "cash" ? "sheet.cash" : m === "card" ? "sheet.card" : m === "app" ? "sheet.app" : "sheet.online")}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {mode === "paid" && payMethod === "app" ? (
          <Text style={[ui.muted, { fontSize: 13, marginTop: space.xs }]}>{t("sheet.appHint")}</Text>
        ) : mode === "paid" && !staff?.onlinePayments && !b.onlinePaid ? (
          <Text style={[ui.muted, { fontSize: 12, marginTop: space.xs }]}>{t("sheet.appOff")}</Text>
        ) : null}
        {mode === "paid" ? (
          <View style={{ marginTop: space.sm, gap: 4 }}>
            <View style={ui.row}>
              <TextInput
                value={giftCode}
                onChangeText={(v) => {
                  setGiftCode(v);
                  setGift(null);
                }}
                placeholder={t("sheet.giftPh")}
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
                style={[ui.input, { flex: 1, marginTop: 0 }]}
                accessibilityLabel={t("sheet.giftLabel")}
              />
              {giftCode.trim() && !gift ? (
                <View style={{ width: 110 }}>
                  <Button title={t("sheet.use")} variant="ghost" onPress={applyGift} />
                </View>
              ) : null}
            </View>
            {gift ? (
              <Text style={{ color: colors.success, fontSize: 13 }}>
                {t("sheet.giftTake", { take: gift.take, balance: gift.balance, rest: amount || 0 })}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Choice>
      <Choice
        selected={mode === "subscription"}
        onPress={() => sub && setMode("subscription")}
        disabled={!sub}
        title={t("sheet.onSub")}
        sub={
          sub
            ? t("sheet.subLine", { name: sub.name, cuts: cutsText(sub), date: formatDate(new Date(sub.endsAt)) })
            : t("sheet.noSub")
        }
      />
      {data.bonuses.length ? (
        <>
          <Text style={ui.label}>{t("sheet.useBonus")}</Text>
          {data.bonuses.map((x) => (
            <Choice
              key={x.id}
              selected={bonusId === x.id}
              onPress={() => setBonusId(bonusId === x.id ? null : x.id)}
              title={x.title}
              square
            />
          ))}
        </>
      ) : null}
      <Text style={ui.label}>{t("sheet.tipOpt")}</Text>
      <View style={ui.row}>
        <TextInput
          value={tip}
          onChangeText={setTip}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.muted}
          style={[ui.input, { flex: 1, marginTop: 0 }]}
          accessibilityLabel={t("sheet.tip")}
        />
        <Text style={ui.text}>{t("sheet.currency")}</Text>
      </View>
      {err ? <Text style={{ color: colors.danger }}>{err}</Text> : null}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button title={t("common.back")} variant="ghost" onPress={onCancel} />
        </View>
        <View style={{ flex: 2 }}>
          <Button
            title={
              mode === "subscription"
                ? t("sheet.confirmSub")
                : payMethod === "app"
                  ? t("sheet.confirmApp", { n: amount || 0 })
                  : `${t("sheet.confirmPaid", { n: amount || 0 })}${gift ? t("sheet.plusCard", { n: gift.take }) : ""}`
            }
            onPress={confirm}
            loading={busy}
          />
        </View>
      </View>
    </View>
  );
}

function Choice({
  selected,
  onPress,
  title,
  sub,
  disabled,
  square,
  children,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  sub?: string;
  disabled?: boolean;
  square?: boolean;
  children?: React.ReactNode;
}) {
  const icon = square
    ? selected
      ? "checkbox"
      : "square-outline"
    : selected
      ? "radio-button-on"
      : "radio-button-off";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={square ? "checkbox" : "radio"}
      accessibilityState={{ checked: selected, disabled }}
      style={[s.choice, selected && s.choiceOn, disabled && { opacity: 0.5 }]}
    >
      <View style={[ui.row, { alignItems: "flex-start" }]}>
        <Ionicons
          name={icon}
          size={22}
          color={selected ? colors.gold : colors.muted}
        />
        <View style={{ flex: 1 }}>
          <Text style={ui.cardTitle}>{title}</Text>
          {sub ? (
            <Text style={[ui.muted, { fontSize: 13 }]}>{sub}</Text>
          ) : null}
        </View>
      </View>
      {children}
    </Pressable>
  );
}

/** Acceptă sau refuză o cerere de programare; la refuz se poate scrie motivul, pe care îl primește clientul. */
function RequestButtons({
  booking: b,
  token,
  onDone,
}: {
  booking: StaffBooking;
  token: string;
  onDone: (b: StaffBooking) => void;
}) {
  const { t } = useT();
  const { staff } = useStaff();
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const act = async (fn: () => Promise<StaffBooking>) => {
    setBusy(true);
    setErr("");
    try {
      onDone(await fn());
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      <Text style={ui.muted}>{t("sheet.requestInfo")}</Text>
      {refusing ? (
        <>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={t("sheet.reasonPh")}
            placeholderTextColor={colors.muted}
            maxLength={200}
            style={ui.input}
            accessibilityLabel={t("sheet.reasonLabel")}
          />
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                title={t("sheet.sendRefusal")}
                variant="danger"
                loading={busy}
                onPress={() => act(() => staffApi.refuseRequest(token, b.id, reason))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t("common.back")} variant="ghost" onPress={() => setRefusing(false)} />
            </View>
          </View>
        </>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                title={t("sheet.accept")}
                loading={busy}
                onPress={() => act(() => staffApi.acceptRequest(token, b.id))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t("sheet.refuse")} variant="danger" onPress={() => setRefusing(true)} />
            </View>
          </View>
          {/* Acceptă și îi cere clientului plata în aplicație (doar cu plata online pornită). */}
          {staff?.onlinePayments ? (
            <Button
              title={t("sheet.acceptPay")}
              variant="ghost"
              loading={busy}
              onPress={() => act(() => staffApi.acceptRequest(token, b.id, true))}
            />
          ) : null}
        </>
      )}
      {err ? <Text style={{ color: colors.danger }}>{err}</Text> : null}
    </View>
  );
}

/**
 * Cererea de plată în aplicație: clientul primește mesajul (push, SMS, e-mail, după setări) și plătește din aplicație.
 * Trimisă deja: se poate retrimite sau retrage (ex. a plătit totuși la salon). Fără plata online pornită, spunem de ce lipsește.
 */
function PayRequest({
  booking: b,
  token,
  on,
  onDone,
}: {
  booking: StaffBooking;
  token: string;
  on: boolean;
  onDone: (b: StaffBooking) => void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const act = async (fn: () => Promise<StaffBooking & { sent?: PaySent }>) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const nb = await fn();
      onDone(nb);
      if (nb.sent) setMsg(nb.sent.sms || nb.sent.push || nb.sent.email ? t("sheet.payRequestSent", { amount: nb.payDue ?? nb.payRequest ?? 0 }) : t("sheet.payRequestInApp"));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!on) return b.payDue ? null : <Text style={[ui.muted, { fontSize: 12 }]}>{t("sheet.appOff")}</Text>;
  const pendingApp = b.status === "completed" && b.payMethod === "app";
  return (
    <View style={{ gap: space.sm }}>
      {b.payDue ? (
        <>
          <Text style={{ color: colors.gold, fontWeight: "700" }}>{t("sheet.payRequested", { amount: b.payDue })}</Text>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button title={t("sheet.payRequestResend")} variant="ghost" loading={busy} onPress={() => act(() => staffApi.payRequest(token, b.id))} />
            </View>
            {pendingApp ? null : (
              <View style={{ flex: 1 }}>
                <Button title={t("sheet.payRequestCancel")} variant="ghost" loading={busy} onPress={() => act(() => staffApi.cancelPayRequest(token, b.id, "cash"))} />
              </View>
            )}
          </View>
          {pendingApp ? (
            // Încheiată cu plata în aplicație, dar clientul a plătit totuși la salon.
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button title={t("sheet.paidCashInstead")} variant="ghost" loading={busy} onPress={() => act(() => staffApi.cancelPayRequest(token, b.id, "cash"))} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title={t("sheet.paidCardInstead")} variant="ghost" loading={busy} onPress={() => act(() => staffApi.cancelPayRequest(token, b.id, "card"))} />
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <Button title={t("sheet.payRequest")} variant="ghost" loading={busy} onPress={() => act(() => staffApi.payRequest(token, b.id))} />
      )}
      {msg ? <Text style={{ color: colors.success, fontSize: 13 }}>{msg}</Text> : null}
      {err ? <Text style={{ color: colors.danger }}>{err}</Text> : null}
    </View>
  );
}

function Line({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
}) {
  return (
    <View style={[ui.row, { marginTop: space.sm, alignItems: "flex-start" }]}>
      <Ionicons
        name={icon}
        size={18}
        color={colors.gold}
        style={{ marginTop: 1 }}
      />
      <Text style={[ui.text, { flex: 1 }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    paddingBottom: space.xl,
    borderWidth: 1,
    borderColor: colors.border,
    width: "100%",
    maxWidth: 720,
    maxHeight: "92%",
    alignSelf: "center",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: space.md,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: "800", flex: 1 },
  status: { fontWeight: "700", fontSize: 13 },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
  },
  choiceOn: { borderColor: colors.gold },
  birthday: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold,
  },
});
