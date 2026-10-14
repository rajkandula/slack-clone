import { useEffect, useRef, useState } from "react";

interface Reaction {
  emoji: string;
  userIds: string[];
  count: number;
}

interface SyncMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderUsername: string;
  seq: number;
  threadId: string | null;
  text?: string | null;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "file";
  mediaName?: string;
  mediaSize?: number;
  reactions?: Reaction[];
  replyTo?: { messageId: string; quote?: string | null } | null;
  forwardFrom?: { senderUsername?: string } | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  readBy: string[];
  createdAt: string;
}

interface PresenceUpdate {
  userId: string;
  username: string;
  status: "online" | "offline";
  lastSeen: string;
}

export interface CallSignal {
  id: string;
  senderId: string;
  recipientId: string;
  callId: string;
  type: "offer" | "answer" | "candidate" | "hangup" | "decline" | "join" | "screen_share";
  payload: unknown;
  createdAt: string;
}

interface TypingUpdate {
  chatId: string;
  users: { userId: string; username: string }[];
}

interface UseChatSyncProps {
  onMessageReceived: (message: SyncMessage) => void;
  onPresenceReceived: (presence: PresenceUpdate) => void;
  onCallSignalReceived?: (signal: CallSignal) => void;
  onMessageUpdate?: (message: SyncMessage) => void;
  onTyping?: (update: TypingUpdate) => void;
}

export function useChatSync({ onMessageReceived, onPresenceReceived, onCallSignalReceived, onMessageUpdate, onTyping }: UseChatSyncProps) {
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const eventSourceRef = useRef<EventSource | null>(null);

  // Always call the *latest* handlers without making them effect deps.
  // If the callbacks were deps, any unstable callback identity (an inline
  // arrow, or a useCallback whose deps change on every keystroke) would tear
  // down and re-open the SSE connection on every render.
  const handlersRef = useRef({ onMessageReceived, onPresenceReceived, onCallSignalReceived, onMessageUpdate, onTyping });
  useEffect(() => {
    handlersRef.current = { onMessageReceived, onPresenceReceived, onCallSignalReceived, onMessageUpdate, onTyping };
  });

  useEffect(() => {
    let reconnectTimeout: NodeJS.Timeout;
    let disposed = false;

    function connect() {
      if (disposed) return;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      setConnectionStatus("connecting");

      // Connect to the sequence-based sync endpoint
      const url = "/api/messages/sync";
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnectionStatus("connected");
      };

      es.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(event.data) as SyncMessage;
          handlersRef.current.onMessageReceived(msg);
        } catch (err) {
          console.error("Failed to parse SSE message:", err);
        }
      });

      es.addEventListener("presence", (event) => {
        try {
          const pres = JSON.parse(event.data) as PresenceUpdate;
          handlersRef.current.onPresenceReceived(pres);
        } catch (err) {
          console.error("Failed to parse SSE presence:", err);
        }
      });

      es.addEventListener("message_update", (event) => {
        try {
          const msg = JSON.parse(event.data) as SyncMessage;
          handlersRef.current.onMessageUpdate?.(msg);
        } catch (err) {
          console.error("Failed to parse SSE message_update:", err);
        }
      });

      es.addEventListener("typing", (event) => {
        try {
          const data = JSON.parse(event.data) as TypingUpdate;
          handlersRef.current.onTyping?.(data);
        } catch (err) {
          console.error("Failed to parse SSE typing:", err);
        }
      });

      es.addEventListener("call_signal", (event) => {
        try {
          const sig = JSON.parse(event.data) as CallSignal;
          handlersRef.current.onCallSignalReceived?.(sig);
        } catch (err) {
          console.error("Failed to parse SSE call signal:", err);
        }
      });

      es.addEventListener("ping", () => {
        // Heartbeat received
      });

      es.onerror = (err) => {
        console.error("SSE Connection Error:", err);
        setConnectionStatus("disconnected");
        es.close();

        // Auto-reconnect after 3 seconds
        reconnectTimeout = setTimeout(() => {
          connect();
        }, 3000);
      };
    }

    connect();

    return () => {
      disposed = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      clearTimeout(reconnectTimeout);
    };
  }, []);

  return { connectionStatus };
}
