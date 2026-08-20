import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@/lib/auth-context";
import { createRoom, getRooms } from "@/lib/api";
import { agentById } from "@/lib/agents";
import { colors, radius, spacing } from "@/lib/theme";
import type { ApiRoom } from "@/lib/types";

export default function RoomsScreen() {
  const { session, user, handleUnauthorized, logout } = useAuth();
  const router = useRouter();
  const [rooms, setRooms] = useState<ApiRoom[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Bumped every time the modal opens, and used as its `key` below — that
  // remounts NewRoomModal with fresh local state instead of needing an
  // effect to reset `name` back to "" each time.
  const [newRoomInstance, setNewRoomInstance] = useState(0);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!session) return;
      if (!opts.silent) setRefreshing(true);
      try {
        const data = await getRooms(session);
        setRooms(data);
        setError(null);
      } catch (err) {
        if (!handleUnauthorized(err)) setError(err instanceof Error ? err.message : "Couldn't load rooms");
      } finally {
        if (!opts.silent) setRefreshing(false);
      }
    },
    [session, handleUnauthorized],
  );

  // useFocusEffect already fires on initial mount as well as every later
  // focus (e.g. coming back from a chat that just auto-created a room), so
  // a separate mount-only effect would just be a redundant duplicate fetch.
  useFocusEffect(
    useCallback(() => {
      void load({ silent: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  return (
    <View style={styles.screen}>
      {rooms === null && !error ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void load()} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rooms ?? []}
          keyExtractor={(room) => room.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={colors.accent} />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No rooms yet.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <RoomRow room={item} onPress={() => router.push(`/rooms/${item.id}`)} />
          )}
        />
      )}

      <View style={styles.footer}>
        <Pressable
          onPress={() => {
            setNewRoomInstance((n) => n + 1);
            setCreating(true);
          }}
          style={styles.newRoomButton}
        >
          <Text style={styles.newRoomText}>New room</Text>
        </Pressable>
        <Pressable onPress={() => void logout()} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Sign out{user?.email ? ` (${user.email})` : ""}</Text>
        </Pressable>
      </View>

      <NewRoomModal
        key={newRoomInstance}
        visible={creating}
        busy={false}
        onCancel={() => setCreating(false)}
        onCreate={async (name) => {
          if (!session) return;
          try {
            const room = await createRoom(session, name, ["hermes-lisa"]);
            setCreating(false);
            setRooms((prev) => [...(prev ?? []), room]);
            router.push(`/rooms/${room.id}`);
          } catch (err) {
            if (!handleUnauthorized(err)) setError(err instanceof Error ? err.message : "Couldn't create room");
            setCreating(false);
          }
        }}
      />
    </View>
  );
}

function RoomRow({ room, onPress }: { room: ApiRoom; onPress: () => void }) {
  const agents = room.agentIds.slice(0, 4).map(agentById);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.avatarStack}>
        {agents.map((agent, index) => (
          <View
            key={agent.id}
            style={[
              styles.avatar,
              { backgroundColor: agent.color, marginLeft: index === 0 ? 0 : -10, zIndex: agents.length - index },
            ]}
          >
            <Text style={styles.avatarEmoji}>{agent.avatar}</Text>
          </View>
        ))}
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.roomName} numberOfLines={1}>
          {room.name}
        </Text>
        <Text style={styles.roomMeta} numberOfLines={1}>
          {room.agentIds.length} agent{room.agentIds.length === 1 ? "" : "s"} · {room._count.messages} message
          {room._count.messages === 1 ? "" : "s"}
        </Text>
      </View>
    </Pressable>
  );
}

function NewRoomModal({
  visible,
  onCancel,
  onCreate,
}: {
  visible: boolean;
  busy: boolean;
  onCancel: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    await onCreate(name.trim());
    setSubmitting(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>New room</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Room name"
            placeholderTextColor={colors.textMuted}
            style={styles.modalInput}
            autoFocus
            onSubmitEditing={submit}
          />
          <View style={styles.modalActions}>
            <Pressable onPress={onCancel} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={!name.trim() || submitting}
              style={[styles.modalCreate, (!name.trim() || submitting) && styles.buttonDisabled]}
            >
              {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.modalCreateText}>Create</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  listContent: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  errorText: { color: colors.danger, fontSize: 14, textAlign: "center" },
  retryButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.cardBorder },
  retryText: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  rowPressed: { opacity: 0.7 },
  avatarStack: { flexDirection: "row" },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.card,
  },
  avatarEmoji: { fontSize: 14 },
  rowBody: { flex: 1, gap: 2 },
  roomName: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  roomMeta: { color: colors.textMuted, fontSize: 12 },
  footer: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  newRoomButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  newRoomText: { color: "#ffffff", fontWeight: "600", fontSize: 14 },
  signOutButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  signOutText: { color: colors.textSecondary, fontWeight: "600", fontSize: 13 },
  buttonDisabled: { opacity: 0.4 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  modalCard: {
    width: "100%",
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  modalInput: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: 15,
  },
  modalActions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
  modalCancel: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  modalCancelText: { color: colors.textSecondary, fontSize: 14 },
  modalCreate: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    minWidth: 84,
    alignItems: "center",
  },
  modalCreateText: { color: "#ffffff", fontWeight: "600", fontSize: 14 },
});
