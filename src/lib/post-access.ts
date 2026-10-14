import { Db, ObjectId } from "mongodb";
import { sharesWorkspace } from "./workspace-access";

/**
 * Can `userId` see this post?
 *
 * Three independent gates, and all have to pass:
 *  0. A shared workspace with the author — the invite-only rule.
 *  1. The author's account. A private account's posts are for accepted
 *     followers only, whatever the per-post visibility says.
 *  2. The post's own visibility: own posts always, public posts always,
 *     followers-only posts when the viewer follows the author.
 *
 * Gate 1 used to be missing here. `/api/posts` filters private authors out of
 * the feed separately, so listings looked correct — but the comments endpoints
 * rely on this helper alone, which let a non-follower read the comment thread
 * on a private account's "public" post.
 */
export async function canViewPost(
  db: Db,
  post: Record<string, unknown>,
  userId: string
): Promise<boolean> {
  if (post.deletedAt) return false;
  const authorId = String(post.authorId);
  if (authorId === userId) return true;

  // Gate 0 — workspace. WASP is invite-only now, so a post is only visible to
  // people who share a workspace with its author. The comments endpoints lean
  // on this helper alone, so without this check any post id leaked every
  // commenter's identity to a stranger.
  if (!(await sharesWorkspace(db, userId, authorId))) return false;

  const vis = (post.visibility as string | undefined) || "public";
  if (vis === "private") return false;

  // Resolved once and reused by both gates below.
  let follows: boolean | null = null;
  const isFollower = async () => {
    if (follows === null) {
      follows = !!(await db
        .collection("follows")
        .findOne({ followerId: userId, followingId: authorId }));
    }
    return follows;
  };

  if (ObjectId.isValid(authorId)) {
    const author = await db
      .collection("users")
      .findOne({ _id: new ObjectId(authorId) }, { projection: { accountPrivate: 1 } });
    if (author?.accountPrivate && !(await isFollower())) return false;
  }

  if (vis === "public") return true;
  if (vis === "followers") return await isFollower();
  return false;
}
