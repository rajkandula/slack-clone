"use client";

import { useEffect, useState, useRef, useCallback, useMemo, Fragment } from "react";
import { createPortal } from "react-dom";
import { useChatSync, CallSignal } from "@/hooks/useChatSync";
import ChannelModal from "./ChannelModal";
import { AttachmentRenderer } from "./PostMedia";
import { classifyFile, type PostMedia } from "@/lib/post-media";
import { hasWaspmoji, pureEmojiCount, renderWaspmoji, WASPMOJI, waspmojiUrl } from "@/lib/waspmoji";
import { playMessageReceived, playMessageSent, startCallSound } from "@/lib/sounds";
import { navigate } from "@/lib/navigate";
import { useSearchParams } from "next/navigation";
import { 
  Settings, 
  LogOut, 
  Plus, 
  Phone, 
  Video, 
  Sparkles, 
  Paperclip, 
  Send, 
  Loader2, 
  X,
  MessageSquare,
  AlertTriangle,
  User,
  Mic,
  MicOff,
  VideoOff,
  Monitor,
  PhoneOff,
  Smile,
  Reply,
  Forward,
  Pin,
  Pencil,
  Trash2,
  Check,
  Camera,
  ShieldCheck,
  ShieldOff,
  Lock,
  Globe,
  Info,
  ChevronLeft,
} from "lucide-react";

interface CallParticipant {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

interface Call {
  id: string;
  chatId: string;
  type: "audio" | "video";
  status: string;
  hostId: string;
  participants: CallParticipant[];
  createdAt: string;
}

interface CallerInfo {
  id: string;
  displayName: string;
  chatId: string;
  type: "audio" | "video";
  callId: string;
}

interface User {
  id: string;
  username: string;
  avatarUrl: string;
  status: string;
  displayName?: string | null;
  email?: string | null;
}

interface Reaction {
  emoji: string;
  userIds: string[];
  count: number;
}

interface Message {
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
  /** Filled in by the media pipeline when an optimised rendition exists. */
  mediaOriginalUrl?: string;
  mediaThumbUrl?: string;
  mediaSensitive?: boolean;
  reactions?: Reaction[];
  replyTo?: { messageId: string; quote?: string | null } | null;
  forwardFrom?: { senderUsername?: string } | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  threadCount?: number;
  readBy: string[];
  createdAt: string;
}

interface Chat {
  id: string;
  type: "dm" | "group" | "channel";
  workspaceId?: string | null;
  visibility?: "public" | "private" | null;
  name: string;
  avatarUrl: string;
  participants: string[];
  otherUserStatus?: "online" | "offline";
  otherUserLastSeen?: string | null;
  unreadCount: number;
  createdAt: string;
  memberCount?: number;
  lastMessage: {
    id: string;
    seq: number;
    text?: string | null;
    mediaType?: string;
    senderUsername: string;
    createdAt: string;
    readBy: string[];
  } | null;
}

export interface ActiveWorkspace {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
  inviteCode?: string;
  description?: string | null;
  avatarUrl?: string;
  visibility?: "public" | "private";
  memberCount?: number;
}

interface ChatWorkspaceProps {
  currentUser: User;
  onLogout: () => void;
  onUserUpdate: (user: User) => void;
  /** null/absent = Personal (DMs + groups); set = show only that workspace's channels */
  workspace?: ActiveWorkspace | null;
  /** Opens the workspace info / settings panel (owned by the shell). */
  onOpenWorkspaceInfo?: () => void;
}

/**
 * One media element per stream, mounted for audio calls too. Hiding it with
 * `display:none` still plays the audio track — gating the element itself on
 * `type === "video"` is what made every audio call completely silent.
 */
const MediaFeed = ({ stream, muted = false, visible = true }: { stream: MediaStream | null; muted?: boolean; visible?: boolean }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    // Autoplay is occasionally refused even after a user gesture; retry rather
    // than leave the far end silently unheard.
    el.play().catch(() => {});
  }, [stream]);

  if (!stream) return null;

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      style={visible ? undefined : { display: "none" }}
    />
  );
};

/**
 * STUN alone only connects peers that can see each other's public address.
 * Symmetric NAT — most mobile carriers, most corporate firewalls — needs a
 * relay, so point `NEXT_PUBLIC_TURN_URL` (comma-separated urls) plus
 * `NEXT_PUBLIC_TURN_USERNAME` / `NEXT_PUBLIC_TURN_CREDENTIAL` at a TURN server
 * in production.
 */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    ...(process.env.NEXT_PUBLIC_TURN_URL
      ? [{
          urls: process.env.NEXT_PUBLIC_TURN_URL.split(",").map((u) => u.trim()).filter(Boolean),
          username: process.env.NEXT_PUBLIC_TURN_USERNAME,
          credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
        }]
      : []),
  ],
  iceCandidatePoolSize: 4,
};

/** How long an unanswered call rings before it gives up, both ends. */
const RING_TIMEOUT_MS = 45_000;

/**
 * Prefer VP9 where both ends support it — noticeably better quality per bit
 * than the VP8/H.264 default at the low bitrates mobile uplinks actually get.
 * (AV1 encode is still experimental in browsers; VP9 is the practical ceiling.)
 */
const preferModernVideoCodecs = (pc: RTCPeerConnection) => {
  const caps = RTCRtpSender.getCapabilities?.("video");
  if (!caps) return;
  const rank = (c: { mimeType: string }) => (c.mimeType === "video/VP9" ? 0 : 1);
  const codecs = [...caps.codecs].sort((a, b) => rank(a) - rank(b));
  pc.getTransceivers().forEach((t) => {
    if (t.sender.track?.kind === "video") {
      try { t.setCodecPreferences(codecs); } catch { /* older browser */ }
    }
  });
};

/**
 * Opus in-band FEC recovers lost audio packets from their successors — the
 * single cheapest fix for "voice keeps dropping out" — and DTX stops sending
 * during silence, freeing uplink for video.
 */
const tuneOpusSdp = (sdp: string): string => {
  const rtpmap = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp);
  if (!rtpmap) return sdp;
  const pt = rtpmap[1];
  const fmtpRe = new RegExp(`a=fmtp:${pt} ([^\r\n]*)`);
  const fmtp = fmtpRe.exec(sdp);
  if (fmtp) {
    let params = fmtp[1];
    if (!/useinbandfec/.test(params)) params += ";useinbandfec=1";
    if (!/usedtx/.test(params)) params += ";usedtx=1";
    return sdp.replace(fmtpRe, `a=fmtp:${pt} ${params}`);
  }
  return sdp.replace(rtpmap[0], `${rtpmap[0]}
a=fmtp:${pt} useinbandfec=1;usedtx=1`);
};

/**
 * Explicit capture constraints. Browsers default to conservative capture
 * (often 640x480) and leave gain to the device, which reads as "blurry and
 * quiet" on phones. Ask for 720p30 and processed audio; `ideal` degrades
 * gracefully on hardware that can't deliver it.
 */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
  facingMode: "user",
};

// Upgrade legacy/checkerboard "identicon" avatars (and missing ones) to a clean
// frosted-glass monogram on the indigo palette — applied at render time so existing
// accounts look professional without a DB migration.
function prettyAvatar(url?: string | null, seed?: string): string {
  if (!url || /dicebear\.com\/[^/]+\/identicon/.test(url)) {
    const s = encodeURIComponent(seed || "user");
    return `https://api.dicebear.com/7.x/glass/svg?seed=${s}&backgroundType=gradientLinear&backgroundColor=7c7cf0,6b8afd,5b8f8a,9a7bd0`;
  }
  return url;
}

// Generate inline SVG data URI fallback for broken avatar images
function avatarFallbackSvg(seed?: string): string {
  const name = seed || "?";
  const initial = name.charAt(0).toUpperCase();
  // Generate a consistent hue from the seed string
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="hsl(${hue},55%,45%)"/><stop offset="100%" stop-color="hsl(${(hue + 40) % 360},60%,35%)"/></linearGradient></defs><rect width="128" height="128" rx="64" fill="url(#g)"/><text x="64" y="64" dy=".35em" text-anchor="middle" fill="white" font-family="-apple-system,sans-serif" font-size="52" font-weight="600">${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Handler for broken avatar images — swaps to inline SVG monogram
function handleAvatarError(e: React.SyntheticEvent<HTMLImageElement>, seed?: string) {
  const target = e.currentTarget;
  // Prevent infinite error loops
  if (target.dataset.fallback === "true") return;
  target.dataset.fallback = "true";
  target.src = avatarFallbackSvg(seed);
}

export default function ChatWorkspace({ currentUser, onLogout, onUserUpdate, workspace = null, onOpenWorkspaceInfo }: ChatWorkspaceProps) {
  const searchParams = useSearchParams();

  // Keep ?chatId (and ?threadId) in the URL for deep links, without a Next
  // navigation — pushState keeps this component (and its SSE stream) mounted.
  const setChatUrl = (chatId: string | null, threadId?: string) => {
    if (typeof window === "undefined") return;
    const base = window.location.pathname;
    const q = new URLSearchParams();
    if (chatId) q.set("chatId", chatId);
    if (threadId) q.set("threadId", threadId);
    const next = q.toString() ? `${base}?${q}` : base;
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.pushState(null, "", next);
    }
  };
  const [chats, setChats] = useState<Chat[]>([]);
  const chatsRef = useRef<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [errorNotification, setErrorNotification] = useState<string | null>(null);

  // --- SIDEBAR RESIZE ---
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const isDraggingSidebar = useRef(false);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingSidebar.current) return;
      const newWidth = Math.min(Math.max(e.clientX, 200), 500);
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      isDraggingSidebar.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // --- PROFILE SETTINGS STATES ---
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [profileName, setProfileName] = useState(currentUser.displayName || "");
  const [profileUsername, setProfileUsername] = useState(currentUser.username || "");
  const [profileEmail, setProfileEmail] = useState(currentUser.email || "");
  const [profilePassword, setProfilePassword] = useState("");
  const [profileConfirmPassword, setProfileConfirmPassword] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(currentUser.avatarUrl || "");
  const [profileUploading, setProfileUploading] = useState(false);
  const [profileSaveLoading, setProfileSaveLoading] = useState(false);
  const [profileBio, setProfileBio] = useState("");
  const [profileGender, setProfileGender] = useState("");
  const [profileDob, setProfileDob] = useState("");
  const settingsAvatarInputRef = useRef<HTMLInputElement>(null);
  // --- WEBRTC CALLING STATES & REFS ---
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "ringing" | "connected">("idle");
  const [isCallIncoming, setIsCallIncoming] = useState(false);
  const [callerInfo, setCallerInfo] = useState<CallerInfo | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, {
    stream: MediaStream;
    username: string;
    displayName: string;
    avatarUrl: string;
    screenShare: boolean;
    hasVideo: boolean;
    /** True when frames stopped arriving — the link is too poor for video. */
    videoStalled?: boolean;
    state: RTCPeerConnectionState;
  }>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isAddParticipantOpen, setIsAddParticipantOpen] = useState(false);

  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const activeCallRef = useRef<Call | null>(null);
  /** Candidates that arrived before their offer — replayed once it lands. */
  const pendingCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const makingOfferRef = useRef<Record<string, boolean>>({});
  /** framesDecoded per peer from the last stats sample, to spot stalled video. */
  const lastFramesRef = useRef<Record<string, number>>({});
  const statsTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const iceRestartedRef = useRef<Record<string, boolean>>({});
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Stops whichever call sound is currently looping. */
  const stopSoundRef = useRef<(() => void) | null>(null);
  /** Mirror of callerInfo for the dependency-free signal handler. */
  const callerInfoRef = useRef<CallerInfo | null>(null);
  /** True once anyone has actually connected — distinguishes "they hung up" from "they never answered". */
  const hadPeerRef = useRef(false);
  /** Lets the dependency-free SSE handler reach the current teardown. */
  const endCallRef = useRef<() => void>(() => {});
  /** Relay credentials issued with the call; null falls back to RTC_CONFIG. */
  const iceServersRef = useRef<RTCIceServer[] | null>(null);
  /** Per-call WebSocket to the edge signalling room (fast path). */
  const rtcWsRef = useRef<WebSocket | null>(null);
  const rtcAcksRef = useRef<Map<string, (delivered: number) => void>>(new Map());
  const rtcSeqRef = useRef(0);
  /** Routes hub messages into the same handler the SSE fallback uses. */
  const handleSignalRef = useRef<(sig: CallSignal) => void>(() => {});

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    callerInfoRef.current = callerInfo;
  }, [callerInfo]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  const clearRingTimer = useCallback(() => {
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
  }, []);

  const playCallSound = useCallback((kind: "incoming" | "ringback") => {
    stopSoundRef.current?.();
    stopSoundRef.current = startCallSound(kind);
  }, []);

  const stopCallSound = useCallback(() => {
    stopSoundRef.current?.();
    stopSoundRef.current = null;
  }, []);

  const startRingTimer = useCallback((onTimeout: () => void) => {
    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    ringTimerRef.current = setTimeout(() => {
      ringTimerRef.current = null;
      onTimeout();
    }, RING_TIMEOUT_MS);
  }, []);

  // Auto-dismiss error toast
  useEffect(() => {
    if (errorNotification) {
      const timer = setTimeout(() => setErrorNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [errorNotification]);

  const selectChat = (chat: Chat | null) => {
    setActiveChat(chat);
    setActiveThreadParent(null);
    setIsAiSummaryOpen(false);
    if (chat) {
      setChatUrl(chat.id);
    } else {
      setChatUrl(null);
    }
  };

  const openThread = (message: Message) => {
    setActiveThreadParent(message);
    setIsAiSummaryOpen(false);
    if (activeChat) {
      setChatUrl(activeChat.id, message.id);
    }
  };

  const closeThread = () => {
    setActiveThreadParent(null);
    if (activeChat) {
      setChatUrl(activeChat.id);
    }
  };
  const [inputText, setInputText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [newChatType, setNewChatType] = useState<"dm" | "group" | "discover">("dm");
  const [groupVisibility, setGroupVisibility] = useState<"public" | "private">("private");
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discoverGroups, setDiscoverGroups] = useState<Array<{ id: string; name: string; avatarUrl: string | null; memberCount: number; joined: boolean }>>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [joiningGroupId, setJoiningGroupId] = useState<string | null>(null);
  
  // New Chat Form states
  const [recipientUsername, setRecipientUsername] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupParticipants, setGroupParticipants] = useState<string>("");
  const [modalError, setModalError] = useState("");
  const [modalLoading, setModalLoading] = useState(false);

  // User autocomplete
  const [userSuggestions, setUserSuggestions] = useState<Array<{ id: string; username: string; displayName: string; avatarUrl: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeField, setActiveField] = useState<"dm" | "group" | null>(null);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchUsers = useCallback((query: string) => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    if (!query || query.length < 1) {
      setUserSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    suggestTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setUserSuggestions(data.users || []);
          setShowSuggestions(data.users?.length > 0);
        }
      } catch { /* ignore */ }
    }, 200);
  }, []);

  const handleSelectSuggestion = (username: string) => {
    if (activeField === "dm") {
      setRecipientUsername(username);
    } else if (activeField === "group") {
      const existing = groupParticipants.split(",").map(s => s.trim()).filter(Boolean);
      if (!existing.includes(username)) {
        existing.push(username);
      }
      setGroupParticipants(existing.join(", "));
    }
    setShowSuggestions(false);
    setUserSuggestions([]);
  };

  // File Upload states
  const [uploadingFile, setUploadingFile] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ url: string; type: "image" | "video" | "file"; name: string; size: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageFeedRef = useRef<HTMLDivElement>(null);
  const threadFeedRef = useRef<HTMLDivElement>(null);

  // --- MESSAGE ACTIONS: edit / reply / forward / pin / reactions ---
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardResults, setForwardResults] = useState<Array<{ username: string; displayName?: string; avatarUrl?: string }>>([]);
  const forwardSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [waspmojiOpen, setWaspmojiOpen] = useState(false);
  const [deleteMenuFor, setDeleteMenuFor] = useState<string | null>(null);
  const [pinnedMessageIds, setPinnedMessageIds] = useState<string[]>([]);
  const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👏"];
  /** WASP-exclusive reactions, first in the tray — our signature. */
  const WASP_REACTIONS = [":buzz:", ":love:", ":lol:", ":sting:", ":fire:", ":king:"];

  // Typing indicators: map of chatId -> usernames currently typing
  const [typingMap, setTypingMap] = useState<Record<string, string[]>>({});
  const lastTypingSentRef = useRef<number>(0);

  // Group info / member management
  interface GroupMember { userId: string; username: string; avatarUrl: string; role: string; status: string; isSelf: boolean; }
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);
  const [addMemberUsername, setAddMemberUsername] = useState("");
  const [renameGroupValue, setRenameGroupValue] = useState("");

  // Presence map
  const [presenceMap, setPresenceMap] = useState<Record<string, { status: string; lastSeen: string }>>({});

  // --- PROJECT AURORA: THREADING & AI SUMMARY STATE ---
  const [activeThreadParent, setActiveThreadParent] = useState<Message | null>(null);
  const [threadReplies, setThreadReplies] = useState<Message[]>([]);
  const [threadInputText, setThreadInputText] = useState("");
  const [threadAttachedFile, setThreadAttachedFile] = useState<{ url: string; type: "image" | "video" | "file"; name: string; size: number } | null>(null);
  const [threadUploadingFile, setThreadUploadingFile] = useState(false);
  const threadFileInputRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const [isAiSummaryOpen, setIsAiSummaryOpen] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryText, setAiSummaryText] = useState("");
  const [aiActionItems, setAiActionItems] = useState<string[]>([]);
  const [aiCheckedItems, setAiCheckedItems] = useState<Record<number, boolean>>({});

  // Fetch Chats on mount
  const fetchChats = useCallback(async () => {
    try {
      const res = await fetch("/api/chats");
      if (res.ok) {
        const data = await res.json();
        setChats(data.chats);
        
        // Auto-select chat from URL parameter if present on load
        const urlParams = new URLSearchParams(window.location.search);
        const urlChatId = urlParams.get("chatId");
        if (urlChatId) {
          const match = data.chats.find((c: Chat) => c.id === urlChatId);
          if (match) {
            setActiveChat(match);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch chats:", err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchChats();
  }, [fetchChats]);

  // Fetch Messages when activeChat changes
  useEffect(() => {
    if (!activeChat) return;
    const activeChatId = activeChat.id;

    async function fetchMessages() {
      try {
        const res = await fetch(`/api/messages?chatId=${activeChatId}`);
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages);
          setPinnedMessageIds(data.pinnedMessageIds || []);

          // Auto-select thread parent if threadId is in URL on load
          const urlParams = new URLSearchParams(window.location.search);
          const urlThreadId = urlParams.get("threadId");
          if (urlThreadId) {
            const parentMsg = data.messages.find((m: Message) => m.id === urlThreadId);
            if (parentMsg) {
              setActiveThreadParent(parentMsg);
            } else {
              // Try to fetch it from the API in case it's a thread reply (which isn't in main feed)
              const threadRes = await fetch(`/api/messages/threads?threadId=${urlThreadId}`);
              if (threadRes.ok) {
                const threadData = await threadRes.json();
                if (threadData.parentMessage) {
                  setActiveThreadParent(threadData.parentMessage);
                }
              }
            }
          }
          
          // Clear local unread count
          setChats((prevChats) =>
            prevChats.map((c) =>
              c.id === activeChatId ? { ...c, unreadCount: 0 } : c
            )
          );
        }
      } catch (err) {
        console.error("Failed to fetch messages:", err);
      }
    }
    
    fetchMessages();
  }, [activeChat]);

  // Synchronize browser back/forward history navigations
  useEffect(() => {
    const urlChatId = searchParams.get("chatId");
    const urlThreadId = searchParams.get("threadId");

    if (!urlChatId) {
      if (activeChat) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveChat(null);
      }
      if (activeThreadParent) {
        setActiveThreadParent(null);
      }
      return;
    }

    if (urlChatId && chats.length > 0) {
      const match = chats.find((c) => c.id === urlChatId);
      if (match && (!activeChat || activeChat.id !== urlChatId)) {
        setActiveChat(match);
      }
    }

    if (urlThreadId && messages.length > 0) {
      const match = messages.find((m) => m.id === urlThreadId);
      if (match) {
        if (!activeThreadParent || activeThreadParent.id !== urlThreadId) {
          setActiveThreadParent(match);
        }
      }
    } else if (!urlThreadId && activeThreadParent) {
      setActiveThreadParent(null);
    }
  }, [searchParams, chats, messages, activeChat, activeThreadParent]);

  // Fetch Thread replies when activeThreadParent changes
  useEffect(() => {
    if (!activeThreadParent) return;

    async function fetchThreadReplies() {
      try {
        const res = await fetch(`/api/messages/threads?threadId=${activeThreadParent!.id}`);
        if (res.ok) {
          const data = await res.json();
          setThreadReplies(data.replies);
        }
      } catch (err) {
        console.error("Failed to fetch thread replies:", err);
      }
    }
    fetchThreadReplies();
  }, [activeThreadParent]);

  // Auto-scroll: instant jump when a chat opens; after that, only follow new
  // messages when the reader is already near the bottom. The old smooth
  // scrollIntoView on every update fought touch scrolling on mobile — the
  // animation restarted with each sync and yanked the reader mid-gesture.
  const lastScrolledChatRef = useRef<string | null>(null);
  useEffect(() => {
    const feed = messageFeedRef.current;
    if (!feed || messages.length === 0) return;
    const openedNewChat = lastScrolledChatRef.current !== activeChat?.id;
    if (openedNewChat) {
      lastScrolledChatRef.current = activeChat?.id ?? null;
      feed.scrollTop = feed.scrollHeight;
      return;
    }
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160;
    if (nearBottom) feed.scrollTop = feed.scrollHeight;
  }, [messages, activeChat?.id]);

  useEffect(() => {
    const panel = threadFeedRef.current;
    if (!panel) return;
    const nearBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 160;
    if (nearBottom || threadReplies.length <= 1) panel.scrollTop = panel.scrollHeight;
  }, [threadReplies]);

  // SSE Synchronization Logic
  const handleMessageReceived = useCallback((msg: Message) => {
    // Someone else's message landing anywhere plays the soft receive tone
    // (throttled inside the sound module so bursts stay quiet).
    if (msg.senderId !== currentUser.id) playMessageReceived();

    // Any thread reply bumps its parent's visible reply count in the feed.
    if (msg.threadId) {
      setMessages((prev) =>
        prev.map((p) => (p.id === msg.threadId ? { ...p, threadCount: (p.threadCount || 0) + 1 } : p))
      );
    }
    // Append to thread if active thread parent matches
    if (msg.threadId && activeThreadParent && msg.threadId === activeThreadParent.id) {
      setThreadReplies((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      return; // Thread replies do not go into main channel feed
    }

    // Append to main messages if active chat matches and it's a top-level message
    if (!msg.threadId && activeChat && msg.chatId === activeChat.id) {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });

      // Mark message as read
      fetch(`/api/messages?chatId=${activeChat.id}`).catch(console.error);
    }

    // Update chats list item snippet and unread badges
    setChats((prevChats) => {
      const chatIndex = prevChats.findIndex((c) => c.id === msg.chatId);
      if (chatIndex === -1) {
        fetchChats();
        return prevChats;
      }

      const updatedChats = [...prevChats];
      const chat = updatedChats[chatIndex];
      const isCurrentActive = activeChat && activeChat.id === msg.chatId;

      updatedChats[chatIndex] = {
        ...chat,
        unreadCount: isCurrentActive || msg.threadId ? chat.unreadCount : chat.unreadCount + (msg.senderId !== currentUser.id ? 1 : 0),
        lastMessage: {
          id: msg.id,
          seq: msg.seq,
          text: msg.text,
          mediaType: msg.mediaType,
          senderUsername: msg.senderUsername,
          createdAt: msg.createdAt,
          readBy: msg.readBy,
        },
      };

      // Sort chats
      return updatedChats.sort(
        (a, b) =>
          new Date(b.lastMessage?.createdAt || b.createdAt || 0).getTime() -
          new Date(a.lastMessage?.createdAt || a.createdAt || 0).getTime()
      );
    });
  }, [activeChat, activeThreadParent, currentUser.id, fetchChats]);

  // Apply an edit / delete / reaction update streamed from the server.
  const handleMessageUpdate = useCallback((msg: Message) => {
    const patch = (prev: Message[]) =>
      prev.map((m) =>
        m.id === msg.id
          ? {
              ...m,
              text: msg.text,
              mediaUrl: msg.mediaUrl,
              mediaType: msg.mediaType,
              mediaName: msg.mediaName,
              mediaSize: msg.mediaSize,
              reactions: msg.reactions,
              editedAt: msg.editedAt,
              deletedAt: msg.deletedAt,
            }
          : m
      );
    setMessages(patch);
    setThreadReplies(patch);
  }, []);

  // --- MESSAGE ACTION HANDLERS ---
  const submitEditMessage = async (messageId: string, text: string) => {
    if (!text.trim()) return;
    try {
      const res = await fetch("/api/messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, text: text.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        handleMessageUpdate(data.message);
      } else {
        const err = await res.json();
        setErrorNotification(err.error || "Failed to edit message");
      }
    } catch {
      setErrorNotification("Failed to edit message");
    } finally {
      setEditingMessage(null);
      setInputText("");
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      const res = await fetch(`/api/messages?messageId=${messageId}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        handleMessageUpdate(data.message);
      } else {
        const err = await res.json();
        setErrorNotification(err.error || "Failed to delete message");
      }
    } catch {
      setErrorNotification("Failed to delete message");
    }
  };

  const handleDeleteForMe = async (messageId: string) => {
    setDeleteMenuFor(null);
    try {
      const res = await fetch(`/api/messages?messageId=${messageId}&scope=me`, { method: "DELETE" });
      if (res.ok) {
        // Hidden only for this user — drop it from the local list outright.
        setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
      } else {
        const err = await res.json();
        setErrorNotification(err.error || "Failed to delete message");
      }
    } catch {
      setErrorNotification("Failed to delete message");
    }
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    setReactionPickerFor(null);
    try {
      const res = await fetch("/api/messages/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, emoji }),
      });
      if (res.ok) {
        const data = await res.json();
        handleMessageUpdate(data.message);
      }
    } catch {
      setErrorNotification("Failed to add reaction");
    }
  };

  const handleTogglePin = async (message: Message) => {
    const isPinned = pinnedMessageIds.includes(message.id);
    try {
      const res = await fetch("/api/messages/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id, pin: !isPinned }),
      });
      if (res.ok) {
        const data = await res.json();
        setPinnedMessageIds(data.pinnedMessageIds);
      } else {
        const err = await res.json();
        setErrorNotification(err.error || "Failed to pin message");
      }
    } catch {
      setErrorNotification("Failed to pin message");
    }
  };

  // Type a name in the forward modal → live user results; picking one
  // forwards into the DM with that user (created on the fly if needed).
  const searchForwardUsers = (query: string) => {
    setForwardSearch(query);
    if (forwardSearchTimer.current) clearTimeout(forwardSearchTimer.current);
    if (!query.trim()) { setForwardResults([]); return; }
    forwardSearchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setForwardResults((data.users || []).filter((u: { username: string }) => u.username !== currentUser.username));
        }
      } catch { /* ignore */ }
    }, 200);
  };

  const handleForwardToUser = async (username: string) => {
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "dm", recipientUsername: username }),
    });
    if (res.ok) {
      const data = await res.json();
      await handleForwardMessage(data.chat.id);
      fetchChats();
    } else {
      setErrorNotification("Couldn't start a chat with that user");
    }
  };

  const closeForwardModal = () => {
    setForwardingMessage(null);
    setForwardSearch("");
    setForwardResults([]);
  };

  const handleForwardMessage = async (targetChatId: string) => {
    if (!forwardingMessage) return;
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: targetChatId,
          clientMsgId: crypto.randomUUID(),
          text: forwardingMessage.text || undefined,
          mediaUrl: forwardingMessage.mediaUrl,
          mediaType: forwardingMessage.mediaType,
          mediaName: forwardingMessage.mediaName,
          mediaSize: forwardingMessage.mediaSize,
          forwardFrom: { senderUsername: forwardingMessage.senderUsername },
        }),
      });
      if (res.ok) {
        closeForwardModal();
        setErrorNotification("");
      } else {
        const err = await res.json();
        setErrorNotification(err.error || "Failed to forward message");
      }
    } catch {
      setErrorNotification("Failed to forward message");
    }
  };

  const handleTyping = useCallback((update: { chatId: string; users: { userId: string; username: string }[] }) => {
    setTypingMap((prev) => ({
      ...prev,
      [update.chatId]: update.users.map((u) => u.username),
    }));
  }, []);

  // Throttled "I'm typing" signal — at most once every 2.5s while typing.
  const signalTyping = (chatId: string) => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2500) return;
    lastTypingSentRef.current = now;
    fetch("/api/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    }).catch(() => {});
  };

  // --- GROUP MEMBER MANAGEMENT ---
  const loadGroupMembers = useCallback(async (chatId: string) => {
    setGroupMembersLoading(true);
    try {
      const res = await fetch(`/api/chats/members?chatId=${chatId}`);
      if (res.ok) {
        const data = await res.json();
        setGroupMembers(data.members);
      }
    } catch {
      setErrorNotification("Failed to load members");
    } finally {
      setGroupMembersLoading(false);
    }
  }, []);

  const openGroupInfo = () => {
    if (!activeChat || activeChat.type === "dm") return;
    setRenameGroupValue(activeChat.name);
    setAddMemberUsername("");
    setIsGroupInfoOpen(true);
    loadGroupMembers(activeChat.id);
  };

  const myRoleInActiveChat = (): string => {
    const me = groupMembers.find((m) => m.isSelf);
    return me?.role || "member";
  };

  const handleAddMember = async () => {
    if (!activeChat || !addMemberUsername.trim()) return;
    try {
      const res = await fetch("/api/chats/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: activeChat.id, username: addMemberUsername.trim() }),
      });
      if (res.ok) {
        setAddMemberUsername("");
        loadGroupMembers(activeChat.id);
        fetchChats();
      } else {
        const err = await res.json();
        setErrorNotification(err.error || "Failed to add member");
      }
    } catch {
      setErrorNotification("Failed to add member");
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!activeChat) return;
    try {
      const res = await fetch(`/api/chats/members?chatId=${activeChat.id}&userId=${userId}`, { method: "DELETE" });
      if (res.ok) {
        const isSelf = userId === currentUser.id;
        if (isSelf) {
          setIsGroupInfoOpen(false);
          setActiveChat(null);
          fetchChats();
        } else {
          loadGroupMembers(activeChat.id);
          fetchChats();
        }
      } else {
        const err = await res.json();
        setErrorNotification(err.error || "Failed to remove member");
      }
    } catch {
      setErrorNotification("Failed to remove member");
    }
  };

  const handleChangeRole = async (userId: string, role: "admin" | "member") => {
    if (!activeChat) return;
    try {
      const res = await fetch("/api/chats/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: activeChat.id, userId, role }),
      });
      if (res.ok) {
        loadGroupMembers(activeChat.id);
      } else {
        const err = await res.json();
        setErrorNotification(err.error || "Failed to change role");
      }
    } catch {
      setErrorNotification("Failed to change role");
    }
  };

  const groupAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const [groupAvatarUploading, setGroupAvatarUploading] = useState(false);

  const handleGroupAvatarChange = async (file: File | null) => {
    if (!file || !activeChat) return;
    if (!file.type.startsWith("image/")) {
      setErrorNotification("Please choose an image file");
      return;
    }
    setGroupAvatarUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/media/upload", { method: "POST", body: fd });
      const upData = await up.json();
      if (!up.ok) throw new Error(upData.error || "Upload failed");

      const res = await fetch("/api/chats", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: activeChat.id, avatarUrl: upData.mediaUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update group photo");

      setActiveChat((prev) => (prev ? { ...prev, avatarUrl: data.avatarUrl } : prev));
      setChats((prev) => prev.map((c) => (c.id === activeChat.id ? { ...c, avatarUrl: data.avatarUrl } : c)));
    } catch (err) {
      setErrorNotification(err instanceof Error ? err.message : "Failed to update group photo");
    } finally {
      setGroupAvatarUploading(false);
    }
  };

  const handleGroupVisibility = async (visibility: "public" | "private") => {
    if (!activeChat || activeChat.visibility === visibility) return;
    try {
      const res = await fetch("/api/chats", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: activeChat.id, visibility }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update visibility");
      setActiveChat((prev) => (prev ? { ...prev, visibility: data.visibility } : prev));
      setChats((prev) => prev.map((c) => (c.id === activeChat.id ? { ...c, visibility: data.visibility } : c)));
    } catch (err) {
      setErrorNotification(err instanceof Error ? err.message : "Failed to update visibility");
    }
  };

  const handleRenameGroup = async () => {
    if (!activeChat || !renameGroupValue.trim() || renameGroupValue.trim() === activeChat.name) return;
    try {
      const res = await fetch("/api/chats", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: activeChat.id, name: renameGroupValue.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveChat({ ...activeChat, name: data.name });
        setChats((prev) => prev.map((c) => (c.id === activeChat.id ? { ...c, name: data.name } : c)));
      } else {
        const err = await res.json();
        setErrorNotification(err.error || "Failed to rename group");
      }
    } catch {
      setErrorNotification("Failed to rename group");
    }
  };

  const startEditing = (m: Message) => {
    setReplyingTo(null);
    setEditingMessage(m);
    setInputText(m.text || "");
  };

  const startReplying = (m: Message) => {
    setEditingMessage(null);
    setReplyingTo(m);
  };

  // --- WEBRTC SIGNALING HANDLERS ---
  const sendCallSignal = useCallback(async (callId: string, recipientId: string, type: string, payload: unknown) => {
    // Fast path: the per-call edge room (~100ms). The ack carries how many of
    // the recipient's sockets got it — zero means they aren't connected to the
    // hub, so the signal falls through to the durable Mongo/SSE path instead
    // of silently evaporating.
    const ws = rtcWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && type !== "join") {
      const id = String(++rtcSeqRef.current);
      const delivered = await new Promise<number>((resolve) => {
        const timer = setTimeout(() => { rtcAcksRef.current.delete(id); resolve(-1); }, 900);
        rtcAcksRef.current.set(id, (n) => { clearTimeout(timer); resolve(n); });
        try {
          ws.send(JSON.stringify({ id, recipientId, type, payload }));
        } catch {
          clearTimeout(timer);
          rtcAcksRef.current.delete(id);
          resolve(-1);
        }
      });
      if (delivered > 0) return true;
    }

    try {
      const res = await fetch("/api/calls/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, recipientId, type, payload })
      });
      if (!res.ok) {
        // fetch() resolves on 4xx, so an unchecked call here fails silently —
        // which is how a declined call used to leave the caller ringing forever.
        console.error("Call signal rejected:", type, res.status);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Failed to send call signal:", err);
      return false;
    }
  }, []);

  /** Open the fast signalling channel for this call. Absent in `next dev`
      (the hub lives in the Worker), in which case every signal simply uses
      the fallback path — same behaviour as before this existed. */
  const connectRtcWs = useCallback((token: string) => {
    try {
      rtcWsRef.current?.close();
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/rtc?token=${encodeURIComponent(token)}`);
      rtcWsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.ack) {
            rtcAcksRef.current.get(String(d.ack))?.(d.delivered ?? 0);
            rtcAcksRef.current.delete(String(d.ack));
          } else if (d.type) {
            handleSignalRef.current(d as CallSignal);
          }
        } catch { /* not ours */ }
      };
      ws.onclose = () => { if (rtcWsRef.current === ws) rtcWsRef.current = null; };
      ws.onerror = () => { /* fallback path covers it */ };
    } catch { /* no WebSocket — fallback path covers it */ }
  }, []);

  /** Look up a peer's identity from the current roster, falling back to the chat. */
  const describePeer = useCallback((peerId: string) => {
    const fromCall = activeCallRef.current?.participants.find((p: CallParticipant) => p.id === peerId);
    if (fromCall) {
      return {
        username: fromCall.username,
        displayName: fromCall.displayName || fromCall.username,
        avatarUrl: fromCall.avatarUrl,
      };
    }
    return { username: "Peer", displayName: "Peer", avatarUrl: "" };
  }, []);

  /**
   * Give the bandwidth estimator sane targets. Without a cap the browser
   * either over-shoots a weak uplink (freezing video entirely while audio
   * limps on) or never ramps up; 2.5 Mbps comfortably carries 720p30, and the
   * audio headroom keeps voice clear before video gets a byte.
   */
  const tuneSender = (sender: RTCRtpSender) => {
    if (!sender.track) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      if (sender.track.kind === "video") {
        params.encodings[0].maxBitrate = 2_500_000;
        params.degradationPreference = "balanced";
      } else {
        params.encodings[0].maxBitrate = 128_000;
      }
      sender.setParameters(params).catch(() => {});
    } catch { /* older browsers */ }
  };

  const closePeer = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current[peerId];
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onnegotiationneeded = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      try { pc.close(); } catch { /* already closed */ }
    }
    delete peerConnectionsRef.current[peerId];
    delete pendingCandidatesRef.current[peerId];
    delete makingOfferRef.current[peerId];
    delete iceRestartedRef.current[peerId];
    delete lastFramesRef.current[peerId];
    if (statsTimersRef.current[peerId]) {
      clearInterval(statsTimersRef.current[peerId]);
      delete statsTimersRef.current[peerId];
    }
    setRemoteStreams(prev => {
      if (!prev[peerId]) return prev;
      const copy = { ...prev };
      delete copy[peerId];
      return copy;
    });
  }, []);

  /** Apply any candidates that arrived before the remote description did. */
  const drainCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current[peerId];
    if (!queued || queued.length === 0) return;
    delete pendingCandidatesRef.current[peerId];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn("Discarded a buffered ICE candidate:", err);
      }
    }
  }, []);

  /**
   * Get (or build) the peer connection for `peerId`. One factory for both ends
   * of the call: whoever ends up making the offer is decided by
   * `onnegotiationneeded` and the perfect-negotiation rules in `handleDescription`,
   * not by which function happened to create the connection.
   */
  const getPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    const existing = peerConnectionsRef.current[peerId];
    if (existing && existing.connectionState !== "closed" && existing.connectionState !== "failed") {
      return existing;
    }
    if (existing) closePeer(peerId);

    const pc = new RTCPeerConnection(
      iceServersRef.current
        ? { iceServers: iceServersRef.current, iceCandidatePoolSize: 4 }
        : RTC_CONFIG
    );
    peerConnectionsRef.current[peerId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
      pc.getSenders().forEach(tuneSender);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && activeCallRef.current) {
        sendCallSignal(activeCallRef.current.id, peerId, "candidate", event.candidate.toJSON());
      }
    };

    // Fires when tracks are added or replaced in a way that needs a new SDP
    // exchange — screen sharing over an audio-first connection, for instance.
    pc.onnegotiationneeded = async () => {
      const call = activeCallRef.current;
      if (!call || pc.signalingState !== "stable") return;
      try {
        makingOfferRef.current[peerId] = true;
        preferModernVideoCodecs(pc);
        const offer = await pc.createOffer();
        offer.sdp = tuneOpusSdp(offer.sdp || "");
        await pc.setLocalDescription(offer);
        if (pc.localDescription) {
          sendCallSignal(call.id, peerId, pc.localDescription.type === "answer" ? "answer" : "offer", pc.localDescription.toJSON());
        }
      } catch (err) {
        console.error("Negotiation failed for peer:", peerId, err);
      } finally {
        makingOfferRef.current[peerId] = false;
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      const identity = describePeer(peerId);
      const refreshTracks = () => {
        setRemoteStreams(prev => {
          const entry = prev[peerId];
          if (!entry) return prev;
          const hasVideo = stream.getVideoTracks().some(t => t.readyState === "live");
          if (entry.hasVideo === hasVideo) return prev;
          return { ...prev, [peerId]: { ...entry, hasVideo } };
        });
      };
      event.track.addEventListener("ended", refreshTracks);
      event.track.addEventListener("mute", refreshTracks);
      event.track.addEventListener("unmute", refreshTracks);

      setRemoteStreams(prev => ({
        ...prev,
        [peerId]: {
          screenShare: prev[peerId]?.screenShare ?? false,
          ...identity,
          stream,
          hasVideo: stream.getVideoTracks().some(t => t.readyState === "live"),
          state: pc.connectionState,
        },
      }));
      hadPeerRef.current = true;
      stopCallSound();
      clearRingTimer();
    };

    pc.onconnectionstatechange = () => {
      setRemoteStreams(prev => (prev[peerId] ? { ...prev, [peerId]: { ...prev[peerId], state: pc.connectionState } } : prev));
      if (pc.connectionState === "connected") {
        iceRestartedRef.current[peerId] = false;
        clearRingTimer();
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState !== "failed") return;
      // One restart buys back the common case (a network hop); a second failure
      // means there is no path at all — usually symmetric NAT with no TURN.
      if (!iceRestartedRef.current[peerId]) {
        iceRestartedRef.current[peerId] = true;
        try { pc.restartIce(); } catch { /* unsupported */ }
      } else {
        console.error("ICE could not connect to peer", peerId, "— a TURN server is required on this network.");
        setErrorNotification(`Couldn't reach ${describePeer(peerId).displayName} — their network needs a relay (TURN) server`);
        closePeer(peerId);
      }
    };

    // A black tile with no explanation is the worst failure mode. Sample
    // framesDecoded every 3s; if it stops advancing while the connection is
    // up, say so on the tile instead of leaving the user staring at darkness.
    if (statsTimersRef.current[peerId]) clearInterval(statsTimersRef.current[peerId]);
    statsTimersRef.current[peerId] = setInterval(async () => {
      if (pc.connectionState !== "connected") return;
      try {
        const stats = await pc.getStats();
        let frames = -1;
        stats.forEach((r) => {
          const rec = r as unknown as { type: string; kind?: string; framesDecoded?: number };
          if (rec.type === "inbound-rtp" && rec.kind === "video") frames = rec.framesDecoded ?? 0;
        });
        if (frames < 0) return; // audio-only call
        const last = lastFramesRef.current[peerId];
        lastFramesRef.current[peerId] = frames;
        if (last === undefined) return;
        const stalled = frames === last;
        setRemoteStreams(prev =>
          prev[peerId] && prev[peerId].videoStalled !== stalled
            ? { ...prev, [peerId]: { ...prev[peerId], videoStalled: stalled } }
            : prev
        );
      } catch { /* stats unavailable mid-teardown */ }
    }, 3000);

    return pc;
  }, [closePeer, describePeer, sendCallSignal, clearRingTimer]);

  /**
   * Perfect negotiation: both sides may offer at once, and the "impolite" peer
   * (lower user id) keeps its own offer while the polite one rolls back.
   */
  const handleDescription = useCallback(async (peerId: string, description: RTCSessionDescriptionInit) => {
    const call = activeCallRef.current;
    if (!call) return;

    const pc = getPeerConnection(peerId);
    const polite = currentUser.id > peerId;
    const collision =
      description.type === "offer" &&
      (makingOfferRef.current[peerId] || pc.signalingState !== "stable");

    if (collision && !polite) return;

    try {
      if (collision) {
        await pc.setLocalDescription({ type: "rollback" } as RTCLocalSessionDescriptionInit);
      }
      await pc.setRemoteDescription(new RTCSessionDescription(description));
      await drainCandidates(peerId, pc);

      if (description.type === "offer") {
        preferModernVideoCodecs(pc);
        const answer = await pc.createAnswer();
        answer.sdp = tuneOpusSdp(answer.sdp || "");
        await pc.setLocalDescription(answer);
        if (pc.localDescription) {
          sendCallSignal(call.id, peerId, "answer", pc.localDescription.toJSON());
        }
      }
    } catch (err) {
      console.error("Failed to apply remote description from peer:", peerId, err);
    }
  }, [currentUser.id, getPeerConnection, drainCandidates, sendCallSignal]);

  /** Re-read the roster so late joiners get a real name instead of "Peer". */
  const refreshCallRoster = useCallback(async (chatId: string) => {
    try {
      const res = await fetch(`/api/calls?chatId=${chatId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.call || data.call.id !== activeCallRef.current?.id) return;
      setActiveCall(data.call);
      activeCallRef.current = data.call;
      setRemoteStreams(prev => {
        const next = { ...prev };
        for (const p of data.call.participants as CallParticipant[]) {
          if (next[p.id]) {
            next[p.id] = { ...next[p.id], username: p.username, displayName: p.displayName || p.username, avatarUrl: p.avatarUrl };
          }
        }
        return next;
      });
    } catch (err) {
      console.error("Failed to refresh call roster:", err);
    }
  }, []);

  const handleCallSignalReceived = useCallback(async (sig: CallSignal) => {
    const { senderId, type, payload, callId } = sig;
    const call = activeCallRef.current;

    // The caller hung up while we were still ringing: we have no activeCall
    // yet, so without this branch the guard below would drop the hangup and
    // the incoming-call banner would sit there until the timeout.
    if (!call && (type === "hangup" || type === "decline") && callerInfoRef.current?.callId === callId) {
      stopCallSound();
      clearRingTimer();
      setIsCallIncoming(false);
      setCallerInfo(null);
      setCallStatus("idle");
      return;
    }

    // Every branch below touches a peer connection, so a signal from a *different*
    // call must never get through: a replayed offer from a finished call would
    // otherwise tear down the connection currently carrying your voice.
    if (type !== "join" && call?.id !== callId) return;

    switch (type) {
      case "join": {
        if (!call) {
          const invite = payload as { chatId: string; callerName: string; type: "audio" | "video" };
          setCallerInfo({
            id: senderId,
            // `callerName` is stamped by the sync route from the users
            // collection, never copied from whatever the sender posted.
            displayName: invite.callerName || "Someone",
            chatId: invite.chatId,
            type: invite.type === "video" ? "video" : "audio",
            callId
          });
          setIsCallIncoming(true);
          setCallStatus("ringing");
          playCallSound("incoming");
          startRingTimer(() => {
            stopCallSound();
            setIsCallIncoming(false);
            setCallerInfo(null);
            setCallStatus("idle");
          });
        } else if (call.id === callId) {
          // Idempotent: an already-connected peer must not have its live
          // connection torn down and rebuilt.
          const existing = peerConnectionsRef.current[senderId];
          if (!existing || existing.connectionState === "failed" || existing.connectionState === "closed") {
            getPeerConnection(senderId);
          }
          refreshCallRoster(call.chatId);
        } else {
          // Already on another call. Say so, rather than dropping the invite on
          // the floor and leaving the second caller staring at an empty room.
          sendCallSignal(callId, senderId, "decline", {});
          setErrorNotification("Missed a call — you were already on another one");
        }
        break;
      }
      case "offer":
      case "answer": {
        await handleDescription(senderId, payload as RTCSessionDescriptionInit);
        break;
      }
      case "candidate": {
        const pc = peerConnectionsRef.current[senderId];
        // Candidates routinely beat the offer they belong to. Buffer them
        // instead of dropping them — without a remote description there is
        // nothing to attach them to, and ICE would never complete.
        if (!pc || !pc.remoteDescription) {
          (pendingCandidatesRef.current[senderId] ||= []).push(payload as RTCIceCandidateInit);
          break;
        }
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload as RTCIceCandidateInit));
        } catch (err) {
          console.warn("Rejected ICE candidate from peer:", senderId, err);
        }
        break;
      }
      case "screen_share": {
        const sharing = !!(payload as { sharing?: boolean })?.sharing;
        setRemoteStreams(prev => (prev[senderId] ? { ...prev, [senderId]: { ...prev[senderId], screenShare: sharing } } : prev));
        break;
      }
      case "decline":
      case "hangup": {
        closePeer(senderId);
        if (type === "decline") setErrorNotification("Call declined");
        if (Object.keys(peerConnectionsRef.current).length > 0) {
          if (call) refreshCallRoster(call.chatId);
          break;
        }
        // Nobody is on the wire any more. The old handler just removed the
        // peer's tile — the camera stayed lit and the overlay stayed up with
        // an empty room. Tear the whole thing down, unless this is a group
        // call still ringing other people, where one decline means nothing.
        const isDm = chatsRef.current.find(c => c.id === call?.chatId)?.type === "dm";
        if (hadPeerRef.current || isDm) {
          endCallRef.current();
        } else if (call) {
          refreshCallRoster(call.chatId);
        }
        break;
      }
    }
  }, [handleDescription, getPeerConnection, refreshCallRoster, closePeer, startRingTimer, playCallSound, stopCallSound, clearRingTimer]);

  // --- CALL CONTROL ACTIONS ---

  /**
   * Media first, always. Requesting it *after* announcing the call built peer
   * connections with zero tracks — permanently silent and invisible for the
   * rest of the call — and a denied permission left an `active` call row behind
   * that every later call in that chat would silently join.
   */
  const acquireLocalMedia = async (type: "audio" | "video"): Promise<MediaStream | null> => {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: type === "video" ? VIDEO_CONSTRAINTS : false });
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (type === "video" && (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError")) {
        // No usable camera: fall back to audio rather than costing the user
        // their microphone as well, which the all-or-nothing request did.
        try {
          setErrorNotification("No camera available — joining with audio only");
          return await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
        } catch {
          setErrorNotification("No microphone or camera available");
          return null;
        }
      }
      setErrorNotification(
        name === "NotAllowedError"
          ? `Allow ${type === "video" ? "camera and microphone" : "microphone"} access to place calls`
          : "Could not access your microphone"
      );
      return null;
    }
  };

  const openCall = async (chatId: string, type: "audio" | "video", joining = false) => {
    const stream = await acquireLocalMedia(type);
    if (!stream) {
      setCallStatus("idle");
      return;
    }

    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, type })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        stream.getTracks().forEach(t => t.stop());
        setErrorNotification(errorData.error || "Failed to start call");
        setCallStatus("idle");
        return;
      }
      const data = await res.json();

      // You clicked Video but an audio call was already running (or the reverse):
      // the server returns the call that actually exists, so match its media.
      // Publishing video into a call every client renders as audio just lit the
      // camera with no on-screen way to turn it off.
      let media = stream;
      if (data.call.type !== type) {
        stream.getTracks().forEach(t => t.stop());
        const corrected = await acquireLocalMedia(data.call.type);
        if (!corrected) {
          fetch(`/api/calls?callId=${data.call.id}`, { method: "DELETE" }).catch(() => {});
          setCallStatus("idle");
          return;
        }
        media = corrected;
        setErrorNotification(`Joined the ${data.call.type} call already in progress`);
      }

      localStreamRef.current = media;
      setLocalStream(media);
      hadPeerRef.current = false;
      iceServersRef.current = Array.isArray(data.iceServers) && data.iceServers.length ? data.iceServers : null;
      // Join the instant-signalling room for this call (no-op in `next dev`).
      if (data.rtcToken) connectRtcWs(data.rtcToken);
      setIsMuted(false);
      setIsCameraOff(false);
      setActiveCall(data.call);
      activeCallRef.current = data.call;
      setCallStatus("connected");
      // Nobody has picked up yet — don't ring into the void indefinitely,
      // and let the caller HEAR that it is ringing.
      if (!joining) playCallSound("ringback");
      startRingTimer(() => {
        setErrorNotification(joining ? "Could not connect to the call" : "No answer");
        endCallRef.current();
      });
    } catch (err) {
      console.error("Error starting call:", err);
      stream.getTracks().forEach(t => t.stop());
      setErrorNotification("Error starting call");
      setCallStatus("idle");
    }
  };

  const startCall = async (type: "audio" | "video") => {
    if (!activeChat || activeCallRef.current) return;
    setCallStatus("calling");
    await openCall(activeChat.id, type);
  };

  const acceptCall = async () => {
    if (!callerInfo) return;
    const invite = callerInfo;
    stopCallSound();
    clearRingTimer();
    setIsCallIncoming(false);
    setCallerInfo(null);

    // The call may have been cancelled while the modal sat there.
    try {
      const check = await fetch(`/api/calls?chatId=${invite.chatId}`);
      const data = check.ok ? await check.json() : { call: null };
      if (!data.call || data.call.id !== invite.callId) {
        setErrorNotification("That call has already ended");
        setCallStatus("idle");
        return;
      }
    } catch {
      /* fall through and let the POST decide */
    }

    await openCall(invite.chatId, invite.type, true);
  };

  const declineCall = async () => {
    const invite = callerInfo;
    stopCallSound();
    clearRingTimer();
    setIsCallIncoming(false);
    setCallStatus("idle");
    setCallerInfo(null);
    if (!invite) return;
    const sent = await sendCallSignal(invite.callId, invite.id, "decline", {});
    if (!sent) setErrorNotification("Could not notify the caller");
  };

  const endCall = useCallback(async () => {
    const call = activeCallRef.current;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    Object.keys(peerConnectionsRef.current).forEach(peerId => {
      const pc = peerConnectionsRef.current[peerId];
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onnegotiationneeded = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      try { pc.close(); } catch { /* already closed */ }
    });
    peerConnectionsRef.current = {};
    pendingCandidatesRef.current = {};
    makingOfferRef.current = {};
    iceRestartedRef.current = {};
    hadPeerRef.current = false;
    stopCallSound();
    rtcWsRef.current?.close();
    rtcWsRef.current = null;
    rtcAcksRef.current.clear();
    iceServersRef.current = null;
    clearRingTimer();

    setLocalStream(null);
    setScreenStream(null);
    setRemoteStreams({});
    setActiveCall(null);
    activeCallRef.current = null;
    setCallStatus("idle");
    setIsCallIncoming(false);
    setCallerInfo(null);
    setIsScreenSharing(false);
    setIsAddParticipantOpen(false);

    if (call) {
      try {
        await fetch(`/api/calls?callId=${call.id}`, { method: "DELETE" });
      } catch (err) {
        console.error("Failed to end call session:", err);
      }
    }
  }, [clearRingTimer]);

  // The signal handler is memoised with no deps so the SSE subscription stays
  // put; route the teardown through a ref so it can still reach the live one.
  useEffect(() => {
    endCallRef.current = endCall;
  }, [endCall]);

  useEffect(() => {
    handleSignalRef.current = handleCallSignalReceived;
  }, [handleCallSignalReceived]);

  // Closing the tab has to hand the call back, or every peer keeps a frozen
  // tile and the chat stays "in a call" until the server-side reaper fires.
  useEffect(() => {
    const onPageHide = () => {
      const call = activeCallRef.current;
      if (!call) return;
      navigator.sendBeacon?.(`/api/calls/leave?callId=${call.id}`);
      rtcWsRef.current?.close();
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      Object.values(peerConnectionsRef.current).forEach(pc => { try { pc.close(); } catch { /* noop */ } });
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !isMuted;
    stream.getAudioTracks().forEach(track => { track.enabled = !next; });
    setIsMuted(next);
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !isCameraOff;
    stream.getVideoTracks().forEach(track => { track.enabled = !next; });
    setIsCameraOff(next);
  };

  /** Push `track` to every peer as our outgoing video, renegotiating if needed. */
  const publishVideoTrack = useCallback((track: MediaStreamTrack | null) => {
    Object.values(peerConnectionsRef.current).forEach(pc => {
      const videoSender = pc.getSenders().find(s => s.track?.kind === "video");
      if (videoSender) {
        videoSender.replaceTrack(track).then(() => tuneSender(videoSender)).catch(err => console.error("replaceTrack failed:", err));
      } else if (track) {
        // Adding a sender fires onnegotiationneeded, which is what actually
        // gets the new stream to the far end.
        const sender = pc.addTrack(track, localStreamRef.current || new MediaStream([track]));
        tuneSender(sender);
      }
    });
  }, []);

  const announceScreenShare = useCallback((sharing: boolean) => {
    const call = activeCallRef.current;
    if (!call) return;
    Object.keys(peerConnectionsRef.current).forEach(peerId => {
      sendCallSignal(call.id, peerId, "screen_share", { sharing });
    });
  }, [sendCallSignal]);

  const stopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    setScreenStream(null);
    setIsScreenSharing(false);
    publishVideoTrack(localStreamRef.current?.getVideoTracks()[0] ?? null);
    announceScreenShare(false);
  }, [publishVideoTrack, announceScreenShare]);

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setScreenStream(stream);
      setIsScreenSharing(true);

      const screenTrack = stream.getVideoTracks()[0];
      // "Stop sharing" in the browser's own bar has to unwind this too.
      screenTrack.addEventListener("ended", () => stopScreenShare());
      publishVideoTrack(screenTrack);
      // Explicit, because sniffing `track.label` for "screen" never matched:
      // labels are localised and often empty over the wire.
      announceScreenShare(true);
    } catch (err) {
      console.error("Failed to share screen:", err);
    }
  };

  // Call UI lives on <body>, not inside the view the shell may hide.
  // Everything portalled here is null until a call exists, so there is nothing
  // to mismatch during hydration.
  const callPortalTarget = typeof document !== "undefined" ? document.body : null;

  /** The local tile shows video for the camera *or* an active screen share. */
  const showLocalPreview =
    activeCall?.type === "video" && (isScreenSharing ? !!screenStream : !!localStream && !isCameraOff);

  /** Chat members not yet in the call, with the names the roster gives us. */
  const invitableMembers = useMemo(() => {
    if (!activeCall) return [];
    const inCall = new Set(activeCall.participants.map((p: CallParticipant) => p.id));
    return groupMembers.filter(m => !m.isSelf && !inCall.has(m.userId));
  }, [activeCall, groupMembers]);

  const inviteMemberToCall = async (memberId: string) => {
    const call = activeCallRef.current;
    if (!call) return;
    const sent = await sendCallSignal(call.id, memberId, "join", {
      chatId: call.chatId,
      type: call.type,
    });
    if (!sent) setErrorNotification("Could not invite that person");
  };

  // --- PROFILE SETTINGS ACTIONS ---
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProfileUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/media/upload", {
        method: "POST",
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        setProfileAvatarUrl(data.mediaUrl);
      } else {
        setErrorNotification("Failed to upload avatar image");
      }
    } catch (err) {
      console.error("Avatar upload error:", err);
      setErrorNotification("Avatar upload failed");
    } finally {
      setProfileUploading(false);
    }
  };

  const openSettings = async () => {
    setProfileName(currentUser.displayName || "");
    setProfileUsername(currentUser.username || "");
    setProfileEmail(currentUser.email || "");
    setProfileAvatarUrl(currentUser.avatarUrl || "");
    setProfilePassword("");
    setProfileConfirmPassword("");
    setIsSettingsOpen(true);
    // Fetch latest profile data for bio/gender/dob
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setProfileBio(data.user?.bio || "");
        setProfileGender(data.user?.gender || "");
        setProfileDob(data.user?.dateOfBirth || "");
      }
    } catch { /* use defaults */ }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (profilePassword && profilePassword !== profileConfirmPassword) {
      setErrorNotification("Passwords do not match");
      return;
    }

    setProfileSaveLoading(true);

    try {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: profileUsername,
          displayName: profileName,
          email: profileEmail,
          avatarUrl: profileAvatarUrl,
          password: profilePassword || undefined,
          bio: profileBio,
          gender: profileGender,
          dateOfBirth: profileDob
        })
      });

      if (res.ok) {
        const data = await res.json();
        onUserUpdate({
          id: currentUser.id,
          username: data.user.username,
          avatarUrl: data.user.avatarUrl,
          status: currentUser.status,
          displayName: data.user.displayName,
          email: data.user.email
        });
        setIsSettingsOpen(false);
        setProfilePassword("");
        setProfileConfirmPassword("");
      } else {
        const errorData = await res.json();
        setErrorNotification(errorData.error || "Failed to save profile");
      }
    } catch (err) {
      console.error("Save profile error:", err);
      setErrorNotification("Error saving profile");
    } finally {
      setProfileSaveLoading(false);
    }
  };

  const handlePresenceReceived = useCallback((pres: { userId: string; username: string; status: string; lastSeen: string }) => {
    setPresenceMap((prev) => ({
      ...prev,
      [pres.userId]: { status: pres.status, lastSeen: pres.lastSeen },
    }));
  }, []);

  const { connectionStatus } = useChatSync({
    onMessageReceived: handleMessageReceived,
    onPresenceReceived: handlePresenceReceived,
    onCallSignalReceived: (sig) => handleCallSignalReceived(sig),
    onMessageUpdate: handleMessageUpdate,
    onTyping: handleTyping,
  });

  // Send Main Message Handler
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    // If we're editing an existing message, submit the edit instead of sending.
    if (editingMessage) {
      await submitEditMessage(editingMessage.id, inputText);
      return;
    }

    if ((!inputText.trim() && !attachedFile) || !activeChat) return;

    const body: Record<string, unknown> = {
      chatId: activeChat.id,
      clientMsgId: crypto.randomUUID(), // Idempotency
      threadId: null,
    };

    if (inputText.trim()) body.text = inputText.trim();
    if (attachedFile) {
      body.mediaUrl = attachedFile.url;
      body.mediaType = attachedFile.type;
      body.mediaName = attachedFile.name;
      body.mediaSize = attachedFile.size;
    }
    if (replyingTo) {
      body.replyTo = {
        messageId: replyingTo.id,
        quote: (replyingTo.text || "").slice(0, 120) || (replyingTo.mediaType ? "📎 Attachment" : ""),
      };
    }

    setInputText("");
    setAttachedFile(null);
    setReplyingTo(null);

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        
        // Append locally
        setMessages((prev) => [...prev, data.message]);
        playMessageSent();

        // Update active chat's last message snippet locally
        setChats((prevChats) =>
          prevChats.map((c) =>
            c.id === activeChat.id
              ? {
                  ...c,
                  lastMessage: {
                    id: data.message.id,
                    seq: data.message.seq,
                    text: data.message.text,
                    mediaType: data.message.mediaType,
                    senderUsername: data.message.senderUsername,
                    createdAt: data.message.createdAt,
                    readBy: data.message.readBy,
                  },
                }
              : c
          )
        );
      }
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  };

  // Send Thread Message Handler
  const handleSendThreadMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!threadInputText.trim() && !threadAttachedFile) || !activeChat || !activeThreadParent) return;

    const body: Record<string, unknown> = {
      chatId: activeChat.id,
      clientMsgId: crypto.randomUUID(),
      threadId: activeThreadParent.id,
    };

    if (threadInputText.trim()) body.text = threadInputText.trim();
    if (threadAttachedFile) {
      body.mediaUrl = threadAttachedFile.url;
      body.mediaType = threadAttachedFile.type;
      body.mediaName = threadAttachedFile.name;
      body.mediaSize = threadAttachedFile.size;
    }

    setThreadInputText("");
    setThreadAttachedFile(null);

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        setThreadReplies((prev) => [...prev, data.message]);
        setMessages((prev) =>
          prev.map((p) => (p.id === activeThreadParent.id ? { ...p, threadCount: (p.threadCount || 0) + 1 } : p))
        );
        playMessageSent();
      }
    } catch (err) {
      console.error("Failed to send thread reply:", err);
    }
  };

  // Discover public groups
  const loadDiscoverGroups = useCallback(async (q: string) => {
    setDiscoverLoading(true);
    try {
      const res = await fetch(`/api/chats/discover${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        setDiscoverGroups(data.groups ?? []);
      }
    } finally {
      setDiscoverLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isNewChatModalOpen || newChatType !== "discover") return;
    const t = setTimeout(() => loadDiscoverGroups(discoverQuery), discoverQuery ? 250 : 0);
    return () => clearTimeout(t);
  }, [isNewChatModalOpen, newChatType, discoverQuery, loadDiscoverGroups]);

  const handleJoinPublicGroup = async (groupId: string) => {
    setJoiningGroupId(groupId);
    setModalError("");
    try {
      const res = await fetch("/api/chats/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: groupId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not join group");
      const list = await fetch("/api/chats");
      if (list.ok) {
        const ld = await list.json();
        setChats(ld.chats);
        const target = ld.chats.find((c: Chat) => c.id === groupId);
        if (target) selectChat(target);
      }
      setIsNewChatModalOpen(false);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Could not join group");
    } finally {
      setJoiningGroupId(null);
    }
  };

  // Start New Chat / Group Handler
  const handleCreateChat = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalLoading(true);
    setModalError("");

    const body: Record<string, unknown> = { type: newChatType };

    if (newChatType === "dm") {
      if (!recipientUsername) {
        setModalError("Username is required");
        setModalLoading(false);
        return;
      }
      body.recipientUsername = recipientUsername;
    } else {
      if (!groupName) {
        setModalError("Group name is required");
        setModalLoading(false);
        return;
      }
      body.name = groupName;
      body.visibility = groupVisibility;
      if (groupParticipants.trim()) {
        body.participantUsernames = groupParticipants
          .split(",")
          .map((u) => u.trim())
          .filter(Boolean);
      }
    }

    try {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create chat");
      }

      setChats((prev) => {
        if (prev.some((c) => c.id === data.chat.id)) return prev;
        return [data.chat, ...prev];
      });

      selectChat(data.chat);
      setIsNewChatModalOpen(false);
      setRecipientUsername("");
      setGroupName("");
      setGroupParticipants("");
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setModalLoading(false);
    }
  };

  /**
   * A chat attachment and a post attachment are the same thing to the reader,
   * so they share one renderer. Messages only carry url/name/size, so the kind
   * is derived from the filename exactly as it is at upload time.
   */
  const messageMedia = (m: Message): PostMedia | null => {
    if (!m.mediaUrl) return null;
    const name = m.mediaName || m.mediaUrl.split("/").pop()?.split("?")[0] || "attachment";
    return {
      url: m.mediaUrl,
      type: classifyFile(name, ""),
      name,
      size: m.mediaSize ?? 0,
      mime: "",
      originalUrl: m.mediaOriginalUrl,
      thumbUrl: m.mediaThumbUrl,
      sensitive: m.mediaSensitive,
    };
  };

  // Fetch AI Summary
  const loadAiSummary = async () => {
    if (!activeChat) return;
    setIsAiSummaryOpen(true);
    setActiveThreadParent(null); // Close thread panel if summary is opened
    setChatUrl(activeChat.id);
    setAiSummaryLoading(true);
    setAiSummaryText("");
    setAiActionItems([]);

    try {
      const res = await fetch(`/api/chats/summarize?chatId=${activeChat.id}`);
      if (res.ok) {
        const data = await res.json();
        setAiSummaryText(data.summary);
        setAiActionItems(data.actionItems);
        // Reset checkbox map
        setAiCheckedItems({});
      }
    } catch (err) {
      console.error("AI Summary load failed:", err);
      setAiSummaryText("Failed to retrieve conversation summary.");
    } finally {
      setAiSummaryLoading(false);
    }
  };

  // Helper file upload execution
  const executeUpload = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/media/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Upload failed");
    }

    let detectedType: "image" | "video" | "file" = "file";
    if (file.type.startsWith("image/")) detectedType = "image";
    else if (file.type.startsWith("video/")) detectedType = "video";

    return { url: data.mediaUrl, type: detectedType, name: file.name, size: file.size };
  };

  // File Upload Handlers
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingFile(true);
    try {
      const uploadResult = await executeUpload(file);
      setAttachedFile(uploadResult);
    } catch (err) {
      setErrorNotification(err instanceof Error ? err.message : "File upload failed.");
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleThreadFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setThreadUploadingFile(true);
    try {
      const uploadResult = await executeUpload(file);
      setThreadAttachedFile(uploadResult);
    } catch (err) {
      setErrorNotification(err instanceof Error ? err.message : "File upload failed.");
    } finally {
      setThreadUploadingFile(false);
      if (threadFileInputRef.current) threadFileInputRef.current.value = "";
    }
  };

  // Helper presence formatter
  const renderPresenceText = (chat: Chat) => {
    if (chat.type === "group" || chat.type === "channel") return `${chat.memberCount} members`;
    
    const recipientId = chat.participants.find((id) => id !== currentUser.id);
    const presence = recipientId ? presenceMap[recipientId] : null;

    const status = presence ? presence.status : chat.otherUserStatus;
    const lastSeen = presence ? presence.lastSeen : chat.otherUserLastSeen;

    if (status === "online") {
      return <span className="online-text">online</span>;
    }

    if (lastSeen) {
      const date = new Date(lastSeen);
      return `last seen ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }

    return "offline";
  };

  // Leaving the current scope (switching workspace / back to Personal) must
  // also close any open conversation from the previous scope. This is the
  // "adjust state when a prop changes" pattern — done during render rather
  // than in an effect so there is no flash of the stale conversation.
  const [scopeKey, setScopeKey] = useState<string | null>(workspace?.id ?? null);
  if ((workspace?.id ?? null) !== scopeKey) {
    setScopeKey(workspace?.id ?? null);
    if (activeChat) {
      const inScope = workspace
        ? activeChat.workspaceId === workspace.id
        : !activeChat.workspaceId;
      if (!inScope) setActiveChat(null);
    }
    if (isChannelModalOpen) setIsChannelModalOpen(false);
    if (isNewChatModalOpen) setIsNewChatModalOpen(false);
  }

  // Scope the list to the active container: Personal shows only chats without
  // a workspace; a workspace shows only its own channels. The two worlds
  // never mix — a personal chat can never appear inside a workspace or
  // vice versa.
  const scopedChats = chats.filter((c) =>
    workspace ? c.workspaceId === workspace.id : !c.workspaceId
  );

  // Search Filter
  const filteredChats = scopedChats.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`app-container ${activeChat ? "mobile-chat-open" : "mobile-list-open"}`}>
      <style jsx>{`
        /* ========== SIDEBAR ========== */
        .sidebar {
          width: var(--sidebar-width);
          min-width: var(--sidebar-width);
          height: 100%;
          border-right: 1px solid var(--layer-2);
          display: flex;
          flex-direction: column;
          background-color: var(--bg-sidebar);
          position: relative;
          z-index: 10;
          padding: 16px 0;
        }

        .sidebar-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 4px 20px 20px;
          font-size: 20px;
          font-weight: 800;
          color: var(--accent);
          letter-spacing: -0.3px;
        }

        .sidebar-footer {
          margin-top: auto;
          padding: 10px 14px;
          border-top: 1px solid var(--layer-2);
        }

        .sidebar-footer .profile-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .sidebar-resize-handle {
          width: 4px;
          cursor: col-resize;
          background: transparent;
          transition: background 150ms;
          flex-shrink: 0;
          position: relative;
        }

        .sidebar-resize-handle:hover,
        .sidebar-resize-handle:active {
          background: var(--accent-ring);
        }

        .sidebar-header {
          padding: 0 14px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .sidebar-scope-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 16px 14px 12px;
        }

        .sidebar-scope-name {
          font-size: 15px;
          font-weight: 800;
          letter-spacing: -0.2px;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .workspace-info-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 8px;
          color: var(--text-muted);
          background: transparent;
          border: 1px solid transparent;
          cursor: pointer;
          flex-shrink: 0;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }

        .workspace-info-btn:hover {
          color: var(--accent);
          background: var(--accent-muted);
          border-color: var(--accent-ring);
        }

        .user-profile {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .user-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: none;
          background-color: var(--layer-2);
          object-fit: cover;
          flex-shrink: 0;
        }

        .username {
          font-weight: 400;
          font-size: 11px;
          letter-spacing: 0;
          color: var(--text-muted);
        }

        /* Logout: ghost icon */
        .logout-btn {
          width: 30px;
          height: 30px;
          padding: 0;
          gap: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          color: var(--text-muted);
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: color 150ms, background 150ms;
        }

        .logout-btn svg { width: 15px; height: 15px; }

        .logout-btn:hover {
          color: var(--danger);
          background: var(--danger-soft);
        }

        .logout-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--bg-sidebar), 0 0 0 4px var(--accent-ring);
        }

        .search-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .search-bar {
          flex: 1;
          background: var(--layer-1);
          border: 1px solid transparent;
          border-radius: 24px;
          padding: 10px 14px;
          color: var(--text-primary);
          font-size: 13px;
          font-family: var(--font-chat);
          transition: border-color 150ms, box-shadow 150ms;
        }

        .search-bar::placeholder { color: var(--text-muted); }
        .search-bar:hover { border-color: var(--layer-3); }

        .search-bar:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-muted);
        }

        /* New chat button: pill accent */
        .new-chat-btn {
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          background: linear-gradient(135deg, var(--accent), var(--accent-hover));
          border: none;
          border-radius: 50%;
          color: var(--text-on-accent);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 16px var(--accent-muted);
          transition: background 150ms, transform 150ms;
        }

        .new-chat-btn svg { stroke: var(--text-on-accent); }

        .new-chat-btn:hover { transform: scale(1.05); }
        .new-chat-btn:active { transform: scale(0.98); }

        .new-chat-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--bg-sidebar), 0 0 0 4px var(--accent-ring);
        }

        .chat-list {
          flex: 1;
          overflow-y: auto;
          padding: 4px 0;
        }

        .chat-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px;
          cursor: pointer;
          transition: background 120ms;
          position: relative;
          border-bottom: 1px solid var(--layer-1);
        }

        .chat-item:hover {
          background: var(--layer-1);
        }

        .chat-item.active {
          background: var(--accent-muted);
        }

        .chat-item.active .chat-item-name { color: var(--text-primary); }

        .chat-avatar-container {
          position: relative;
        }

        .chat-item-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: var(--layer-2);
          border: none;
          object-fit: cover;
          flex-shrink: 0;
        }

        .online-dot {
          width: 11px;
          height: 11px;
          background-color: var(--color-online);
          border: 2px solid var(--bg-app);
          border-radius: 50%;
          position: absolute;
          bottom: 1px;
          right: 1px;
        }

        .chat-item.active .online-dot { border-color: var(--bg-app); }

        .chat-item-details {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 3px;
          overflow: hidden;
          min-width: 0;
        }

        .chat-item-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .chat-item-name {
          font-weight: 600;
          font-size: 14px;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .chat-item-time {
          font-size: 11px;
          color: var(--text-muted);
          flex-shrink: 0;
          margin-left: 8px;
        }

        .chat-item-snippet {
          font-size: 13px;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 180px;
        }

        .unread-badge {
          background: var(--accent);
          color: var(--text-on-accent);
          font-size: 10px;
          font-weight: 700;
          border-radius: 10px;
          min-width: 16px;
          height: 16px;
          padding: 1px 6px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          line-height: 16px;
        }

        .empty-chats {
          text-align: center;
          padding: 40px 20px;
          color: var(--text-muted);
          font-size: 13px;
        }

        /* ========== WORKSPACE LAYOUT ========== */
        .workspace-content {
          display: flex;
          flex: 1;
          height: 100%;
          overflow: hidden;
          position: relative; /* anchors the mobile .right-panel overlay */
        }

        .chat-window {
          flex: 1;
          height: 100%;
          background-color: var(--bg-app);
          display: flex;
          flex-direction: column;
          position: relative;
        }

        .chat-window-placeholder {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          text-align: center;
          padding: 40px;
        }

        .placeholder-shield {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: var(--layer-1);
          border: 1px solid var(--layer-2);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
        }

        .placeholder-shield svg {
          width: 40px;
          height: 40px;
          fill: var(--text-muted);
        }

        /* ========== CHAT HEADER ========== */
        .chat-header {
          padding: 12px 16px;
          border-bottom: 1px solid var(--layer-2);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--bg-header);
          backdrop-filter: blur(12px);
          z-index: 10;
        }

        .chat-header-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .chat-header-meta {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .chat-header-title {
          font-weight: 600;
          font-size: 15px;
          color: var(--text-primary);
        }

        .chat-header-subtitle {
          font-size: 11px;
          color: var(--text-muted);
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .ai-summary-btn {
          background: var(--accent-muted);
          border: 1px solid var(--accent-muted);
          color: var(--accent);
          border-radius: 20px;
          padding: 6px 14px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 150ms;
        }

        .ai-summary-btn:hover {
          background: var(--accent-muted);
          border-color: var(--accent);
        }

        .connection-indicator {
          font-size: 11px;
          color: var(--text-muted);
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .status-pulse {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--accent);
        }
        .status-pulse.connected { background: var(--color-online); }
        .status-pulse.connecting { background: var(--warning); animation: pulse 1s infinite; }
        .status-pulse.disconnected { background: var(--danger); }

        /* ========== MESSAGES FEED ========== */
        .message-feed {
          flex: 1;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .message-row {
          display: flex;
          width: 100%;
          margin-bottom: 2px;
          position: relative;
          overflow: visible;
        }

        .message-row.incoming {
          justify-content: flex-start;
        }

        .message-row.outgoing {
          justify-content: flex-end;
        }

        .message-bubble-wrapper {
          position: relative;
          max-width: 70%;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .message-bubble {
          padding: 10px 16px 8px 16px;
          border-radius: 18px;
          font-size: 14px;
          line-height: 1.5;
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 4px;
          animation: slideUp 0.16s ease-out forwards;
          width: 100%;
          min-width: 0;
          overflow-wrap: break-word;
          word-break: break-word;
        }

        .message-row.incoming .message-bubble {
          background: var(--layer-2);
          border-radius: 18px 18px 18px 4px;
          color: var(--text-primary);
        }

        .message-row.incoming .message-bubble:hover { background: var(--layer-3); }

        .message-row.outgoing .message-bubble {
          background: linear-gradient(135deg, var(--accent), var(--accent-hover));
          border-radius: 18px 18px 4px 18px;
          color: var(--text-on-accent);
        }

        .message-row.outgoing .message-bubble:hover { opacity: 0.95; }

        /* Respect reduced-motion preferences */
        @media (prefers-reduced-motion: reduce) {
          .message-bubble { animation: none; }
          .settings-gear-btn, .logout-btn, .search-bar, .new-chat-btn, .chat-item { transition: none; }
        }

        /* Thread Reply trigger overlay on message hover */
        .msg-hover-actions {
          position: absolute;
          top: -28px;
          background: var(--bg-elevated);
          border: 1px solid var(--layer-3);
          border-radius: 8px;
          padding: 2px 4px;
          display: none;
          gap: 0;
          z-index: 5;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
          white-space: nowrap;
        }

        .message-row.incoming .msg-hover-actions {
          right: auto;
          left: 0;
        }

        .message-row.outgoing .msg-hover-actions {
          left: auto;
          right: 0;
        }

        .message-row:hover .msg-hover-actions {
          display: flex;
        }

        .msg-action-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          width: 26px;
          height: 26px;
          border-radius: 6px;
          transition: all 120ms;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .msg-action-btn:hover {
          color: var(--text-primary);
          background: var(--layer-3);
        }

        .message-meta-info {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 4px;
          font-size: 11px;
          color: var(--text-secondary);
          margin-top: 2px;
          align-self: flex-end;
        }

        /* Inside the accent bubble everything must stay white-based in both themes. */
        .message-row.outgoing .message-meta-info {
          color: rgba(255, 255, 255, 0.78);
        }
        .message-row.outgoing .checkmark-svg {
          stroke: rgba(255, 255, 255, 0.9);
        }
        .message-row.outgoing .message-bubble a {
          color: #fff;
          text-decoration: underline;
        }
        .message-row.outgoing .reply-quote-text,
        .message-row.outgoing .forwarded-label {
          color: rgba(255, 255, 255, 0.82);
        }
        .message-row.outgoing .reply-quote-bar {
          background: rgba(255, 255, 255, 0.7);
        }

        .message-row.incoming .message-meta-info {
          color: var(--text-muted);
        }

        .sender-name {
          font-size: 12px;
          font-weight: 700;
          color: var(--accent);
          margin-bottom: 2px;
        }

        /* ========== COMPOSER ========== */
        .chat-input-bar {
          padding: 12px 16px;
          background: var(--bg-header);
          backdrop-filter: blur(12px);
          border-top: 1px solid var(--layer-2);
          z-index: 10;
        }

        .input-bar-form {
          display: flex;
          gap: 8px;
          align-items: center;
          position: relative;
        }

        .input-text-area {
          flex: 1;
          background: var(--layer-1);
          border: 1px solid var(--layer-3);
          border-radius: 24px;
          padding: 10px 16px;
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          transition: border-color 150ms;
        }

        .input-text-area:focus {
          border-color: var(--accent);
          outline: none;
        }

        .attach-btn, .send-btn {
          width: 40px;
          height: 40px;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 150ms;
          flex-shrink: 0;
        }

        .attach-btn {
          background: transparent;
          border-radius: 50%;
          color: var(--text-muted);
        }

        .attach-btn:hover {
          background: var(--layer-2);
          color: var(--text-primary);
        }

        .send-btn {
          background: var(--accent);
          border-radius: 50%;
          color: var(--text-on-accent);
        }

        .send-btn:hover {
          transform: scale(1.05);
        }

        .send-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          transform: none;
        }

        /* Attachment preview bar */
        .attachment-preview {
          background: var(--layer-1);
          border: 1px solid var(--layer-2);
          border-radius: 12px;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
          font-size: 13px;
        }

        .file-info {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .remove-attach-btn {
          background: transparent;
          border: none;
          color: var(--danger);
          cursor: pointer;
          font-weight: 600;
        }

        /* ========== RIGHT SIDE PANELS ========== */
        .right-panel {
          width: 360px;
          height: 100%;
          border-left: 1px solid var(--layer-2);
          background-color: var(--bg-app);
          display: flex;
          flex-direction: column;
          animation: slideLeft 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          z-index: 15;
          position: relative;
        }

        @keyframes slideLeft {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }

        .panel-header {
          padding: 14px 16px;
          border-bottom: 1px solid var(--layer-2);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .panel-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .panel-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 8px;
          display: flex;
          align-items: center;
        }

        .panel-close-btn:hover {
          color: var(--text-primary);
        }

        /* Thread Panel Content */
        .thread-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .thread-parent-section {
          padding-bottom: 16px;
          border-bottom: 1px solid var(--layer-2);
        }

        .thread-parent-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }

        .thread-parent-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
        }

        .thread-parent-username {
          font-size: 13px;
          font-weight: 700;
          color: var(--accent);
        }

        .thread-parent-time {
          font-size: 11px;
          color: var(--text-muted);
        }

        .thread-parent-body {
          font-size: 14px;
          color: var(--text-primary);
          line-height: 1.4;
          word-break: break-word;
          padding-left: 38px;
        }

        .thread-replies-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .thread-reply-row {
          display: flex;
          gap: 10px;
        }

        .thread-reply-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          margin-top: 2px;
        }

        .thread-reply-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 3px;
          background: var(--layer-2);
          padding: 8px 12px;
          border-radius: 12px;
          border-top-left-radius: 2px;
        }

        .thread-reply-username {
          font-size: 12px;
          font-weight: 700;
          color: var(--accent-strong);
        }

        .thread-reply-body {
          font-size: 13.5px;
          color: var(--text-primary);
          word-break: break-word;
          line-height: 1.4;
        }

        .thread-reply-time {
          font-size: 10px;
          color: var(--text-muted);
          align-self: flex-end;
          margin-top: 2px;
        }

        /* AI Summary panel content */
        .summary-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .summary-card {
          background: var(--accent-muted);
          border: 1px solid var(--accent-muted);
          border-radius: 16px;
          padding: 16px;
          font-size: 14px;
          line-height: 1.5;
          color: var(--text-primary);
          white-space: pre-wrap;
        }

        .action-items-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .action-item-card {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          background: var(--layer-1);
          border: 1px solid var(--layer-2);
          border-radius: 12px;
          padding: 12px;
          font-size: 13px;
          transition: all 150ms;
        }

        .action-item-card.completed {
          opacity: 0.65;
          border-color: var(--accent-muted);
        }

        .action-item-checkbox {
          width: 18px;
          height: 18px;
          margin-top: 1px;
          accent-color: var(--accent);
          cursor: pointer;
        }

        .action-item-text {
          flex: 1;
          color: var(--text-primary);
          line-height: 1.4;
        }

        .action-item-card.completed .action-item-text {
          text-decoration: line-through;
          color: var(--text-muted);
        }

        .date-separator {
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 16px 0;
          position: relative;
          width: 100%;
        }

        .date-separator::before {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          height: 1px;
          background-color: var(--layer-2);
          z-index: 1;
        }

        .date-separator span {
          background-color: var(--bg-app);
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          z-index: 2;
          border: 1px solid var(--layer-2);
        }

        /* Empty State Layout */
        .empty-messages-container {
          margin: auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          color: var(--text-muted);
          text-align: center;
          padding: 40px 20px;
          max-width: 320px;
          background: var(--layer-1);
          border: 1px solid var(--layer-2);
          border-radius: 16px;
        }

        .empty-messages-icon {
          font-size: 44px;
          animation: wave 2.5s infinite ease-in-out;
        }

        .empty-messages-container h4 {
          font-weight: 700;
          font-size: 16px;
          color: var(--text-primary);
        }

        .empty-messages-container p {
          font-size: 13px;
          color: var(--text-muted);
          line-height: 1.45;
        }

        @keyframes wave {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(15deg); }
        }

        /* Online Status */
        .online-text {
          color: var(--color-online);
          font-weight: 600;
        }

        /* Error Toast Notification */
        .error-toast {
          position: fixed;
          top: 24px;
          right: 24px;
          background: var(--danger-soft);
          backdrop-filter: blur(8px);
          color: white;
          padding: 12px 20px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          z-index: 2000;
          box-shadow: 0 12px 32px rgba(0,0,0,0.5);
          font-size: 14px;
          animation: toastSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          font-weight: 500;
        }

        .toast-icon {
          font-size: 16px;
        }

        .toast-text {
          flex: 1;
        }

        .toast-close {
          background: none;
          border: none;
          color: white;
          font-size: 18px;
          cursor: pointer;
          opacity: 0.8;
          padding: 0 4px;
        }

        .toast-close:hover {
          opacity: 1;
        }

        @keyframes toastSlideIn {
          from {
            transform: translateY(-20px) scale(0.95);
            opacity: 0;
          }
          to {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }

        /* ========== MODALS ========== */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          height: 100dvh; /* 100vh overshoots the visible viewport on phones */
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          backdrop-filter: blur(4px);
        }

        .modal-content {
          width: 100%;
          max-width: 420px;
          /* Tall modals (Group Info etc.) must scroll inside themselves —
             centered flex clips BOTH edges when content exceeds the screen. */
          max-height: calc(100dvh - 32px);
          overflow-y: auto;
          padding: 24px;
          border-radius: 16px;
          background: var(--bg-elevated);
          border: 1px solid var(--layer-3);
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
          animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .modal-title {
          font-size: 18px;
          font-weight: 700;
          margin-bottom: 16px;
          color: var(--text-primary);
        }

        .modal-tabs {
          display: flex;
          gap: 0;
          margin-bottom: 16px;
          border-bottom: 1px solid var(--layer-2);
        }

        .modal-tab {
          background: none;
          border: none;
          color: var(--text-muted);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          padding: 10px 16px;
          position: relative;
          transition: color 150ms;
        }

        .modal-tab.active {
          color: var(--text-primary);
          font-weight: 600;
        }

        .modal-tab.active::after {
          content: "";
          position: absolute;
          bottom: -1px;
          left: 0;
          width: 100%;
          height: 2px;
          background-color: var(--accent);
        }

        .modal-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        /* User autocomplete dropdown */
        .user-suggestions-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          margin-top: 4px;
          background: var(--bg-elevated);
          border: 1px solid var(--layer-3);
          border-radius: 12px;
          padding: 4px;
          z-index: 20;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
          max-height: 200px;
          overflow-y: auto;
        }

        .suggestion-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 8px 10px;
          border: none;
          background: transparent;
          color: var(--text-primary);
          border-radius: 8px;
          cursor: pointer;
          text-align: left;
          transition: background 100ms;
        }

        .suggestion-item:hover {
          background: var(--accent-muted);
        }

        .suggestion-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }

        .suggestion-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .suggestion-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .suggestion-username {
          font-size: 11px;
          color: var(--text-muted);
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 8px;
        }

        .btn-cancel, .btn-submit {
          padding: 8px 20px;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 150ms;
        }

        .btn-cancel {
          background: transparent;
          color: var(--text-primary);
          border: 1px solid var(--layer-4);
        }

        .btn-cancel:hover {
          background: var(--layer-2);
        }

        .btn-submit {
          background: var(--accent);
          color: var(--text-on-accent);
          border: none;
        }

        .btn-submit:hover {
          background: var(--accent-hover);
        }

        /* Message Media attachment styling */
        .message-media-container {
          margin-bottom: 4px;
          border-radius: 8px;
          overflow: hidden;
          background: rgba(0, 0, 0, 0.15);
          max-width: 100%;
        }

        /* Attachments render with the same preview cards as the feed. Inside an
           accent-coloured outgoing bubble those cards would sit on a translucent
           layer over blue, so the surface tokens are re-pointed at the opaque app
           background here; the card inherits them through the cascade. */
        .chat-attachment {
          --bg-surface: var(--bg-app);
          --bg-surface-hover: var(--layer-1);
          --bg-elevated: var(--bg-app);
          background: transparent;
          width: min(420px, 100%);
          margin-bottom: 6px;
          border-radius: 16px;
          overflow: visible;
        }

        .message-image {
          max-width: 100%;
          max-height: 280px;
          object-fit: cover;
          display: block;
          cursor: pointer;
        }

        .message-video {
          max-width: 100%;
          max-height: 280px;
          display: block;
        }

        .message-file-link {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          background: var(--layer-2);
          border-radius: 8px;
          color: white;
          text-decoration: none;
          font-size: 14px;
        }

        .message-file-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--accent-muted);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .message-file-icon svg {
          width: 16px;
          height: 16px;
          fill: var(--accent);
        }

        .message-file-details {
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .message-file-name {
          font-weight: 600;
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
        }

        .user-info-text {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }

        .user-info-text .display-name {
          font-weight: 600;
          font-size: 13px;
          color: var(--text-primary);
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
        }

        .user-info-text .username {
          font-size: 11px;
          color: var(--text-muted);
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
        }

        .settings-gear-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          border-radius: 8px;
          width: 30px;
          height: 30px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 150ms, background 150ms;
        }

        .settings-gear-btn:hover {
          background: var(--layer-2);
          color: var(--text-primary);
        }

        .settings-gear-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--bg-app), 0 0 0 4px var(--accent-ring);
        }

        .call-header-btn {
          background: transparent;
          border: 1px solid var(--layer-3);
          color: var(--text-secondary);
          border-radius: 50%;
          width: 34px;
          height: 34px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 150ms;
        }

        .call-header-btn:hover {
          background: var(--accent-muted);
          border-color: var(--accent-muted);
          color: var(--accent);
        }

        /* Call Overlay & Ringing styles */
        .call-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(10, 15, 30, 0.96);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          font-family: var(--font-chat);
          color: var(--text-on-accent);
          backdrop-filter: blur(16px);
        }

        .call-container {
          width: 90%;
          max-width: 1200px;
          height: 80%;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .call-header-pane {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 0;
          border-bottom: 1px solid var(--layer-3);
        }

        .call-title {
          font-size: 20px;
          font-weight: 700;
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .streams-grid {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 16px;
          overflow-y: auto;
          align-content: center;
          justify-content: center;
        }

        .video-wrapper {
          position: relative;
          width: 100%;
          aspect-ratio: 16/9;
          background: #1e293b;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          border: 1px solid var(--layer-2);
        }

        .video-wrapper video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .video-label {
          position: absolute;
          bottom: 10px;
          left: 10px;
          background: rgba(15, 23, 42, 0.75);
          color: var(--text-on-accent);
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          backdrop-filter: blur(4px);
        }

        .avatar-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at center, #1e293b 0%, #0f172a 100%);
          gap: 12px;
        }

        .avatar-placeholder img {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          border: 3px solid var(--accent);
          box-shadow: 0 0 15px var(--accent-muted);
        }

        .avatar-placeholder span {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-muted);
        }

        .video-stalled {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          text-align: center;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-on-accent);
          background: rgba(15, 23, 42, 0.65);
          backdrop-filter: blur(2px);
        }

        .call-controls {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 16px;
          padding: 20px 0;
        }

        .mobile-back-btn {
          display: none;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          margin-right: 4px;
          border: none;
          border-radius: 10px;
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          flex-shrink: 0;
        }

        /* Phones show ONE pane: the chat list, or the open conversation.
           !important because the sidebar's width is set inline for the
           desktop drag-resize. */
        @media (max-width: 768px) {
          .mobile-chat-open .sidebar { display: none; }
          .mobile-list-open .sidebar {
            width: 100% !important;
            min-width: 100% !important;
          }
          .mobile-list-open .workspace-content { display: none; }
          .sidebar-resize-handle { display: none; }
          .mobile-back-btn { display: flex; }
          /* Compact one-row header: the title truncates instead of wrapping
             into a tall stack, buttons shrink, the syncing label goes. */
          .chat-header { padding: 8px 10px 8px 4px; gap: 6px; }
          .chat-header-info { flex: 1; min-width: 0; gap: 8px; }
          .chat-header-info img { width: 34px !important; height: 34px !important; }
          .chat-header-meta { min-width: 0; }
          .chat-header-title {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            display: block;
          }
          .chat-header-subtitle {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            display: block;
          }
          .header-actions { gap: 5px; flex-shrink: 0; }
          .call-header-btn { width: 30px; height: 30px; }
          /* Tapping the header already opens group info — drop the extra button */
          .header-actions .call-header-btn[title="Group Info"] { display: none; }
          .connection-indicator span { display: none; }
          /* Thread/AI panel: a fixed 360px sibling squeezed the chat and
             itself into slivers on a 375px screen — overlay it instead. */
          .right-panel {
            position: absolute;
            inset: 0;
            width: 100% !important;
            border-left: none;
          }
          /* 14 reaction buttons don't fit a phone row — let them wrap. */
        }

        /* Phones: full-bleed, stacked tiles, thumb-sized controls. */
        @media (max-width: 640px) {
          .call-container {
            width: 100%;
            height: 100%;
            padding: 10px 12px 0;
            gap: 10px;
          }
          .streams-grid {
            grid-template-columns: 1fr;
            align-content: start;
            gap: 10px;
          }
          .video-wrapper { aspect-ratio: 4 / 3; }
          .call-header-pane { flex-wrap: wrap; gap: 8px; }
          .call-title { font-size: 16px; }
          .call-controls {
            gap: 14px;
            padding: 12px 0 calc(14px + env(safe-area-inset-bottom));
          }
          .control-btn { width: 54px; height: 54px; }
        }

        .control-btn {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          border: none;
          background: var(--layer-3);
          color: var(--text-on-accent);
          font-size: 20px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .control-btn:hover {
          background: var(--layer-4);
          transform: scale(1.05);
        }

        .control-btn.active {
          background: var(--accent);
          color: #000;
        }

        .control-btn.danger {
          background: var(--danger);
        }

        .control-btn.danger:hover {
          background: var(--danger);
        }

        /* Incoming call modal */
        .incoming-call-modal {
          position: fixed;
          top: 30px;
          right: 30px;
          background: var(--bg-elevated);
          border: 1px solid var(--layer-3);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 16px;
          z-index: 10000;
          backdrop-filter: blur(10px);
          animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }

        .incoming-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .incoming-title {
          font-weight: 700;
          font-size: 15px;
          color: var(--text-primary);
        }

        .incoming-subtitle {
          font-size: 13px;
          color: var(--text-secondary);
        }

        .incoming-actions {
          display: flex;
          gap: 8px;
        }

        .incoming-btn {
          padding: 8px 12px;
          border-radius: 8px;
          border: none;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .incoming-btn.accept {
          background: var(--accent);
          color: #000;
        }

        .incoming-btn.decline {
          background: var(--danger);
          color: var(--text-on-accent);
        }

        .avatar-edit-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          margin-bottom: 20px;
        }

        .avatar-preview-wrapper {
          position: relative;
          width: 90px;
          height: 90px;
          border-radius: 50%;
          overflow: hidden;
          border: 3px solid var(--accent);
        }

        .avatar-preview-wrapper img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .avatar-upload-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.5);
          color: var(--text-on-accent);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.2s;
        }

        .avatar-preview-wrapper:hover .avatar-upload-overlay {
          opacity: 1;
        }

        .form-row-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .settings-section-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--accent);
          margin-bottom: 12px;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--accent-muted);
        }

        select.search-bar {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%236b7280' viewBox='0 0 16 16'%3E%3Cpath d='M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          padding-right: 32px;
        }

        select.search-bar option {
          background: var(--bg-elevated);
          color: var(--text-primary);
        }

        .message-file-size {
          font-size: 11px;
          color: var(--text-muted);
        }

        /* --- Message actions: reactions, reply, edit, pin, forward ---
           (display is hover-driven — see .message-row:hover rule above) --- */
        .msg-hover-actions {
          gap: 2px;
          background: var(--bg-elevated);
          border: 1px solid var(--layer-3);
          border-radius: 10px;
          padding: 3px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
        }
        .msg-action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border-radius: 7px;
          color: var(--text-secondary);
          background: transparent;
          border: none;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .msg-action-btn:hover { background: var(--layer-3); color: var(--text-primary); }
        .msg-action-btn.danger:hover { background: var(--danger-soft); color: var(--danger); }

        .role-toggle-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 9px;
          border-radius: 999px;
          border: 1px solid var(--border-color);
          background: var(--bg-surface);
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .visibility-toggle {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .visibility-option {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid var(--border-color);
          background: var(--bg-surface);
          color: var(--text-secondary);
          text-align: left;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s, color 0.15s;
        }
        .visibility-option svg { margin-top: 2px; flex-shrink: 0; }
        .visibility-option strong { display: block; font-size: 13px; color: var(--text-primary); }
        .visibility-option small { display: block; font-size: 11px; color: var(--text-muted); line-height: 1.3; }
        .visibility-option.active {
          border-color: var(--accent);
          background: var(--accent-muted);
          color: var(--accent);
        }
        .role-toggle-btn:hover {
          background: var(--accent-muted);
          color: var(--accent);
          border-color: var(--accent-ring);
        }

        .reaction-picker {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 2px;
          background: var(--bg-elevated);
          border: 1px solid var(--layer-3);
          border-radius: 24px;
          padding: 5px 7px;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
          z-index: 50;
        }
        /* Phones: the picker escapes its 26px anchor (which collapsed it to a
           one-per-row tower) and becomes a fixed centered grid. Placed AFTER
           the base rule — same specificity, so source order decides. */
        @media (max-width: 768px) {
          .reaction-picker {
            position: fixed;
            left: 50%;
            top: auto;
            bottom: calc(120px + env(safe-area-inset-bottom));
            transform: translateX(-50%);
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            width: min(340px, calc(100vw - 32px));
            gap: 4px;
            padding: 10px;
            border-radius: 20px;
          }
        }
        .reaction-pick-btn {
          font-size: 18px;
          line-height: 1;
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 4px;
          border-radius: 50%;
          transition: transform 0.12s, background 0.12s;
        }
        .reaction-pick-btn:hover { transform: scale(1.3); background: var(--layer-3); }

        .reactions-bar { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
        .delete-menu {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          z-index: 50;
          display: flex;
          flex-direction: column;
          min-width: 172px;
          overflow: hidden;
          border: 1px solid var(--border-color);
          border-radius: 12px;
          background: var(--bg-elevated);
          box-shadow: var(--shadow-lg);
        }
        .delete-menu button {
          padding: 10px 14px;
          border: none;
          background: transparent;
          text-align: left;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          cursor: pointer;
        }
        .delete-menu button:hover { background: var(--bg-surface-hover); }
        .delete-menu button.danger { color: var(--danger); }

        .waspmoji-preview {
          position: absolute;
          bottom: 100%;
          left: 12px;
          right: 12px;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border: 1px solid var(--border-color);
          border-radius: 12px;
          background: var(--bg-elevated);
          box-shadow: var(--shadow-lg);
          z-index: 40;
          overflow: hidden;
        }
        .waspmoji-preview-label {
          flex-shrink: 0;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .waspmoji-preview-body {
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          font-size: 14px;
          color: var(--text-primary);
        }

        .waspmoji-tray {
          position: absolute;
          bottom: 52px;
          left: 0;
          z-index: 50;
          width: 264px;
          padding: 10px;
          border: 1px solid var(--border-color);
          border-radius: 14px;
          background: var(--bg-elevated);
          box-shadow: var(--shadow-lg);
        }
        .waspmoji-tray-title {
          margin: 0 0 8px 4px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .waspmoji-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 4px;
        }
        .waspmoji-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 5px;
          border: none;
          border-radius: 10px;
          background: transparent;
          cursor: pointer;
          transition: background 0.15s;
        }
        .waspmoji-cell:hover { background: var(--layer-2); }
        .waspmoji-cell img { width: 26px; height: 26px; }

        .reaction-chip {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: 12px;
          padding: 2px 7px;
          border-radius: 11px;
          background: var(--layer-2);
          border: 1px solid transparent;
          color: var(--text-primary);
          cursor: pointer;
          transition: background 0.15s;
        }
        .reaction-chip:hover { background: var(--layer-4); }
        .reaction-chip.mine {
          background: var(--accent-muted);
          border-color: var(--accent-ring);
        }
        .reaction-count { font-size: 11px; font-weight: 600; opacity: 0.85; }

        .reply-quote {
          display: flex;
          align-items: stretch;
          gap: 7px;
          margin-bottom: 5px;
          padding: 3px 0;
          cursor: pointer;
          opacity: 0.85;
        }
        .reply-quote:hover { opacity: 1; }
        .reply-quote-bar { width: 3px; border-radius: 3px; background: var(--accent, var(--accent)); flex-shrink: 0; }
        .reply-quote-text {
          font-size: 12px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 240px;
          --sidebar-width: 280px;
        }

        .forwarded-label {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-style: italic;
          color: var(--text-muted);
          margin-bottom: 4px;
        }

        .deleted-message {
          font-style: italic;
          font-size: 13px;
        }

        /* "N replies" chip under messages that have a thread */
        .thread-count-link {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          align-self: flex-start;
          margin-top: 2px;
          padding: 3px 9px;
          border-radius: 100px;
          border: none;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          background: var(--accent-muted);
          color: var(--accent);
        }
        .message-row.outgoing .thread-count-link {
          background: rgba(255, 255, 255, 0.18);
          color: #fff;
        }

        /* Jumbo emoji-only messages: no bubble chrome, the emoji IS the message */
        .message-row .message-bubble.jumbo {
          background: none;
          border: none;
          padding: 2px 0;
          box-shadow: none;
        }
        .message-row .message-bubble.jumbo:hover { background: none; opacity: 1; }
        .message-bubble.jumbo .message-meta-info { color: var(--text-muted); }
        .message-row.outgoing .message-bubble.jumbo .checkmark-svg {
          stroke: var(--text-muted);
        }

        /* Deleted tombstone: a quiet ghost bubble in BOTH directions — the
           outgoing cobalt gradient made muted gray text unreadable on blue. */
        .message-row .message-bubble.deleted {
          background: transparent;
          border: 1px dashed var(--border-color);
          color: var(--text-muted);
        }
        .message-row.outgoing .message-bubble.deleted:hover { opacity: 1; }
        .message-row.incoming .message-bubble.deleted:hover { background: transparent; }
        .message-bubble.deleted .message-meta-info { color: var(--text-muted); opacity: 0.8; }

        .edited-tag { font-size: 11px; opacity: 0.8; font-style: italic; margin-right: 3px; }

        .message-bubble.pinned {
          box-shadow: inset 3px 0 0 var(--accent, var(--accent));
        }

        .compose-context {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 7px 12px;
          margin-bottom: 6px;
          background: var(--layer-2);
          border-left: 3px solid var(--accent, var(--accent));
          border-radius: 6px;
        }
        .compose-context-info { display: flex; align-items: center; gap: 8px; overflow: hidden; }
        .compose-context-title { font-size: 12px; font-weight: 600; color: var(--accent, var(--accent)); }
        .compose-context-text {
          font-size: 12px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 320px;
        }

        .pinned-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          background: var(--accent-muted);
          border-bottom: 1px solid var(--layer-2);
          font-size: 13px;
          cursor: pointer;
        }
        .pinned-banner:hover { background: var(--accent-muted); }
        .pinned-banner-text {
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .forward-target-list { display: flex; flex-direction: column; gap: 4px; max-height: 340px; overflow-y: auto; }
        .forward-target {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 12px;
          border-radius: 10px;
          cursor: pointer;
          background: transparent;
          border: none;
          color: var(--text-primary);
          text-align: left;
          width: 100%;
          transition: background 0.15s;
        }
        .forward-target:hover { background: var(--layer-2); }
        .forward-target img { width: 34px; height: 34px; border-radius: 50%; }

        .typing-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 18px 6px;
          font-size: 12px;
          color: var(--text-muted);
          font-style: italic;
        }
        .typing-dots { display: inline-flex; gap: 3px; }
        .typing-dots span {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--accent, var(--accent));
          animation: typingBounce 1.2s infinite ease-in-out;
        }
        .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>

      {errorNotification && (
        <div className="error-toast">
          <span className="toast-icon" style={{ display: "flex", alignItems: "center" }}><AlertTriangle className="w-4 h-4 text-amber-500" /></span>
          <span className="toast-text">{errorNotification}</span>
          <button className="toast-close" onClick={() => setErrorNotification(null)} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* 1. LEFT SIDEBAR */}
      <div className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
        <div className="sidebar-scope-header">
          <span className="sidebar-scope-name">{workspace ? workspace.name : "Personal"}</span>
          {workspace && (
            <button
              type="button"
              className="workspace-info-btn"
              title="Workspace info, members & settings"
              aria-label="Workspace info, members & settings"
              onClick={onOpenWorkspaceInfo}
            >
              <Info className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="sidebar-header">

          <div className="search-row">
            <input
              type="text"
              placeholder={workspace ? "Search channels..." : "Search chat or user..."}
              className="search-bar"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              onClick={() =>
                workspace ? setIsChannelModalOpen(true) : setIsNewChatModalOpen(true)
              }
              className="new-chat-btn"
              aria-label={workspace ? "Browse or create channels" : "Start a new conversation"}
              title={workspace ? "Browse or create channels" : "Start a new conversation"}
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="chat-list">
          {filteredChats.length > 0 ? (
            filteredChats.map((c) => {
              const isActive = activeChat && activeChat.id === c.id;
              
              // Presence calculations
              const recipientId = c.participants.find((id) => id !== currentUser.id);
              const livePresence = recipientId ? presenceMap[recipientId] : null;
              const isOnline = c.type === "dm" && (livePresence ? livePresence.status === "online" : c.otherUserStatus === "online");

              return (
                <div
                  key={c.id}
                  className={`chat-item ${isActive ? "active" : ""}`}
                  onClick={() => selectChat(c)}
                >
                  <div className="chat-avatar-container">
                    <img src={prettyAvatar(c.avatarUrl, c.name)} alt={c.name} className="chat-item-avatar" onError={(e) => handleAvatarError(e, c.name)} />
                    {isOnline && <div className="online-dot" />}
                  </div>
                  <div className="chat-item-details">
                    <div className="chat-item-row">
                      <span className="chat-item-name">
                        {c.type === "channel" && c.workspaceId ? `#${c.name}` : c.name}
                      </span>
                      <span className="chat-item-time">
                        {c.lastMessage
                          ? new Date(c.lastMessage.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </span>
                    </div>
                    <div className="chat-item-row">
                      <span className="chat-item-snippet">
                        {c.lastMessage
                          ? c.lastMessage.text || "📎 Attachment"
                          : "No messages yet"}
                      </span>
                      {c.unreadCount > 0 && (
                        <span className="unread-badge">{c.unreadCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="empty-chats">
              {searchQuery
                ? workspace ? "No matching channels." : "No matching chats found."
                : workspace
                  ? "No channels yet. Press + to browse or create one."
                  : "No chats yet. Press + to start a chat!"}
            </div>
          )}
        </div>

        {/* No footer actions here: Settings and Log out live in the avatar
            menu on the app rail — duplicating them was just clutter. */}
      </div>

      {/* Sidebar resize handle */}
      <div
        className="sidebar-resize-handle"
        onMouseDown={() => {
          isDraggingSidebar.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
      />

      {/* 2. MAIN ACTIVE WINDOW SPLIT */}
      <div className="workspace-content">
        <div className="chat-window">
          {activeChat ? (
            <>
              {/* Header */}
              <div className="chat-header">
                {/* Phones show one pane at a time; this is the way back to the list. */}
                <button
                  type="button"
                  className="mobile-back-btn"
                  aria-label="Back to chats"
                  onClick={() => selectChat(null)}
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div
                  className="chat-header-info"
                  onClick={() => activeChat.type !== "dm" && openGroupInfo()}
                  style={{ cursor: activeChat.type !== "dm" ? "pointer" : "default" }}
                  title={activeChat.type !== "dm" ? "Group info" : undefined}
                >
                  <img
                    src={prettyAvatar(activeChat.avatarUrl, activeChat.name)}
                    alt={activeChat.name}
                    style={{ width: "40px", height: "40px", borderRadius: "50%", objectFit: "cover" }}
                    onError={(e) => handleAvatarError(e, activeChat.name)}
                  />
                  <div className="chat-header-meta">
                    <span className="chat-header-title">
                      {activeChat.type === "channel" && activeChat.workspaceId
                        ? `#${activeChat.name}`
                        : activeChat.name}
                    </span>
                    <span className="chat-header-subtitle">
                      {renderPresenceText(activeChat)}
                    </span>
                  </div>
                </div>

                <div className="header-actions">
                  {activeChat.type !== "dm" && (
                    <button onClick={openGroupInfo} className="call-header-btn" title="Group Info">
                      <User className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => startCall("audio")} className="call-header-btn" title="Audio Call">
                    <Phone className="w-4 h-4" />
                  </button>
                  <button onClick={() => startCall("video")} className="call-header-btn" title="Video Call">
                    <Video className="w-4 h-4" />
                  </button>
                  <button onClick={loadAiSummary} className="call-header-btn" title="Summarize this conversation">
                    <Sparkles className="w-4 h-4" />
                  </button>

                  <div className="connection-indicator">
                    <div className={`status-pulse ${connectionStatus}`} />
                    <span>
                      {connectionStatus === "connected"
                        ? "syncing"
                        : connectionStatus === "connecting"
                        ? "connecting"
                        : "disconnected"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Pinned message banner */}
              {pinnedMessageIds.length > 0 && (() => {
                const pinned = messages.find((m) => m.id === pinnedMessageIds[pinnedMessageIds.length - 1]);
                if (!pinned) return null;
                return (
                  <div
                    className="pinned-banner"
                    onClick={() => document.getElementById(`msg-${pinned.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  >
                    <Pin className="w-3.5 h-3.5 text-accent" style={{ fill: "currentColor" }} />
                    <span className="pinned-banner-text">
                      <strong style={{ color: "var(--accent)", marginRight: "6px" }}>Pinned</strong>
                      {pinned.text
                        ? renderWaspmoji(pinned.text, 16)
                        : pinned.mediaType
                          ? "📎 Attachment"
                          : "Message"}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleTogglePin(pinned); }}
                      className="msg-action-btn"
                      style={{ marginLeft: "auto" }}
                      title="Unpin"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })()}

              {/* Message Feed */}
              <div className="message-feed" ref={messageFeedRef}>
                {(() => {
                  let lastDateStr = "";
                  return messages.length > 0 ? (
                    messages.map((m) => {
                      const msgDate = new Date(m.createdAt);
                      const dateStr = msgDate.toLocaleDateString([], {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      });

                      // Simple relative date labels
                      const today = new Date();
                      const yesterday = new Date();
                      yesterday.setDate(yesterday.getDate() - 1);

                      let displayDate = dateStr;
                      if (msgDate.toDateString() === today.toDateString()) {
                        displayDate = "Today";
                      } else if (msgDate.toDateString() === yesterday.toDateString()) {
                        displayDate = "Yesterday";
                      }

                      const showSeparator = displayDate !== lastDateStr;
                      lastDateStr = displayDate;

                      const isOutgoing = m.senderId === currentUser.id;
                      const isRead = m.readBy && m.readBy.length > 1;
                      const isDeleted = !!m.deletedAt;
                      // Jumbo emoji stand alone — no bubble chrome around a
                      // giant Waspmoji, same as iMessage/WhatsApp big emoji.
                      const isJumbo =
                        !isDeleted && !m.mediaUrl && !m.replyTo && !m.forwardFrom &&
                        !!m.text && pureEmojiCount(m.text) > 0;
                      const isPinned = pinnedMessageIds.includes(m.id);
                      const canModerate = isOutgoing || (activeChat?.type !== "dm" && false);

                      return (
                        <Fragment key={m.id}>
                          {showSeparator && (
                            <div className="date-separator">
                              <span>{displayDate}</span>
                            </div>
                          )}
                          {/* the jump anchor lives on the row, not the text <p> —
                              media-only and deleted messages have no <p>, which
                              made pin/reply jumps to them silently no-op */}
                          <div id={`msg-${m.id}`} className={`message-row ${isOutgoing ? "outgoing" : "incoming"}`}>
                            <div className="message-bubble-wrapper">
                              {/* Hover action block */}
                              {!isDeleted && (
                                <div className="msg-hover-actions">
                                  <div style={{ position: "relative" }}>
                                    <button
                                      onClick={() => setReactionPickerFor(reactionPickerFor === m.id ? null : m.id)}
                                      className="msg-action-btn"
                                      title="React"
                                    >
                                      <Smile className="w-3.5 h-3.5" />
                                    </button>
                                    {reactionPickerFor === m.id && (
                                      <div className="reaction-picker">
                                        {WASP_REACTIONS.map((code) => (
                                          <button
                                            key={code}
                                            type="button"
                                            className="reaction-pick-btn"
                                            title={code}
                                            onClick={() => { handleToggleReaction(m.id, code); setReactionPickerFor(null); }}
                                          >
                                            {renderWaspmoji(code, 22)}
                                          </button>
                                        ))}
                                        {REACTION_EMOJIS.map((emo) => (
                                          <button
                                            key={emo}
                                            className="reaction-pick-btn"
                                            onClick={() => handleToggleReaction(m.id, emo)}
                                          >
                                            {emo}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <button onClick={() => startReplying(m)} className="msg-action-btn" title="Reply">
                                    <Reply className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => openThread(m)} className="msg-action-btn" title="Reply in Thread">
                                    <MessageSquare className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => setForwardingMessage(m)} className="msg-action-btn" title="Forward">
                                    <Forward className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => handleTogglePin(m)} className="msg-action-btn" title={isPinned ? "Unpin" : "Pin"}>
                                    <Pin className="w-3.5 h-3.5" style={isPinned ? { fill: "currentColor" } : undefined} />
                                  </button>
                                  {isOutgoing && !m.mediaUrl && (
                                    <button onClick={() => startEditing(m)} className="msg-action-btn" title="Edit">
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <div style={{ position: "relative", display: "inline-flex" }}>
                                    <button
                                      onClick={() => setDeleteMenuFor(deleteMenuFor === m.id ? null : m.id)}
                                      className="msg-action-btn danger"
                                      title="Delete"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                    {deleteMenuFor === m.id && (
                                      <>
                                        <div style={{ position: "fixed", inset: 0, zIndex: 49 }} onClick={() => setDeleteMenuFor(null)} />
                                        <div className="delete-menu">
                                          <button type="button" onClick={() => handleDeleteForMe(m.id)}>
                                            Delete for me
                                          </button>
                                          {canModerate && (
                                            <button
                                              type="button"
                                              className="danger"
                                              onClick={() => { setDeleteMenuFor(null); handleDeleteMessage(m.id); }}
                                            >
                                              Delete for everyone
                                            </button>
                                          )}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}

                              <div className={`message-bubble ${isPinned ? "pinned" : ""} ${isDeleted ? "deleted" : ""} ${isJumbo ? "jumbo" : ""}`}>
                                {activeChat && activeChat.type === "group" && !isOutgoing && !isDeleted && (
                                  <span className="sender-name">@{m.senderUsername}</span>
                                )}

                                {isDeleted ? (
                                  <p className="deleted-message">
                                    <Trash2 className="w-3.5 h-3.5" style={{ display: "inline", verticalAlign: "-2px", marginRight: "4px" }} />
                                    This message was deleted
                                  </p>
                                ) : (
                                  <>
                                    {m.forwardFrom && (
                                      <div className="forwarded-label">
                                        <Forward className="w-3 h-3" /> Forwarded{m.forwardFrom.senderUsername ? ` from @${m.forwardFrom.senderUsername}` : ""}
                                      </div>
                                    )}

                                    {m.replyTo && (
                                      <div
                                        className="reply-quote"
                                        onClick={() => {
                                          const el = document.getElementById(`msg-${m.replyTo!.messageId}`);
                                          el?.scrollIntoView({ behavior: "smooth", block: "center" });
                                        }}
                                      >
                                        <span className="reply-quote-bar" />
                                        <span className="reply-quote-text">{m.replyTo.quote || "Message"}</span>
                                      </div>
                                    )}

                                    {/* Attachments use the same preview cards as the feed:
                                        PDFs, docs, sheets, code, markdown, ebooks and media all
                                        open in place. Collapsed by default so a thread stays
                                        readable and nothing is fetched until it's opened. */}
                                    {(() => {
                                      const media = messageMedia(m);
                                      if (!media) return null;
                                      return (
                                        <div className="message-media-container chat-attachment">
                                          <AttachmentRenderer media={media} compact />
                                        </div>
                                      );
                                    })()}

                                    {m.text && (() => {
                                      const jumbo = pureEmojiCount(m.text);
                                      return (
                                        <p
                                          style={{ wordBreak: "break-word", fontSize: jumbo ? 44 : undefined, lineHeight: jumbo ? 1.2 : undefined }}
                                        >
                                          {renderWaspmoji(m.text, jumbo ? 56 : 20)}
                                        </p>
                                      );
                                    })()}
                                  </>
                                )}

                                {/* Reactions */}
                                {m.reactions && m.reactions.length > 0 && (
                                  <div className="reactions-bar">
                                    {m.reactions.map((r) => {
                                      const mine = r.userIds.includes(currentUser.id);
                                      return (
                                        <button
                                          key={r.emoji}
                                          className={`reaction-chip ${mine ? "mine" : ""}`}
                                          onClick={() => handleToggleReaction(m.id, r.emoji)}
                                          title={`${r.count} reaction${r.count > 1 ? "s" : ""}`}
                                        >
                                          <span style={{ display: "inline-flex", alignItems: "center" }}>{renderWaspmoji(r.emoji, 16)}</span>
                                          <span className="reaction-count">{r.count}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* Thread indicator — without it nobody can tell a
                                    message has replies hiding behind it */}
                                {!isDeleted && !!m.threadCount && (
                                  <button
                                    type="button"
                                    className="thread-count-link"
                                    onClick={(e) => { e.stopPropagation(); openThread(m); }}
                                  >
                                    <MessageSquare className="w-3 h-3" />
                                    {m.threadCount} {m.threadCount === 1 ? "reply" : "replies"}
                                  </button>
                                )}

                                <div className="message-meta-info">
                                  {m.editedAt && !isDeleted && <span className="edited-tag">edited</span>}
                                  <span>
                                    {new Date(m.createdAt).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                  {isOutgoing && !isDeleted && (
                                    <svg className={`checkmark-svg ${isRead ? "read" : ""}`} viewBox="0 0 24 24">
                                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </Fragment>
                      );
                    })
                  ) : (
                    <div className="empty-messages-container">
                      <div className="empty-messages-icon" style={{ display: "flex", justifyContent: "center" }}>
                        <MessageSquare className="w-12 h-12 text-zinc-500" />
                      </div>
                      <h4>No messages yet</h4>
                      <p>Send a message or wave to start the conversation 👋</p>
                    </div>
                  );
                })()}
                <div ref={messagesEndRef} />
              </div>

              {/* Typing indicator */}
              {activeChat && (typingMap[activeChat.id]?.length ?? 0) > 0 && (
                <div className="typing-indicator">
                  <span className="typing-dots"><span></span><span></span><span></span></span>
                  <span>
                    {typingMap[activeChat.id].length === 1
                      ? `${typingMap[activeChat.id][0]} is typing…`
                      : `${typingMap[activeChat.id].slice(0, 2).join(", ")} are typing…`}
                  </span>
                </div>
              )}

              {/* Input Bar */}
              <div className="chat-input-bar">
                {(replyingTo || editingMessage) && (
                  <div className="compose-context">
                    <div className="compose-context-info">
                      {editingMessage ? <Pencil className="w-3.5 h-3.5 text-accent" /> : <Reply className="w-3.5 h-3.5 text-accent" />}
                      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                        <span className="compose-context-title">
                          {editingMessage ? "Editing message" : `Replying to @${replyingTo?.senderUsername}`}
                        </span>
                        <span className="compose-context-text">
                          {(editingMessage?.text || replyingTo?.text || (replyingTo?.mediaType ? "📎 Attachment" : "")) ?? ""}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setReplyingTo(null);
                        setEditingMessage(null);
                        setInputText("");
                      }}
                      className="remove-attach-btn"
                      style={{ display: "flex", alignItems: "center", gap: "4px" }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {attachedFile && (
                  <div className="attachment-preview">
                    <div className="file-info" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <Paperclip className="w-4 h-4 text-zinc-400" />
                      <span>
                        {attachedFile.name} ({(attachedFile.size / 1024 / 1024).toFixed(2)} MB)
                      </span>
                    </div>
                    <button onClick={() => setAttachedFile(null)} className="remove-attach-btn" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <X className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="input-bar-form">
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: "none" }}
                    onChange={handleFileChange}
                  />
                  {/* Inputs can only hold plain text, so shortcodes stay raw
                      while typing — this strip shows what will actually send. */}
                  {hasWaspmoji(inputText) && (
                    <div className="waspmoji-preview">
                      <span className="waspmoji-preview-label">Sends as</span>
                      <span className="waspmoji-preview-body">{renderWaspmoji(inputText, 22)}</span>
                    </div>
                  )}
                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      className="attach-btn"
                      title="Waspmoji — WASP's own emoji"
                      aria-label="Insert Waspmoji"
                      onClick={() => setWaspmojiOpen((v) => !v)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={waspmojiUrl("buzz")} alt="" style={{ width: 22, height: 22 }} draggable={false} />
                    </button>
                    {waspmojiOpen && (
                      <>
                        <div style={{ position: "fixed", inset: 0, zIndex: 49 }} onClick={() => setWaspmojiOpen(false)} />
                        <div className="waspmoji-tray">
                          <p className="waspmoji-tray-title">Waspmoji — only on WASP</p>
                          <div className="waspmoji-grid">
                            {WASPMOJI.map((name) => (
                              <button
                                key={name}
                                type="button"
                                className="waspmoji-cell"
                                title={`:${name}:`}
                                onClick={() => {
                                  setInputText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}:${name}: `);
                                  setWaspmojiOpen(false);
                                }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={waspmojiUrl(name)} alt={`:${name}:`} draggable={false} />
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="attach-btn"
                    disabled={uploadingFile}
                  >
                    {uploadingFile ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
                  </button>

                  <input
                    type="text"
                    placeholder={editingMessage ? "Edit message..." : "Write a message..."}
                    className="input-text-area"
                    value={inputText}
                    onChange={(e) => {
                      setInputText(e.target.value);
                      if (activeChat && e.target.value.trim()) signalTyping(activeChat.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setEditingMessage(null);
                        setReplyingTo(null);
                        setInputText("");
                      } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        // Explicit Enter-to-send; don't rely on implicit form submission.
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    disabled={uploadingFile}
                  />

                  <button
                    type="submit"
                    className="send-btn"
                    disabled={uploadingFile || (!inputText.trim() && !attachedFile)}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="chat-window-placeholder">
              <div className="placeholder-shield">
                <svg viewBox="0 0 24 24">
                  <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                </svg>
              </div>
              <h3>Welcome to WASP</h3>
              <p style={{ marginTop: "8px", maxWidth: "340px", fontSize: "14px" }}>
                Select a conversation from the sidebar or click + to start messaging. Your connection is secured with WASP monotonic sequencing.
              </p>
            </div>
          )}
        </div>

        {/* 3. SLACK-STYLE THREAD SIDE PANEL */}
        {activeThreadParent && (
          <div className="right-panel">
            <div className="panel-header">
              <span className="panel-title">Thread Reply</span>
              <button onClick={closeThread} className="panel-close-btn" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="thread-scroll" ref={threadFeedRef}>
              {/* Parent Message preview */}
              <div className="thread-parent-section">
                <div className="thread-parent-header" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <div className="thread-parent-avatar" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <MessageSquare className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="thread-parent-username">@{activeThreadParent.senderUsername}</div>
                  <div className="thread-parent-time">
                    {new Date(activeThreadParent.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div className="thread-parent-body">
                  {activeThreadParent.text && <p>{activeThreadParent.text}</p>}
                  {activeThreadParent.mediaUrl && (
                    <div className="message-media-container" style={{ marginTop: "6px" }}>
                      <img
                        src={activeThreadParent.mediaUrl}
                        alt="Parent Media"
                        style={{ maxWidth: "100%", maxHeight: "150px", borderRadius: "8px", display: "block" }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Thread Replies List */}
              <div className="thread-replies-section">
                {threadReplies.map((reply) => (
                  <div key={reply.id} className="thread-reply-row">
                    <div className="thread-reply-avatar" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <User className="w-4 h-4 text-zinc-400" />
                    </div>
                    <div className="thread-reply-content">
                      <span className="thread-reply-username">@{reply.senderUsername}</span>
                      {reply.mediaUrl && (
                        <div className="message-media-container">
                          <img src={reply.mediaUrl} alt="Reply Media" style={{ maxWidth: "100%", maxHeight: "120px", borderRadius: "6px" }} />
                        </div>
                      )}
                      {reply.text && <p className="thread-reply-body">{reply.text}</p>}
                      <span className="thread-reply-time">
                        {new Date(reply.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>
            </div>

            {/* Thread Composer */}
            <div className="chat-input-bar" style={{ padding: "12px 16px" }}>
              {threadAttachedFile && (
                <div className="attachment-preview" style={{ padding: "6px 10px", margin: "0 0 6px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <Paperclip className="w-3.5 h-3.5 text-zinc-400" />
                    {threadAttachedFile.name}
                  </span>
                  <button onClick={() => setThreadAttachedFile(null)} className="remove-attach-btn" style={{ fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", padding: "2px" }}><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
              <form onSubmit={handleSendThreadMessage} className="input-bar-form">
                <input
                  type="file"
                  ref={threadFileInputRef}
                  style={{ display: "none" }}
                  onChange={handleThreadFileChange}
                />
                <button
                  type="button"
                  onClick={() => threadFileInputRef.current?.click()}
                  className="attach-btn"
                  style={{ width: "38px", height: "38px", borderRadius: "10px" }}
                  disabled={threadUploadingFile}
                >
                  {threadUploadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                </button>
                <input
                  type="text"
                  placeholder="Reply in thread..."
                  className="input-text-area"
                  style={{ padding: "10px 14px", borderRadius: "10px" }}
                  value={threadInputText}
                  onChange={(e) => setThreadInputText(e.target.value)}
                  disabled={threadUploadingFile}
                />
                <button
                  type="submit"
                  className="send-btn"
                  style={{ width: "38px", height: "38px", borderRadius: "10px" }}
                  disabled={threadUploadingFile || (!threadInputText.trim() && !threadAttachedFile)}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        )}

        {/* 4. AI SUMMARIZATION SIDE PANEL */}
        {isAiSummaryOpen && (
          <div className="right-panel">
            <div className="panel-header">
              <span className="panel-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Sparkles className="w-4 h-4 text-blue-400" />
                <span>AI Digest & Actions</span>
              </span>
              <button onClick={() => setIsAiSummaryOpen(false)} className="panel-close-btn" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="summary-scroll">
              {aiSummaryLoading ? (
                <div style={{ margin: "auto", textAlign: "center", color: "var(--text-secondary)" }}>
                  <div className="spinner" style={{ margin: "0 auto 12px auto" }} />
                  <p style={{ fontSize: "13px" }}>Analyzing thread history...</p>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 700 }}>
                      SUMMARY DIGEST
                    </label>
                    <div className="summary-card">
                      {aiSummaryText}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 700 }}>
                      EXTRACTED ACTION ITEMS
                    </label>
                    <div className="action-items-section">
                      {aiActionItems.length > 0 ? (
                        aiActionItems.map((item, index) => {
                          const isCompleted = !!aiCheckedItems[index];
                          return (
                            <div key={index} className={`action-item-card ${isCompleted ? "completed" : ""}`}>
                              <input
                                type="checkbox"
                                className="action-item-checkbox"
                                checked={isCompleted}
                                onChange={() => {
                                  setAiCheckedItems((prev) => ({
                                    ...prev,
                                    [index]: !prev[index],
                                  }));
                                }}
                              />
                              <span className="action-item-text">{item}</span>
                            </div>
                          );
                        })
                      ) : (
                        <p style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic" }}>
                          No action items found in the recent messages.
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 5. NEW CHAT GLASS MODAL */}
      {isGroupInfoOpen && activeChat && (
        <div className="modal-overlay" style={{ zIndex: 10002 }} onClick={() => setIsGroupInfoOpen(false)}>
          <div className="modal-content glass-panel glass-modal" style={{ maxWidth: "460px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <h2 className="modal-title" style={{ margin: 0 }}>Group Info</h2>
              <button onClick={() => setIsGroupInfoOpen(false)} className="msg-action-btn"><X className="w-4 h-4" /></button>
            </div>

            {/* Group photo (admins can change) */}
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
              <div style={{ position: "relative", width: 64, height: 64, flexShrink: 0 }}>
                <img
                  src={prettyAvatar(activeChat.avatarUrl, activeChat.name)}
                  alt=""
                  onError={(e) => handleAvatarError(e, activeChat.name)}
                  style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", display: "block" }}
                />
                {(myRoleInActiveChat() === "owner" || myRoleInActiveChat() === "admin") && (
                  <>
                    <input
                      ref={groupAvatarInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        handleGroupAvatarChange(e.target.files?.[0] ?? null);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      title="Change group photo"
                      aria-label="Change group photo"
                      disabled={groupAvatarUploading}
                      onClick={() => groupAvatarInputRef.current?.click()}
                      style={{
                        position: "absolute", right: -2, bottom: -2, width: 26, height: 26, borderRadius: "50%",
                        background: "var(--accent)", color: "var(--text-on-accent)", border: "2px solid var(--bg-elevated)",
                        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                      }}
                    >
                      {groupAvatarUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                    </button>
                  </>
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {activeChat.type === "channel" && activeChat.workspaceId ? `#${activeChat.name}` : activeChat.name}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {groupMembers.length} member{groupMembers.length === 1 ? "" : "s"}
                  {(myRoleInActiveChat() === "owner" || myRoleInActiveChat() === "admin") ? " · Click the camera to change the photo" : ""}
                </div>
              </div>
            </div>

            {/* Rename (admins only) */}
            {(myRoleInActiveChat() === "owner" || myRoleInActiveChat() === "admin") && (
              <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
                <input
                  className="input-text-area"
                  style={{ flex: 1, background: "var(--layer-2)", borderRadius: "8px", padding: "8px 12px", border: "1px solid var(--layer-3)" }}
                  value={renameGroupValue}
                  onChange={(e) => setRenameGroupValue(e.target.value)}
                  placeholder="Group name"
                />
                <button className="send-btn" onClick={handleRenameGroup} title="Rename">
                  <Check className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Visibility (personal groups, admins only) */}
            {activeChat.type === "group" && !activeChat.workspaceId &&
              (myRoleInActiveChat() === "owner" || myRoleInActiveChat() === "admin") && (
              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Visibility
                </div>
                <div className="visibility-toggle" role="radiogroup" aria-label="Group visibility">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={(activeChat.visibility ?? "private") === "private"}
                    className={`visibility-option ${(activeChat.visibility ?? "private") === "private" ? "active" : ""}`}
                    onClick={() => handleGroupVisibility("private")}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span><strong>Private</strong><small>Invite-only, not discoverable</small></span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={activeChat.visibility === "public"}
                    className={`visibility-option ${activeChat.visibility === "public" ? "active" : ""}`}
                    onClick={() => handleGroupVisibility("public")}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span><strong>Public</strong><small>Listed in Find Groups, anyone can join</small></span>
                  </button>
                </div>
              </div>
            )}

            {/* Add member (admins only) */}
            {(myRoleInActiveChat() === "owner" || myRoleInActiveChat() === "admin") && (
              <div style={{ display: "flex", gap: "8px", marginBottom: "14px", position: "relative" }}>
                <input
                  className="input-text-area"
                  style={{ flex: 1, background: "var(--layer-2)", borderRadius: "8px", padding: "8px 12px", border: "1px solid var(--layer-3)" }}
                  value={addMemberUsername}
                  onChange={(e) => {
                    setAddMemberUsername(e.target.value);
                    setActiveField(null);
                    searchUsers(e.target.value);
                  }}
                  onFocus={() => {
                    setActiveField(null);
                    if (addMemberUsername) searchUsers(addMemberUsername);
                  }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddMember()}
                  placeholder="Add member by username"
                  autoComplete="off"
                />
                <button className="send-btn" onClick={handleAddMember} title="Add member">
                  <Plus className="w-4 h-4" />
                </button>
                {showSuggestions && activeField === null && userSuggestions.length > 0 && (
                  <div className="user-suggestions-dropdown" style={{ top: "100%", left: 0, right: 48 }}>
                    {userSuggestions.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className="suggestion-item"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setAddMemberUsername(u.username);
                          setShowSuggestions(false);
                          setUserSuggestions([]);
                        }}
                      >
                        <img
                          src={prettyAvatar(u.avatarUrl, u.username)}
                          onError={(e) => handleAvatarError(e, u.username)}
                          alt=""
                          className="suggestion-avatar"
                        />
                        <div className="suggestion-info">
                          <span className="suggestion-name">{u.displayName || u.username}</span>
                          <span className="suggestion-username">@{u.username}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {groupMembers.length} Members
            </div>

            {groupMembersLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "20px" }}>
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : (
              <div className="forward-target-list">
                {groupMembers.map((mem) => {
                  const iAmAdmin = myRoleInActiveChat() === "owner" || myRoleInActiveChat() === "admin";
                  return (
                    <div key={mem.userId} className="forward-target" style={{ cursor: "default" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={prettyAvatar(mem.avatarUrl, mem.username)} alt={mem.username} onError={(e) => handleAvatarError(e, mem.username)} />
                      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          {mem.username}{mem.isSelf ? " (you)" : ""}
                          {mem.role !== "member" && (
                            <span style={{ fontSize: "10px", color: "var(--accent)", border: "1px solid var(--accent-ring)", borderRadius: "5px", padding: "1px 5px", textTransform: "uppercase" }}>
                              {mem.role}
                            </span>
                          )}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{mem.status}</span>
                      </div>
                      <div style={{ display: "flex", gap: "4px" }}>
                        {iAmAdmin && mem.role !== "owner" && !mem.isSelf && (
                          <>
                            <button
                              type="button"
                              className="role-toggle-btn"
                              title={mem.role === "admin" ? "Remove admin rights" : "Make this member an admin"}
                              onClick={() => handleChangeRole(mem.userId, mem.role === "admin" ? "member" : "admin")}
                            >
                              {mem.role === "admin"
                                ? <><ShieldOff className="w-3.5 h-3.5" /> Remove admin</>
                                : <><ShieldCheck className="w-3.5 h-3.5" /> Make admin</>}
                            </button>
                            <button className="msg-action-btn danger" title="Remove" onClick={() => handleRemoveMember(mem.userId)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Leave group */}
            <button
              onClick={() => handleRemoveMember(currentUser.id)}
              style={{ marginTop: "16px", width: "100%", padding: "10px", borderRadius: "10px", border: "1px solid var(--danger-soft)", background: "var(--danger-soft)", color: "var(--danger)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
            >
              <LogOut className="w-4 h-4" /> Leave Group
            </button>
          </div>
        </div>
      )}

      {forwardingMessage && (
        <div className="modal-overlay" style={{ zIndex: 10002 }} onClick={closeForwardModal}>
          <div className="modal-content glass-panel glass-modal" style={{ maxWidth: "420px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <h2 className="modal-title" style={{ margin: 0 }}>Forward to…</h2>
              <button onClick={closeForwardModal} className="msg-action-btn"><X className="w-4 h-4" /></button>
            </div>
            <input
              type="text"
              value={forwardSearch}
              onChange={(e) => searchForwardUsers(e.target.value)}
              placeholder="Search any user…"
              autoFocus
              style={{
                width: "100%", marginBottom: "10px", padding: "9px 12px", fontSize: "14px",
                borderRadius: "10px", border: "1px solid var(--border-color)",
                background: "var(--bg-surface)", color: "var(--text-primary)", outline: "none",
              }}
            />
            <div className="forward-target-list">
              {forwardResults.map((u) => (
                <button key={`u-${u.username}`} className="forward-target" onClick={() => handleForwardToUser(u.username)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={prettyAvatar(u.avatarUrl, u.username)} alt={u.username} onError={(e) => handleAvatarError(e, u.username)} />
                  <span>{u.displayName || u.username} <span style={{ color: "var(--text-muted)" }}>@{u.username}</span></span>
                </button>
              ))}
              {forwardResults.length > 0 && <div style={{ borderTop: "1px solid var(--border-color)", margin: "6px 0" }} />}
              {/* The current chat is excluded — forwarding is for sending elsewhere */}
              {chats.filter((c) => c.id !== activeChat?.id).map((c) => (
                <button key={c.id} className="forward-target" onClick={() => handleForwardMessage(c.id)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={prettyAvatar(c.avatarUrl, c.name)} alt={c.name} onError={(e) => handleAvatarError(e, c.name)} />
                  <span>{c.name}</span>
                </button>
              ))}
              {forwardResults.length === 0 && chats.filter((c) => c.id !== activeChat?.id).length === 0 && (
                <p style={{ color: "var(--text-muted)", fontSize: "13px", padding: "12px" }}>
                  Search for a user above to forward this message.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {workspace && isChannelModalOpen && (
        <ChannelModal
          workspace={workspace}
          onClose={() => setIsChannelModalOpen(false)}
          onChanged={fetchChats}
          onOpenChannel={async (chatId) => {
            setIsChannelModalOpen(false);
            const res = await fetch("/api/chats");
            if (res.ok) {
              const data = await res.json();
              setChats(data.chats);
              const target = data.chats.find((c: Chat) => c.id === chatId);
              if (target) selectChat(target);
            }
          }}
        />
      )}

      {isNewChatModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel glass-modal">
            <h2 className="modal-title">New Message</h2>

            <div className="modal-tabs">
              <button
                type="button"
                className={`modal-tab ${newChatType === "dm" ? "active" : ""}`}
                onClick={() => {
                  setNewChatType("dm");
                  setModalError("");
                }}
              >
                Direct Message
              </button>
              <button
                type="button"
                className={`modal-tab ${newChatType === "group" ? "active" : ""}`}
                onClick={() => {
                  setNewChatType("group");
                  setModalError("");
                }}
              >
                Create Group
              </button>
              <button
                type="button"
                className={`modal-tab ${newChatType === "discover" ? "active" : ""}`}
                onClick={() => {
                  setNewChatType("discover");
                  setModalError("");
                }}
              >
                Find Groups
              </button>
            </div>

            {modalError && (
              <div
                style={{
                  background: "var(--danger-soft)",
                  border: "1px solid var(--danger-soft)",
                  color: "var(--danger)",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  marginBottom: "16px",
                  fontFamily: "var(--font-chat)",
                }}
              >
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreateChat} className="modal-form" style={newChatType === "discover" ? { display: "none" } : undefined}>
              {newChatType === "dm" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", position: "relative" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
                    RECIPIENT USERNAME
                  </label>
                  <input
                    type="text"
                    placeholder="Start typing a username..."
                    className="search-bar"
                    value={recipientUsername}
                    onChange={(e) => {
                      setRecipientUsername(e.target.value);
                      setActiveField("dm");
                      searchUsers(e.target.value);
                    }}
                    onFocus={() => {
                      setActiveField("dm");
                      if (recipientUsername) searchUsers(recipientUsername);
                    }}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    required
                    disabled={modalLoading}
                    autoComplete="off"
                  />
                  {showSuggestions && activeField === "dm" && userSuggestions.length > 0 && (
                    <div className="user-suggestions-dropdown">
                      {userSuggestions.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          className="suggestion-item"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSelectSuggestion(u.username)}
                        >
                          <img
                            src={prettyAvatar(u.avatarUrl, u.username)}
                            onError={(e) => handleAvatarError(e, u.username)}
                            alt=""
                            className="suggestion-avatar"
                          />
                          <div className="suggestion-info">
                            <span className="suggestion-name">{u.displayName || u.username}</span>
                            <span className="suggestion-username">@{u.username}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
                      GROUP NAME
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Design Team"
                      className="search-bar"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      required
                      disabled={modalLoading}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", position: "relative" }}>
                    <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
                      PARTICIPANTS
                    </label>
                    <input
                      type="text"
                      placeholder="Start typing usernames..."
                      className="search-bar"
                      value={groupParticipants}
                      onChange={(e) => {
                        setGroupParticipants(e.target.value);
                        setActiveField("group");
                        // Search the last token after the last comma
                        const parts = e.target.value.split(",");
                        const lastPart = parts[parts.length - 1].trim();
                        searchUsers(lastPart);
                      }}
                      onFocus={() => {
                        setActiveField("group");
                        const parts = groupParticipants.split(",");
                        const lastPart = parts[parts.length - 1].trim();
                        if (lastPart) searchUsers(lastPart);
                      }}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                      disabled={modalLoading}
                      autoComplete="off"
                    />
                    {showSuggestions && activeField === "group" && userSuggestions.length > 0 && (
                      <div className="user-suggestions-dropdown">
                        {userSuggestions.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            className="suggestion-item"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSelectSuggestion(u.username)}
                          >
                            <img
                              src={prettyAvatar(u.avatarUrl, u.username)}
                              onError={(e) => handleAvatarError(e, u.username)}
                              alt=""
                              className="suggestion-avatar"
                            />
                            <div className="suggestion-info">
                              <span className="suggestion-name">{u.displayName || u.username}</span>
                              <span className="suggestion-username">@{u.username}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
                      VISIBILITY
                    </label>
                    <div className="visibility-toggle" role="radiogroup" aria-label="Group visibility">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={groupVisibility === "private"}
                        className={`visibility-option ${groupVisibility === "private" ? "active" : ""}`}
                        onClick={() => setGroupVisibility("private")}
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>
                          <strong>Private</strong>
                          <small>Only people you add can find or join</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={groupVisibility === "public"}
                        className={`visibility-option ${groupVisibility === "public" ? "active" : ""}`}
                        onClick={() => setGroupVisibility("public")}
                      >
                        <Globe className="w-3.5 h-3.5" />
                        <span>
                          <strong>Public</strong>
                          <small>Anyone can discover and join from Find Groups</small>
                        </span>
                      </button>
                    </div>
                  </div>
                </>
              )}

              {newChatType !== "discover" && (
                <div className="modal-actions">
                  <button
                    type="button"
                    onClick={() => setIsNewChatModalOpen(false)}
                    className="btn-cancel"
                    disabled={modalLoading}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-submit" disabled={modalLoading}>
                    {modalLoading ? "Creating..." : newChatType === "group" ? "Create Group" : "Start Chat"}
                  </button>
                </div>
              )}
            </form>

            {newChatType === "discover" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <input
                  type="text"
                  placeholder="Search public groups…"
                  className="search-bar"
                  value={discoverQuery}
                  onChange={(e) => setDiscoverQuery(e.target.value)}
                  autoComplete="off"
                />
                <div className="forward-target-list" style={{ maxHeight: 280 }}>
                  {discoverLoading ? (
                    <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><Loader2 className="w-5 h-5 animate-spin" /></div>
                  ) : discoverGroups.length === 0 ? (
                    <p style={{ color: "var(--text-muted)", fontSize: 13, padding: "16px 12px", textAlign: "center" }}>
                      {discoverQuery ? "No public groups match your search." : "No public groups yet. Make one public when you create it!"}
                    </p>
                  ) : (
                    discoverGroups.map((g) => (
                      <div key={g.id} className="forward-target" style={{ cursor: "default" }}>
                        <img src={prettyAvatar(g.avatarUrl, g.name)} alt="" onError={(e) => handleAvatarError(e, g.name)} />
                        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{g.memberCount} member{g.memberCount === 1 ? "" : "s"} · Public</span>
                        </div>
                        {g.joined ? (
                          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Joined</span>
                        ) : (
                          <button
                            type="button"
                            className="btn-submit"
                            style={{ padding: "6px 12px", fontSize: 12 }}
                            disabled={joiningGroupId === g.id}
                            onClick={() => handleJoinPublicGroup(g.id)}
                          >
                            {joiningGroupId === g.id ? "Joining…" : "Join"}
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                <div className="modal-actions">
                  <button type="button" onClick={() => setIsNewChatModalOpen(false)} className="btn-cancel">Close</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. SETTINGS MODAL */}
      {isSettingsOpen && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel glass-modal" style={{ maxWidth: "540px", maxHeight: "85vh", overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <h2 className="modal-title" style={{ margin: 0 }}>Profile Settings</h2>
              <button type="button" onClick={() => setIsSettingsOpen(false)} className="msg-action-btn">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <form onSubmit={handleSaveProfile}>
              {/* Avatar */}
              <div className="avatar-edit-container">
                <div className="avatar-preview-wrapper" onClick={() => settingsAvatarInputRef.current?.click()}>
                  <img src={prettyAvatar(profileAvatarUrl, currentUser.username)} alt="avatar" onError={(e) => handleAvatarError(e, currentUser.username)} />
                  <div className="avatar-upload-overlay">
                    {profileUploading ? "Uploading..." : "Change"}
                  </div>
                </div>
                <input
                  type="file"
                  ref={settingsAvatarInputRef}
                  style={{ display: "none" }}
                  onChange={handleAvatarChange}
                  accept="image/*"
                />
              </div>

              {/* Section: Personal Info */}
              <div className="settings-section-label">Personal Information</div>

              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="Enter full name"
                  className="search-bar"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              </div>

              <div className="form-row-grid">
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input
                    type="text"
                    required
                    placeholder="username"
                    className="search-bar"
                    value={profileUsername}
                    onChange={(e) => setProfileUsername(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    type="email"
                    required
                    placeholder="email@example.com"
                    className="search-bar"
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                  />
                </div>
              </div>

              {/* Section: About */}
              <div className="settings-section-label" style={{ marginTop: "20px" }}>About</div>

              <div className="form-group">
                <label className="form-label">Bio</label>
                <textarea
                  placeholder="Tell others a bit about yourself..."
                  className="search-bar"
                  style={{ minHeight: "70px", resize: "vertical", fontFamily: "inherit", lineHeight: "1.5" }}
                  value={profileBio}
                  onChange={(e) => setProfileBio(e.target.value)}
                  maxLength={300}
                />
                <div style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "right", marginTop: "4px" }}>
                  {profileBio.length}/300
                </div>
              </div>

              <div className="form-row-grid">
                <div className="form-group">
                  <label className="form-label">Gender</label>
                  <select
                    className="search-bar"
                    value={profileGender}
                    onChange={(e) => setProfileGender(e.target.value)}
                    style={{ appearance: "none", cursor: "pointer" }}
                  >
                    <option value="">Prefer not to say</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="non-binary">Non-binary</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Date of Birth</label>
                  <input
                    type="date"
                    className="search-bar"
                    value={profileDob}
                    onChange={(e) => setProfileDob(e.target.value)}
                    style={{ colorScheme: "dark" }}
                  />
                </div>
              </div>

              {/* Section: Security */}
              <div className="settings-section-label" style={{ marginTop: "20px" }}>Security</div>

              <div className="form-row-grid">
                <div className="form-group">
                  <label className="form-label">New Password</label>
                  <input
                    type="password"
                    placeholder="New password (optional)"
                    className="search-bar"
                    value={profilePassword}
                    onChange={(e) => setProfilePassword(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Confirm Password</label>
                  <input
                    type="password"
                    placeholder="Confirm password"
                    className="search-bar"
                    value={profileConfirmPassword}
                    onChange={(e) => setProfileConfirmPassword(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-actions" style={{ marginTop: "24px" }}>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="btn-cancel"
                  disabled={profileSaveLoading}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-submit" disabled={profileSaveLoading || profileUploading}>
                  {profileSaveLoading ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7-9. CALL UI — portalled to <body>.
          The shell hides this whole view when you click Home/Explore/etc., and a
          `display:none` ancestor would take the call overlay with it: camera still
          lit, peer connections still streaming, and no End Call button anywhere. */}
      {callPortalTarget && createPortal(
        <>
        {/* 7. INCOMING CALL TOAST */}
        {isCallIncoming && callerInfo && (
          <div className="incoming-call-modal">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/5 border border-white/10 text-white shrink-0" style={{ display: "flex" }}>
              {callerInfo.type === "video" ? <Video className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
            </div>
            <div className="incoming-info">
              <span className="incoming-title">Incoming {callerInfo.type} call</span>
              <span className="incoming-subtitle">from {callerInfo.displayName}</span>
            </div>
            <div className="incoming-actions">
              <button className="incoming-btn decline" onClick={declineCall}>Decline</button>
              <button className="incoming-btn accept" onClick={acceptCall}>Accept</button>
            </div>
          </div>
        )}

        {/* 8. ACTIVE CALL SCREEN OVERLAY */}
        {activeCall && callStatus === "connected" && (
          <div className="call-overlay force-dark">
            <div className="call-container">
              <div className="call-header-pane">
                <span className="call-title">
                  WASP Call ({activeCall.type === "video" ? "Video" : "Audio"})
                </span>
                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  <button
                    className="incoming-btn accept"
                    style={{ background: "var(--accent-muted)", border: "1px solid var(--accent)", color: "var(--accent)", display: "flex", alignItems: "center", gap: "6px" }}
                    onClick={() => {
                      if (activeCall) loadGroupMembers(activeCall.chatId);
                      setIsAddParticipantOpen(true);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Participant</span>
                  </button>
                  <span style={{ fontSize: "14px", color: "var(--text-muted)" }}>
                    {activeCall.participants.length} Participant(s)
                  </span>
                </div>
              </div>

              <div className="streams-grid">
                {/* Local stream — always muted locally so we never echo ourselves. */}
                <div className="video-wrapper">
                  {/* The camera-off gate applies to the camera only — hiding your
                      own screen-share preview means you cannot see what you are
                      broadcasting, exactly when that matters most. */}
                  <MediaFeed
                    stream={isScreenSharing ? screenStream : localStream}
                    muted={true}
                    visible={showLocalPreview}
                  />
                  {!showLocalPreview && (
                    <div className="avatar-placeholder">
                      <img src={prettyAvatar(currentUser.avatarUrl, currentUser.username)} alt="avatar" onError={(e) => handleAvatarError(e, currentUser.username)} />
                      <span>You {isMuted && "(Muted)"}</span>
                    </div>
                  )}
                  <div className="video-label">
                    You {isScreenSharing && "(Sharing Screen)"} {isMuted && " - Muted"}
                  </div>
                </div>

                {/* Remote streams */}
                {Object.entries(remoteStreams).map(([peerId, remoteInfo]) => {
                  const showVideo = activeCall.type === "video" && remoteInfo.hasVideo;
                  const connecting = remoteInfo.state !== "connected";
                  return (
                    <div className="video-wrapper" key={peerId}>
                      {/* Mounted for audio calls too — this element is what carries the sound. */}
                      <MediaFeed stream={remoteInfo.stream} muted={false} visible={showVideo} />
                      {showVideo && remoteInfo.videoStalled && (
                        <div className="video-stalled">
                          Poor connection — video paused, audio continuing
                        </div>
                      )}
                      {!showVideo && (
                        <div className="avatar-placeholder">
                          <img src={prettyAvatar(remoteInfo.avatarUrl, remoteInfo.username)} alt="avatar" onError={(e) => handleAvatarError(e, remoteInfo.username)} />
                          <span>{remoteInfo.displayName}</span>
                        </div>
                      )}
                      <div className="video-label">
                        {remoteInfo.displayName}
                        {remoteInfo.screenShare && " (Screen Sharing)"}
                        {connecting && " · Connecting…"}
                      </div>
                    </div>
                  );
                })}

                {/* Nobody has answered yet — say so instead of showing an empty room. */}
                {Object.keys(remoteStreams).length === 0 && (
                  <div className="video-wrapper">
                    <div className="avatar-placeholder">
                      <span>Ringing…</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="call-controls">
                <button
                  className={`control-btn ${isMuted ? "active" : ""}`}
                  onClick={toggleMute}
                  title={isMuted ? "Unmute Mic" : "Mute Mic"}
                >
                  {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>

                {activeCall.type === "video" && (
                  <>
                    <button
                      className={`control-btn ${isCameraOff ? "active" : ""}`}
                      onClick={toggleCamera}
                      title={isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
                    >
                      {isCameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                    </button>

                    <button
                      className={`control-btn ${isScreenSharing ? "active" : ""}`}
                      onClick={toggleScreenShare}
                      title={isScreenSharing ? "Stop Screen Share" : "Share Screen"}
                    >
                      <Monitor className="w-5 h-5" />
                    </button>
                  </>
                )}

                <button
                  className="control-btn danger"
                  onClick={endCall}
                  title="End Call"
                >
                  <PhoneOff className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 9. ADD PARTICIPANT MODAL */}
        {isAddParticipantOpen && activeCall && (
          <div className="modal-overlay" style={{ zIndex: 10001 }}>
            <div className="modal-content glass-panel glass-modal" style={{ maxWidth: "400px" }}>
              <h2 className="modal-title">Invite to Call</h2>
            
              <div style={{ maxHeight: "250px", overflowY: "auto", margin: "16px 0" }}>
                {invitableMembers.map(member => (
                  <div
                    key={member.userId}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 0",
                      borderBottom: "1px solid var(--layer-2)"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                      <img
                        src={prettyAvatar(member.avatarUrl, member.username)}
                        alt=""
                        onError={(e) => handleAvatarError(e, member.username)}
                        style={{ width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0 }}
                      />
                      <span style={{ fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        @{member.username}
                      </span>
                    </div>
                    <button
                      className="incoming-btn accept"
                      style={{ padding: "4px 10px", fontSize: "12px", flexShrink: 0 }}
                      onClick={() => {
                        inviteMemberToCall(member.userId);
                        setIsAddParticipantOpen(false);
                      }}
                    >
                      Invite
                    </button>
                  </div>
                ))}
                {invitableMembers.length === 0 && (
                  <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)" }}>
                    {groupMembersLoading ? "Loading…" : "Everyone here is already in the call."}
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setIsAddParticipantOpen(false)}
                  className="btn-cancel"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
        </>,
        callPortalTarget
      )}
    </div>
  );
}
