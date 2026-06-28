import { create } from "zustand";
import type { ChatRoom, Message } from "@/types";
import { DEFAULT_ROOM_ID } from "@/lib/constants";

interface ChatState {
  rooms: ChatRoom[];
  activeRoomId: string | null;
  isLoading: boolean;
  hydrated: boolean;
}

interface ChatActions {
  setRooms: (rooms: ChatRoom[]) => void;
  setRoomMessages: (roomId: string, messages: Message[]) => void;
  createRoom: (name: string, agents: string[], projectId?: string) => ChatRoom;
  setActiveRoom: (roomId: string) => void;
  addMessage: (roomId: string, message: Message) => void;
  updateMessage: (
    roomId: string,
    messageId: string,
    updates: Partial<Message>
  ) => void;
  setHydrated: (value: boolean) => void;
}

type ChatStore = ChatState & ChatActions;

const defaultRoom: ChatRoom = {
  id: DEFAULT_ROOM_ID,
  name: "Mission Control",
  agents: ["hermes-lisa", "claude-code"],
  messages: [
    {
      id: "welcome-msg-1",
      chatId: DEFAULT_ROOM_ID,
      role: "system",
      content:
        "Welcome to Mission Control. All agents are online and ready. How can we assist you today?",
      timestamp: new Date(),
    },
  ],
  createdAt: new Date(),
};

export const useChatStore = create<ChatStore>((set, get) => ({
  // State
  rooms: [defaultRoom],
  activeRoomId: DEFAULT_ROOM_ID,
  isLoading: false,
  hydrated: false,

  // Actions
  setRooms: (rooms) => {
    const current = get();
    // Preserve in-memory messages for rooms we already have loaded
    const merged = rooms.map((r) => {
      const existing = current.rooms.find((e) => e.id === r.id);
      return existing ? { ...r, messages: existing.messages } : r;
    });
    set({
      rooms: merged,
      activeRoomId: merged.length > 0 ? merged[0].id : null,
    });
  },

  setRoomMessages: (roomId, messages) =>
    set((state) => ({
      rooms: state.rooms.map((room) =>
        room.id === roomId ? { ...room, messages } : room
      ),
    })),

  createRoom: (name, agents, projectId) => {
    const newRoom: ChatRoom = {
      id: `room-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      agents,
      messages: [],
      createdAt: new Date(),
      ...(projectId ? { projectId } : {}),
    };
    set((state) => ({
      rooms: [...state.rooms, newRoom],
      activeRoomId: newRoom.id,
    }));
    return newRoom;
  },

  setActiveRoom: (roomId) => set({ activeRoomId: roomId }),

  addMessage: (roomId, message) =>
    set((state) => ({
      rooms: state.rooms.map((room) =>
        room.id === roomId
          ? { ...room, messages: [...room.messages, message] }
          : room
      ),
    })),

  updateMessage: (roomId, messageId, updates) =>
    set((state) => ({
      rooms: state.rooms.map((room) =>
        room.id === roomId
          ? {
              ...room,
              messages: room.messages.map((msg) =>
                msg.id === messageId ? { ...msg, ...updates } : msg
              ),
            }
          : room
      ),
    })),

  setHydrated: (value) => set({ hydrated: value }),
}));

// Selector helpers
export const selectActiveRoom = (state: ChatStore): ChatRoom | undefined => {
  const { rooms, activeRoomId } = state;
  return rooms.find((r) => r.id === activeRoomId);
};

export const selectRoomMessages = (
  state: ChatStore,
  roomId: string
): Message[] => {
  const room = state.rooms.find((r) => r.id === roomId);
  return room?.messages ?? [];
};
