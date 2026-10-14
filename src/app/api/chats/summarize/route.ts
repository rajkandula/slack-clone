import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { ChatDoc, MessageDoc } from "@/lib/db-types";
import { ObjectId } from "mongodb";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chatId");

    if (!chatId) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }

    const currentUserId = user._id.toString();
    const db = await getDb();

    // 1. Verify user is in the chat
    const chat = await db.collection<ChatDoc>("chats").findOne({
      _id: new ObjectId(chatId),
      participants: currentUserId,
    });

    if (!chat) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // 2. Fetch the last 100 messages chronologically
    const messages = await db
      .collection<MessageDoc>("messages")
      .find({ chatId, threadId: null })
      .sort({ seq: -1 })
      .limit(100)
      .toArray();

    // Sort to chronological order
    const chatHistory = messages.reverse();

    if (chatHistory.length === 0) {
      return NextResponse.json({
        summary: "No conversation history exists in this chat yet. Start sending messages to generate an AI summary.",
        actionItems: [],
      });
    }

    // 3. AI Heuristics/Simulation Engine
    // Extracts sentences containing trigger words for Decisions and Actions.
    const actionItems: string[] = [];
    const decisions: string[] = [];
    const speakers = new Set<string>();
    let textMessagesCount = 0;

    chatHistory.forEach((msg) => {
      if (!msg.text) return;
      textMessagesCount++;
      speakers.add(msg.senderUsername);

      const sentences = msg.text.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
      
      sentences.forEach((sentence) => {
        const lower = sentence.toLowerCase();

        // Heuristics for Action Items
        if (
          lower.includes("todo") ||
          lower.startsWith("todo:") ||
          lower.includes("i will") ||
          lower.includes("will do") ||
          lower.includes("can you") ||
          lower.includes("need to") ||
          lower.includes("please do") ||
          lower.startsWith("action:") ||
          lower.startsWith("task:")
        ) {
          // Format as: "@username: task text"
          actionItems.push(`@${msg.senderUsername}: "${sentence}"`);
        }

        // Heuristics for Decisions
        if (
          lower.includes("agreed") ||
          lower.includes("decided") ||
          lower.includes("settled") ||
          lower.includes("sounds good") ||
          lower.includes("deal") ||
          lower.includes("let's do") ||
          lower.includes("perfect")
        ) {
          decisions.push(`@${msg.senderUsername}: "${sentence}"`);
        }
      });
    });

    // Generate summary paragraphs dynamically
    const speakerList = Array.from(speakers).map((s) => `@${s}`).join(", ");
    let summaryText = `A conversation took place between ${speakerList || "participants"} containing ${textMessagesCount} text messages. `;

    if (decisions.length > 0) {
      summaryText += `Key topics were discussed, and several agreements were reached: \n\n` + 
        decisions.map((d) => `• ${d}`).join("\n") + "\n\n";
    } else {
      summaryText += `The participants discussed project details and exchanged updates. No explicit decisions were finalized in this block. `;
    }

    if (actionItems.length === 0) {
      // Add default dummy action items if none found to show UI capabilities
      actionItems.push(`No pending action items were identified in this conversation block.`);
    }

    return NextResponse.json({
      summary: summaryText,
      actionItems: actionItems,
    });
  } catch (error) {
    console.error("AI Summarization error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
