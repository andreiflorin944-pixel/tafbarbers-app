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
import { staffApi, type StaffBooking, type StaffCheckout } from "@/api/staff";
import { cutsText } from "@/components/SubscriptionRow";
import { Candle } from "@/components/Birthday";
import { Button, styles as ui } from "@/components/ui";
import { formatDate, formatTime } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { useStaff } from "@/state/Staff";
import { colors, radius, space } from "@/theme";

export const BOOKING_STATUS: Record<
  StaffBooking["status"],
  { label: string; color: string }
> = {
  confirmed: { label: "Confirmată", color: colors.gold },
  completed: { label: "Finalizată", color: "#4CAF7A" },
  no_show: { label: "Neprezentare", color: colors.danger },
  cancelled: { label: "Anulată", color: colors.muted },
};

const ask = (msg: string, yes: () => void) => {
  if (Platform.OS === "web") return window.confirm(msg) && yes();
  Alert.alert("Confirmare", msg, [
    { text: "Nu", style: "cancel" },
    { text: "Da", style: "destructive", onPress: yes },
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
          accessibilityLabel="Închide"
        />
        <View style={s.sheet}>
          <View style={s.handle} />
          <ScrollView keyboardShouldPersistTaps="handled">
          <View style={[ui.row, { justifyContent: "space-between" }]}>
            <Text style={s.title} numberOfLines={1}>
              {b.clientName || b.clientPhone || "Client"}
            </Text>
            <Text style={[s.status, { color: st.color }]}>{st.label}</Text>
          </View>
          {b.clientBirthday ? (
            <View style={s.birthday}>
              <Candle size={22} />
              <Text style={[ui.text, { flex: 1 }]}>
                E ziua lui de naștere! Urează-i „La mulți ani” și, dacă vrei,
                fă-i o reducere.
              </Text>
            </View>
          ) : null}
          <Line
            icon="time-outline"
            text={`${formatDate(new Date(b.start))}, ${formatTime(new Date(b.start))} – ${formatTime(new Date(b.end))} · ${minutes} min`}
          />
          <Line
            icon="cut-outline"
            text={`${b.serviceName} · ${b.barberName}`}
          />
          {p.stats ? (
            <Line icon="cash-outline" text={`${b.price} lei`} />
          ) : null}
          {b.payment ? (
            <Line
              icon="checkmark-circle-outline"
              text={
                b.payment === "subscription"
                  ? "Pe abonament"
                  : `A plătit ${b.paidAmount ?? b.price} lei`
              }
            />
          ) : null}
          {b.note ? (
            <Line icon="chatbubble-outline" text={`„${b.note}”`} />
          ) : null}
          <View style={{ gap: space.sm, marginTop: space.md }}>
            {b.clientPhone ? (
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Sună"
                    variant="ghost"
                    onPress={() => Linking.openURL(`tel:${b.clientPhone}`)}
                  />
                </View>
                {b.clientId ? (
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Fișa clientului"
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
                    title="Finalizată"
                    onPress={() => setCheckout(true)}
                  />
                </View>
                {b.status === "confirmed" ? (
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Nu a venit"
                      variant="ghost"
                      onPress={() => setStatus("no_show")}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
            {p.bookings_manage && b.status === "confirmed" && !checkout ? (
              <Button
                title="Anulează (clientul primește SMS)"
                variant="danger"
                onPress={() =>
                  ask("Anulezi programarea?", () => setStatus("cancelled"))
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
  const [data, setData] = useState<StaffCheckout | null>(null);
  const [mode, setMode] = useState<"paid" | "subscription">("paid");
  const [amount, setAmount] = useState(String(b.price));
  const [bonusId, setBonusId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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
    if (mode === "paid" && !(value >= 0)) return setErr("Scrie suma plătită.");
    setBusy(true);
    setErr("");
    try {
      onDone(
        await staffApi.complete(token, b.id, {
          payment: mode,
          ...(mode === "paid" && { amount: value }),
          bonusId,
        }),
      );
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };

  if (!data)
    return err ? (
      <Text style={{ color: colors.danger }}>{err}</Text>
    ) : (
      <Text style={ui.muted}>Se încarcă…</Text>
    );
  const sub = data.subscription;

  return (
    <View style={{ gap: space.sm }}>
      <Text style={[ui.label, { marginTop: 0 }]}>Cum a plătit?</Text>
      <Choice
        selected={mode === "paid"}
        onPress={() => setMode("paid")}
        title="A plătit"
      >
        {mode === "paid" ? (
          <View style={[ui.row, { marginTop: space.sm }]}>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              style={[ui.input, { flex: 1, marginTop: 0 }]}
              accessibilityLabel="Suma plătită"
              selectTextOnFocus
            />
            <Text style={ui.text}>lei</Text>
          </View>
        ) : null}
      </Choice>
      <Choice
        selected={mode === "subscription"}
        onPress={() => sub && setMode("subscription")}
        disabled={!sub}
        title="Pe abonament"
        sub={
          sub
            ? `${sub.name} · ${cutsText(sub)} · până pe ${formatDate(new Date(sub.endsAt))}`
            : "Clientul nu are un abonament activ pentru acest serviciu."
        }
      />
      {data.bonuses.length ? (
        <>
          <Text style={ui.label}>Folosește un bonus (opțional)</Text>
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
      {err ? <Text style={{ color: colors.danger }}>{err}</Text> : null}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button title="Înapoi" variant="ghost" onPress={onCancel} />
        </View>
        <View style={{ flex: 2 }}>
          <Button
            title={
              mode === "subscription"
                ? "Confirmă: pe abonament"
                : `Confirmă: ${amount || 0} lei`
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
