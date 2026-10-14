import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { ObjectId } from "mongodb";
import { PostMedia, validateMedia } from "@/lib/post-media";
import { resolveAssets } from "@/lib/media-pipeline";
import { ModerationError, assertCleanText } from "@/lib/moderation";
import { getCoMemberIds } from "@/lib/workspace-access";

// GET /api/posts — fetch feed
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();
  const userId = user._id!.toString();
  const feedType = req.nextUrl.searchParams.get("feed") || "all";
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "30");

  // Who I follow decides which "followers-only" posts I may see.
  const followDocs = await db.collection("follows").find({ followerId: userId }).toArray();
  const followingIds = followDocs.map((f) => f.followingId);

  // WASP is invite-only, so the feed reads as a company announcements board,
  // not a public timeline: nothing authored outside my workspaces reaches it.
  // No workspace yet = I see only my own posts.
  const coMemberIds = await getCoMemberIds(db, userId);
  const feedAuthors = [userId, ...coMemberIds];

  // Visibility: my own posts always; others' only if public, or
  // followers-only and I follow them. Soft-deleted posts never appear.
  const visibleToMe = {
    deletedAt: { $exists: false },
    $and: [
      // Community-hidden posts stay visible to their author only.
      { $or: [{ hiddenByReports: { $ne: true } }, { authorId: userId }] },
      // The workspace gate. Every branch below composes onto visibleToMe, so
      // author:/liked/following/repost lookups all inherit it.
      { authorId: { $in: feedAuthors } },
    ],
    $or: [
      { authorId: userId },
      { visibility: { $in: ["public", null] } },
      { visibility: "followers", authorId: { $in: followingIds } },
    ],
  };

  const filterParam = req.nextUrl.searchParams.get("filter") || "";

  let postFilter: Record<string, unknown>;
  let orderIds: string[] | null = null; // preserve interaction order for liked/bookmarked/reposted

  if (filterParam === "liked" || filterParam === "bookmarked" || filterParam === "reposted") {
    const type = filterParam === "liked" ? "like" : filterParam === "bookmarked" ? "bookmark" : "repost";
    const mine = await db.collection("post_interactions")
      .find({ userId, type }).sort({ createdAt: -1 }).limit(limit).toArray();
    orderIds = mine.map((i) => String(i.postId)).filter((id) => ObjectId.isValid(id));
    postFilter = { $and: [visibleToMe, { _id: { $in: orderIds.map((id) => new ObjectId(id)) } }] };
  } else if (filterParam.startsWith("author:")) {
    postFilter = { $and: [visibleToMe, { authorId: filterParam.slice(7) }] };
  } else if (feedType === "following") {
    postFilter = { $and: [visibleToMe, { authorId: { $in: [userId, ...followingIds] } }] };
  } else {
    postFilter = visibleToMe;
  }

  let posts = await db.collection("posts")
    .find(postFilter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  if (orderIds) {
    const pos = new Map(orderIds.map((id, i) => [id, i]));
    posts.sort((a, b) => (pos.get(a._id.toString()) ?? 0) - (pos.get(b._id.toString()) ?? 0));
  }

  // Reposts: surface posts that people I follow (or I) reposted, labelled
  // "X reposted", ranked by when the repost happened. Feed views only.
  const repostedBy = new Map<string, { userId: string; at: Date }>();
  if (!filterParam) {
    // Follow rows predate the invite-only rule and can point outside my
    // workspaces; "X reposted" names a person, so it stays workspace-scoped too.
    const inWorkspace = new Set(coMemberIds);
    const reposters = [userId, ...followingIds.filter((id) => inWorkspace.has(id))];
    if (reposters.length) {
      const reposts = await db.collection("post_interactions")
        .find({ type: "repost", userId: { $in: reposters } })
        .sort({ createdAt: -1 }).limit(limit).toArray();
      const ids = reposts.map((r) => String(r.postId)).filter((id) => ObjectId.isValid(id));
      if (ids.length) {
        const extra = await db.collection("posts")
          .find({ $and: [visibleToMe, { _id: { $in: ids.map((id) => new ObjectId(id)) } }] })
          .toArray();
        const have = new Set(posts.map((p) => p._id.toString()));
        for (const r of reposts) {
          const pid = String(r.postId);
          if (!repostedBy.has(pid) && r.userId !== userId) repostedBy.set(pid, { userId: r.userId, at: r.createdAt });
        }
        for (const e of extra) if (!have.has(e._id.toString())) posts.push(e);
        // rank by the latest of (created, reposted)
        posts.sort((a, b) => {
          const ta = Math.max(new Date(a.createdAt).getTime(), repostedBy.get(a._id.toString())?.at?.getTime() ?? 0);
          const tb = Math.max(new Date(b.createdAt).getTime(), repostedBy.get(b._id.toString())?.at?.getTime() ?? 0);
          return tb - ta;
        });
        posts = posts.slice(0, limit);
      }
    }
  }

  // Private accounts: their posts are only for accepted followers (and themselves),
  // whatever the per-post visibility says.
  {
    const candidateAuthors = [...new Set(posts.map((p) => p.authorId))].filter((a) => a !== userId && !followingIds.includes(a));
    if (candidateAuthors.length) {
      const privateAuthors = await db.collection("users")
        .find({ _id: { $in: candidateAuthors.filter((a) => ObjectId.isValid(a)).map((a) => new ObjectId(a)) }, accountPrivate: true }, { projection: { _id: 1 } })
        .toArray();
      const hidden = new Set(privateAuthors.map((u) => u._id.toString()));
      if (hidden.size) posts = posts.filter((p) => !hidden.has(p.authorId));
    }
  }

  // Get author info (+ reposters)
  const authorIds = [...new Set([...posts.map(p => p.authorId), ...[...repostedBy.values()].map((r) => r.userId)])];
  const authors = await db.collection("users")
    .find({ _id: { $in: authorIds.map(id => new ObjectId(id)) } })
    .toArray();
  const authorMap = Object.fromEntries(
    authors.map(a => [a._id.toString(), {
      username: a.username || "",
      displayName: a.displayName || a.username || "",
      avatarUrl: a.avatarUrl || "",
    }])
  );

  // Get current user's interactions
  const postIds = posts.map(p => p._id.toString());
  const interactions = await db.collection("post_interactions")
    .find({ userId, postId: { $in: postIds } })
    .toArray();
  const interactionMap: Record<string, Set<string>> = {};
  interactions.forEach(i => {
    if (!interactionMap[i.postId]) interactionMap[i.postId] = new Set();
    interactionMap[i.postId].add(i.type);
  });

  // Upgrade media to the best current rendition (e.g. a video whose
  // background transcode finished after the post was created).
  const allUrls = posts.flatMap((p) => normalizeMedia(p).map((m) => m.url));
  const assetMap = await resolveAssets(db, allUrls);
  const upgrade = (media: PostMedia[]): PostMedia[] =>
    media.map((m) => {
      const a = assetMap.get(m.url);
      return a
        ? { ...m, url: a.url, originalUrl: m.originalUrl || a.originalUrl, thumbUrl: m.thumbUrl || a.thumbUrl, width: m.width || a.width, height: m.height || a.height, sensitive: m.sensitive || a.sensitive }
        : m;
    });

  const result = posts.map(p => {
    const pid = p._id.toString();
    const userInteractions = interactionMap[pid] || new Set();
    return {
      id: pid,
      authorId: p.authorId,
      author: authorMap[p.authorId] || { username: "unknown", displayName: "Unknown", avatarUrl: "" },
      text: p.text,
      mediaUrl: p.mediaUrl || null,
      media: upgrade(normalizeMedia(p)),
      visibility: p.visibility || "public",
      repostedBy: repostedBy.has(pid) ? (authorMap[repostedBy.get(pid)!.userId] || null) : null,
      commentsEnabled: p.commentsEnabled !== false,
      editedAt: p.editedAt || null,
      isOwner: p.authorId === userId,
      likes: p.likes || 0,
      reposts: p.reposts || 0,
      replies: p.replies || 0,
      liked: userInteractions.has("like"),
      reposted: userInteractions.has("repost"),
      bookmarked: userInteractions.has("bookmark"),
      createdAt: p.createdAt,
    };
  });

  return NextResponse.json(result);
}

// POST /api/posts — create a post
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { text, mediaUrl, media: rawMedia, visibility: rawVisibility } = await req.json();
  const visibility = ["public", "followers", "private"].includes(rawVisibility) ? rawVisibility : "public";
  const { media, error: mediaError } = validateMedia(rawMedia);
  if (mediaError) return NextResponse.json({ error: mediaError }, { status: 400 });

  const cleanText = typeof text === "string" ? text.trim() : "";
  if (!cleanText && media.length === 0 && !mediaUrl) {
    return NextResponse.json({ error: "Write something or attach a file" }, { status: 400 });
  }
  try {
    assertCleanText(cleanText, "post");
  } catch (err) {
    if (err instanceof ModerationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const db = await getDb();
  const post = {
    authorId: user._id!.toString(),
    text: cleanText.substring(0, 1000),
    mediaUrl: typeof mediaUrl === "string" && mediaUrl ? mediaUrl : null,
    media,
    visibility,
    commentsEnabled: true,
    likes: 0,
    reposts: 0,
    replies: 0,
    createdAt: new Date(),
  };

  const result = await db.collection("posts").insertOne(post);

  return NextResponse.json({
    id: result.insertedId.toString(),
    ...post,
    author: {
      username: user.username || "",
      displayName: user.displayName || user.username || "",
      avatarUrl: user.avatarUrl || "",
    },
    liked: false,
    reposted: false,
    bookmarked: false,
    editedAt: null,
    isOwner: true,
  });
}


/** Posts created before multi-attachment support only carry `mediaUrl` (an image). */
function normalizeMedia(p: Record<string, unknown>): PostMedia[] {
  if (Array.isArray(p.media) && p.media.length > 0) return p.media as PostMedia[];
  if (typeof p.mediaUrl === "string" && p.mediaUrl) {
    return [{ url: p.mediaUrl, type: "image", name: "image", size: 0, mime: "image/*" }];
  }
  return [];
}
