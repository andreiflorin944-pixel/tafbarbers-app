import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { staffApi, type StaffBooking } from "@/api/staff";
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
  if (!b || !staff || !staffToken) return null;
  const p = staff.permissions;
  const past = new Date(b.start).getTime() < Date.now();
  const st = BOOKING_STATUS[b.status];
  const minutes = Math.round(
    (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000,
  );

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
          <View style={[ui.row, { justifyContent: "space-between" }]}>
            <Text style={s.title} numberOfLines={1}>
              {b.clientName || b.clientPhone || "Client"}
            </Text>
            <Text style={[s.status, { color: st.color }]}>{st.label}</Text>
          </View>
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
            {p.bookings_manage && b.status === "confirmed" && past ? (
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Finalizată"
                    onPress={() => setStatus("completed")}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Nu a venit"
                    variant="ghost"
                    onPress={() => setStatus("no_show")}
                  />
                </View>
              </View>
            ) : null}
            {p.bookings_manage && b.status === "confirmed" ? (
              <Button
                title="Anulează (clientul primește SMS)"
                variant="danger"
                onPress={() =>
                  ask("Anulezi programarea?", () => setStatus("cancelled"))
                }
              />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
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
});
