import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useNavigation } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@/lib/auth-context";
import { getMessages, getRooms, sendChatMessage } from "@/lib/api";
import { agentById } from "@/lib/agents";
import { colors, radius, spacing } from "@/lib/theme";
import type { ApiRoom, ChatMessage } from "@/lib/types";

const HISTORY_TURNS = 20;

export default function ChatScreen() {
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { session, handleUnauthorized } = useAuth();

  const [room, setRoom] = useState<ApiRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const listRef = useRef<FlatList<ChatMessage>>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The room list doesn't hand this screen its ApiRoom (a deep link has
  // none to hand over), so this fetches the same /api/rooms list and picks
  // the one it needs — a few extra bytes for a screen that only loads once
  // per visit, in exchange for working the same way regardless of how the
  // screen was reached.
  useEffect(() => {
    if (!session || !roomId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [rooms, apiMessages] = await Promise.all([getRooms(session), getMessages(session, roomId)]);
        if (cancelled) return;
        const matched = rooms.find((r) => r.id === roomId) ?? null;
        setRoom(matched);
        setSelectedAgentId(matched?.agentIds[0] ?? null);
        setMessages(
          apiMessages.map((m) => ({
            id: m.id,
            role: m.role,
            agentId: m.agentId ?? undefined,
            content: m.content,
            createdAt: m.createdAt,
          })),
        );
        navigation.setOptions({ title: matched?.name ?? "Chat" });
      } catch (err) {
        if (cancelled) return;
        if (!handleUnauthorized(err)) setLoadError(err instanceof Error ? err.message : "Couldn't load this room");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, roomId]);

  // Cancel any in-flight stream when the screen goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || !session || !roomId || sending) return;
    const respondingAgentId = selectedAgentId ?? room?.agentIds[0];
    if (!respondingAgentId) return;

    setInput("");
    setSendError(null);

    const history = messages
      .filter((m) => m.role !== "system")
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant", content: m.content }));
    history.push({ role: "user", content });

    const userMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    const agentMessageId = `local-agent-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: agentMessageId, role: "agent", agentId: respondingAgentId, content: "", createdAt: new Date().toISOString(), isStreaming: true },
    ]);
    scrollToEnd();

    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let assembled = "";
    try {
      await sendChatMessage({
        session,
        roomId,
        agentId: respondingAgentId,
        history,
        userContent: content,
        signal: controller.signal,
        onToken: (text) => {
          assembled += text;
          setMessages((prev) => prev.map((m) => (m.id === agentMessageId ? { ...m, content: assembled } : m)));
          scrollToEnd();
        },
      });
      setMessages((prev) => prev.map((m) => (m.id === agentMessageId ? { ...m, isStreaming: false } : m)));
    } catch (err) {
      // Leaving the screen aborts the request on purpose (see the unmount
      // effect above) — that's not a failure worth surfacing, and the
      // component may already be gone by the time this rejects.
      if (controller.signal.aborted) return;
      if (!handleUnauthorized(err)) {
        setSendError(err instanceof Error ? err.message : "Message failed to send");
      }
      // Drop the placeholder if nothing ever streamed in, so a failed send
      // doesn't leave a permanent empty bubble.
      setMessages((prev) =>
        prev
          .map((m) => (m.id === agentMessageId ? { ...m, isStreaming: false } : m))
          .filter((m) => m.id !== agentMessageId || m.content.length > 0),
      );
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [input, session, roomId, sending, selectedAgentId, room, messages, handleUnauthorized, scrollToEnd]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (loadError || !room) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError ?? "Room not found"}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      {room.agentIds.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.agentRow} contentContainerStyle={styles.agentRowContent}>
          {room.agentIds.map((id) => {
            const agent = agentById(id);
            const active = selectedAgentId === id;
            return (
              <Pressable
                key={id}
                onPress={() => setSelectedAgentId(id)}
                style={[styles.agentChip, active && { borderColor: agent.color, backgroundColor: `${agent.color}22` }]}
              >
                <Text style={styles.agentChipEmoji}>{agent.avatar}</Text>
                <Text style={[styles.agentChipText, active && { color: agent.color }]}>{agent.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.messages}
        onContentSizeChange={scrollToEnd}
        renderItem={({ item }) => <MessageBubble message={item} />}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyText}>Say hello to get started.</Text>
          </View>
        }
      />

      {sendError ? <Text style={styles.sendError}>{sendError}</Text> : null}

      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Message…"
          placeholderTextColor={colors.textMuted}
          style={styles.composerInput}
          multiline
          editable={!sending}
        />
        <Pressable
          onPress={() => void handleSend()}
          disabled={!input.trim() || sending}
          style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
        >
          {sending ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.sendButtonText}>Send</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const agent = !isUser && message.agentId ? agentById(message.agentId) : null;

  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      {agent ? (
        <View style={[styles.bubbleAvatar, { backgroundColor: agent.color }]}>
          <Text style={styles.bubbleAvatarEmoji}>{agent.avatar}</Text>
        </View>
      ) : null}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAgent]}>
        {agent ? <Text style={styles.bubbleAuthor}>{agent.name}</Text> : null}
        <Text style={styles.bubbleText}>
          {message.content || (message.isStreaming ? "…" : "")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  errorText: { color: colors.danger, fontSize: 14, textAlign: "center" },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  agentRow: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
  agentRowContent: { padding: spacing.sm, gap: spacing.sm },
  agentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  agentChipEmoji: { fontSize: 13 },
  agentChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  messages: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, maxWidth: "88%" },
  bubbleRowUser: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  bubbleAvatar: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  bubbleAvatarEmoji: { fontSize: 12 },
  bubble: { borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
  bubbleUser: { backgroundColor: colors.accent, borderBottomRightRadius: radius.sm },
  bubbleAgent: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderBottomLeftRadius: radius.sm },
  bubbleAuthor: { color: colors.textMuted, fontSize: 11, fontWeight: "600" },
  bubbleText: { color: colors.textPrimary, fontSize: 15, lineHeight: 21 },
  sendError: { color: colors.danger, fontSize: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  composerInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: 15,
    maxHeight: 120,
  },
  sendButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 64,
  },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: "#ffffff", fontWeight: "600", fontSize: 14 },
});
