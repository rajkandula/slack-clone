import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { ChatDoc, MessageDoc, UserDoc, MemberDoc } from "@/lib/db-types";
import { ObjectId } from "mongodb";
import { formatMessage } from "../route";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return new Response("Unauthorized", { status: 401 });
    }

    const currentUserId = user._id.toString();
    
// Parse the client's last sync sequence from URL query (if any)
    const { searchParams } = new URL(request.url);
    const sinceSeqParam = searchParams.get("sinceSeq");
    let initialSeq = sinceSeqParam ? parseInt(sinceSeqParam, 10) : null;
    if (initialSeq === null || isNaN(initialSeq)) {
      initialSeq = null;
    }

    const db = await getDb();
    let isClosed = false;

    // Track latest seq streamed per chat
    const chatSeqMap: Record<string, number> = {};

    // Track the last time we swept for message mutations (edits/deletes/reactions).
    let lastMutationCheck = new Date();

    // Helper to format SSE events
    const encoder = new TextEncoder();
    // Returns whether the event actually made it into the stream. Callers that
    // retire server-side state on delivery (call signalling) must check it —
    // acknowledging an enqueue that threw destroys the signal for good.
    const sendSSE = (controller: ReadableStreamDefaultController, eventName: string, data: unknown): boolean => {
      try {
        const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
        return true;
      } catch {
        // The client is gone (controller closed). Flag the stream so the
        // poll loop stops — otherwise disconnected clients leave zombie
        // loops behind that slowly exhaust the Mongo connection pool.
        isClosed = true;
        return false;
      }
    };

    // Poll cadence. The loop self-schedules AFTER each pass completes, so a
    // slow database round-trip can never cause overlapping passes (setInterval
    // with an async callback does overlap, which floods the connection pool).
    const TICK_MS = 1500;
    let tickTimer: NodeJS.Timeout | undefined;

    // Stop promptly when the client aborts the request.
    request.signal.addEventListener("abort", () => {
      isClosed = true;
      if (tickTimer) clearTimeout(tickTimer);
    });
    const stream = new ReadableStream({
      async start(controller) {
        // Set user status to online upon connection
        await db.collection<UserDoc>("users").updateOne(
          { _id: new ObjectId(currentUserId) },
          { $set: { status: "online", lastSeen: new Date() } }
        );

        // Fetch user's active chats and initialize sequence tracking map
        const initialChats = await db
          .collection<ChatDoc>("chats")
          .find({ participants: currentUserId })
          .toArray();

        for (const chat of initialChats) {
          const chatIdStr = chat._id!.toString();
          
          if (initialSeq !== null) {
            chatSeqMap[chatIdStr] = initialSeq;
          } else {
            // Find current member read sequence in this chat
            const memberState = await db.collection<MemberDoc>("members").findOne({
              chatId: chatIdStr,
              userId: currentUserId,
            });
            chatSeqMap[chatIdStr] = memberState?.lastReadSeq ?? chat.maxSeq ?? 0;
          }
        }

        // Establish connection heartbeat
        sendSSE(controller, "ping", { connected: true, initialSeqs: chatSeqMap });

        const tick = async () => {
          if (isClosed) return;

          try {
            // Keep status updated
            await db.collection<UserDoc>("users").updateOne(
              { _id: new ObjectId(currentUserId) },
              { $set: { status: "online", lastSeen: new Date() } }
            );

            // Fetch active chats (incase new chat started since connecting)
            const chats = await db
              .collection<ChatDoc>("chats")
              .find({ participants: currentUserId })
              .toArray();

            for (const chat of chats) {
              const chatIdStr = chat._id!.toString();
              
              // If new chat, initialize its tracking seq to maxSeq
              if (!(chatIdStr in chatSeqMap)) {
                chatSeqMap[chatIdStr] = chat.maxSeq ?? 0;
                // Notify client of new chat discovery
                sendSSE(controller, "chat_discovered", { chatId: chatIdStr });
                continue;
              }

              const lastReadSeq = chatSeqMap[chatIdStr];

              // Find any messages with seq > lastReadSeq in this chat
              if (chat.maxSeq > lastReadSeq) {
                const newMessages = await db
                  .collection<MessageDoc>("messages")
                  .find({
                    chatId: chatIdStr,
                    seq: { $gt: lastReadSeq },
                  })
                  .sort({ seq: 1 })
                  .toArray();

                if (newMessages.length > 0) {
                  newMessages.forEach((msg) => {
                    sendSSE(controller, "message", {
                      id: msg._id!.toString(),
                      chatId: msg.chatId,
                      senderId: msg.senderId,
                      senderUsername: msg.senderUsername,
                      seq: Number(msg.seq),
                      threadId: msg.threadId,
                      text: msg.text,
                      mediaUrl: msg.mediaUrl,
                      mediaType: msg.mediaType,
                      mediaName: msg.mediaName,
                      mediaSize: msg.mediaSize,
                      readBy: msg.readBy || [msg.senderId],
                      createdAt: msg.createdAt,
                    });
                  });

                  // Move the tracking pointer forward
                  chatSeqMap[chatIdStr] = Number(newMessages[newMessages.length - 1].seq);
                }
              }
            }

            // Stream message mutations (edits, deletes, reaction changes).
            // Only messages whose updatedAt advanced past createdAt are mutations;
            // brand-new messages are already delivered via the "message" event above.
            const allChatIds = chats.map((c) => c._id!.toString());
            if (allChatIds.length > 0) {
              const sweepStart = new Date();
              const mutated = await db
                .collection<MessageDoc>("messages")
                .find({
                  chatId: { $in: allChatIds },
                  updatedAt: { $gt: lastMutationCheck },
                  $expr: { $gt: ["$updatedAt", "$createdAt"] },
                })
                .toArray();

              mutated.forEach((msg) => {
                sendSSE(controller, "message_update", formatMessage(msg));
              });
              lastMutationCheck = sweepStart;

              // Broadcast who is currently typing in each of the user's chats.
              const typingDocs = await db
                .collection("typing")
                .find({
                  chatId: { $in: allChatIds },
                  userId: { $ne: currentUserId },
                  expiresAt: { $gt: new Date() },
                })
                .toArray();

              const typingByChat: Record<string, { userId: string; username: string }[]> = {};
              for (const t of typingDocs) {
                (typingByChat[t.chatId] ||= []).push({ userId: t.userId, username: t.username });
              }
              // Emit one event per chat (including empties so clients can clear stale indicators).
              for (const chatId of allChatIds) {
                sendSSE(controller, "typing", { chatId, users: typingByChat[chatId] || [] });
              }
            }

            // Sync other users' presence
            const directParticipants = Array.from(
              new Set(
                chats
                  .filter((c) => c.type === "dm")
                  .flatMap((c) => c.participants)
                  .filter((id) => id !== currentUserId)
              )
            );

            if (directParticipants.length > 0) {
              const objectIds = directParticipants.map((id) => new ObjectId(id));
              const users = await db
                .collection<UserDoc>("users")
                .find({ _id: { $in: objectIds } })
                .toArray();

              users.forEach((u) => {
                sendSSE(controller, "presence", {
                  userId: u._id!.toString(),
                  username: u.username,
                  status: u.status,
                  lastSeen: u.lastSeen,
                });
              });
            }

            // WebRTC call signalling. Anything older than a minute belongs to a
            // call that is long over — replaying it pops a phantom "incoming
            // call" and, worse, a stale offer tears down a live peer connection.
            const pendingSignals = await db
              .collection("signaling_updates")
              .find({
                recipientId: currentUserId,
                createdAt: { $gt: new Date(Date.now() - 60_000) },
              })
              .sort({ createdAt: 1 })
              .toArray();

            if (pendingSignals.length > 0) {
              // The ringing banner names the caller, so resolve it here from the
              // users collection rather than trusting the name the sender posted.
              const callerNames = new Map<string, string>();
              const joinSenders = [
                ...new Set(
                  pendingSignals
                    .filter((s) => s.type === "join" && ObjectId.isValid(s.senderId))
                    .map((s) => s.senderId as string)
                ),
              ];
              if (joinSenders.length > 0) {
                const senders = await db
                  .collection<UserDoc>("users")
                  .find({ _id: { $in: joinSenders.map((id) => new ObjectId(id)) } })
                  .project<{ _id: ObjectId; username: string; displayName?: string | null }>({ username: 1, displayName: 1 })
                  .toArray();
                senders.forEach((u) => callerNames.set(u._id.toString(), u.displayName || u.username));
              }

              const delivered: ObjectId[] = [];
              for (const sig of pendingSignals) {
                const ok = sendSSE(controller, "call_signal", {
                  id: sig._id.toString(),
                  senderId: sig.senderId,
                  recipientId: sig.recipientId,
                  callId: sig.callId,
                  type: sig.type, // offer | answer | candidate | hangup | decline | join | screen_share
                  payload:
                    sig.type === "join"
                      ? { ...(sig.payload || {}), callerName: callerNames.get(sig.senderId) || "Someone" }
                      : sig.payload,
                  createdAt: sig.createdAt,
                });
                // Stop at the first failed enqueue: the rest stay queued for the
                // client's reconnect instead of being silently acknowledged.
                if (!ok) break;
                delivered.push(sig._id);
              }
              if (delivered.length > 0) {
                await db.collection("signaling_updates").deleteMany({ _id: { $in: delivered } });
              }
              if (isClosed) return;
            }

            // Heartbeat any call this user is in, so a crashed tab's call gets
            // reaped instead of blocking every future call in that chat.
            await db.collection("calls").updateOne(
              { status: "active", participants: currentUserId },
              { $set: { heartbeatAt: new Date() } }
            );

            sendSSE(controller, "ping", {});
          } catch (err) {
            console.error("SSE sync loop error:", err);
            sendSSE(controller, "error", { message: "Sync tracking error" });
          }

          // Re-arm only after this pass fully completed.
          if (!isClosed) tickTimer = setTimeout(tick, TICK_MS);
        };

        tickTimer = setTimeout(tick, TICK_MS);
      },
      cancel(reason) {
        isClosed = true;
        if (tickTimer) {
          clearTimeout(tickTimer);
        }
        console.log("SSE sync connection closed:", reason);
        
        // Mark user status as offline upon disconnect
        db.collection<UserDoc>("users")
          .updateOne(
            { _id: new ObjectId(currentUserId) },
            { $set: { status: "offline", lastSeen: new Date() } }
          )
          .catch((err) => console.error("Error setting user offline on close:", err));
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("SSE sync route error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}
