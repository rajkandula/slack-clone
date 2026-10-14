"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Bell, BellOff, Camera, Check, Globe, Loader2, Lock, LogOut, Mail, MailCheck, Palette, Plus, Shield, User, X } from "lucide-react";
import Link from "next/link";
import { pushEnabled, pushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/push-client";
import { getSavedAccounts, removeAccount, SavedAccount } from "@/lib/accounts";
import { handleAvatarError, prettyAvatar } from "@/lib/avatar";
import ThemeToggle from "./ThemeToggle";
import BackButton from "./BackButton";
import { PostVisibility, VISIBILITY_OPTIONS } from "./PostCard";
import type { WaspUser } from "./WaspShell";

interface SettingsPageProps {
  currentUser: WaspUser;
  onLogout: () => void;
  onUserUpdate: (user: WaspUser) => void;
}


function Section({ icon: Icon, title, children }: { icon: typeof User; title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--border-color)] px-6 py-6 last:border-b-0">
      <h2 className="mb-4 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
        <Icon className="h-4 w-4" /> {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label, value, onChange, onSubmit, prefix, hint, multiline, maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  prefix?: string;
  hint?: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">{label}</label>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] focus-within:border-[var(--accent)]">
          {prefix && <span className="pl-3 text-sm text-[var(--text-muted)]">{prefix}</span>}
          {multiline ? (
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              rows={3}
              maxLength={maxLength}
              className="w-full resize-y bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
            />
          ) : (
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              maxLength={maxLength}
              onKeyDown={(e) => e.key === "Enter" && onSubmit?.()}
              className={`w-full bg-transparent py-2 text-sm text-[var(--text-primary)] outline-none ${prefix ? "pl-0.5 pr-3" : "px-3"}`}
            />
          )}
        </div>
      </div>
      {hint && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

/**
 * Account · Appearance · Posts & privacy · Session.
 *
 * The account fields share one Save action rather than a button each: they all
 * go to the same PUT, and a column of identical buttons made a four-field form
 * look like four separate tasks. The bar only appears once something differs
 * from what is stored, so there is never a Save with nothing to save.
 */
export default function SettingsPage({ currentUser, onLogout, onUserUpdate }: SettingsPageProps) {
  const [displayName, setDisplayName] = useState(currentUser.displayName || "");
  const [username, setUsername] = useState(currentUser.username);
  const [email, setEmail] = useState(currentUser.email || "");
  const [bio, setBio] = useState("");
  /** Last values known to be persisted — the diff against these is what "dirty" means. */
  const [savedAccount, setSavedAccount] = useState({
    displayName: currentUser.displayName || "",
    username: currentUser.username,
    email: currentUser.email || "",
    bio: "",
  });
  const [defaultVisibility, setDefaultVisibility] = useState<PostVisibility>(
    currentUser.preferences?.defaultPostVisibility ?? "public"
  );
  const [accountPrivate, setAccountPrivate] = useState<boolean>(!!currentUser.accountPrivate);
  const [notifOn, setNotifOn] = useState(false);
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifNote, setNotifNote] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);

  // Email verification (codes delivered by Harakumo Mail)
  const [emailVerified, setEmailVerified] = useState(!!currentUser.emailVerified);
  const [verifyStage, setVerifyStage] = useState<"idle" | "sent">("idle");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyNote, setVerifyNote] = useState("");

  const sendVerifyCode = async () => {
    setVerifyBusy(true);
    setError("");
    setVerifyNote("");
    try {
      const res = await fetch("/api/auth/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send the code");
      if (data.alreadyVerified) { setEmailVerified(true); return; }
      setVerifyStage("sent");
      setVerifyNote(`Code sent to ${data.sentTo} — it expires in ${data.expiresInMinutes} minutes.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code");
    } finally {
      setVerifyBusy(false);
    }
  };

  const confirmVerifyCode = async () => {
    if (verifyCode.length !== 6) return;
    setVerifyBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", code: verifyCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That code isn't right");
      setEmailVerified(true);
      setVerifyStage("idle");
      setVerifyCode("");
      setVerifyNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code isn't right");
    } finally {
      setVerifyBusy(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setAccounts(getSavedAccounts()), 0);
    return () => clearTimeout(t);
  }, []);

  const switchTo = async (acc: SavedAccount) => {
    if (acc.id === currentUser.id || switching) return;
    setSwitching(acc.id);
    const res = await fetch("/api/auth/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: acc.token }),
    });
    if (!res.ok) {
      removeAccount(acc.id);
      setAccounts(getSavedAccounts());
      setSwitching(null);
      window.location.assign("/login?add=1");
      return;
    }
    window.location.assign("/");
  };

  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    pushEnabled().then(setNotifOn).catch(() => {});
    fetch("/api/auth/me").then(r => r.json()).then(d => setIsAdmin(d.user?.role === "admin")).catch(() => {});
  }, []);

  const toggleNotifications = async () => {
    setNotifBusy(true);
    setNotifNote("");
    try {
      if (notifOn) {
        await unsubscribeFromPush();
        setNotifOn(false);
      } else {
        const result = await subscribeToPush();
        if (result === "subscribed") setNotifOn(true);
        else if (result === "denied") setNotifNote("Notifications are blocked for this site — allow them in your browser settings.");
        else if (result === "unsupported") setNotifNote("This browser doesn't support notifications. On iPhone, install WASP to your Home Screen first.");
        else setNotifNote("Notifications aren't configured on the server.");
      }
    } catch {
      setNotifNote("Couldn't update notifications — try again.");
    } finally {
      setNotifBusy(false);
    }
  };

  // Bio isn't on the shell's user object; fetch once.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const d = await res.json();
          setBio(d.user?.bio || "");
          setSavedAccount((prev) => ({
            ...prev,
            bio: d.user?.bio || "",
            displayName: d.user?.displayName || prev.displayName,
            username: d.user?.username || prev.username,
            email: d.user?.email || "",
          }));
          if (d.user?.preferences?.defaultPostVisibility) setDefaultVisibility(d.user.preferences.defaultPostVisibility);
          setAccountPrivate(!!d.user?.accountPrivate);
          setEmailVerified(!!d.user?.emailVerified);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const save = async (section: string, body: Record<string, unknown>): Promise<boolean> => {
    setSaving(section);
    setSaved(null);
    setError("");
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      onUserUpdate({
        ...currentUser,
        username: data.user.username,
        displayName: data.user.displayName,
        email: data.user.email,
        avatarUrl: data.user.avatarUrl,
        preferences: data.user.preferences,
        accountPrivate: data.user.accountPrivate,
        emailVerified: data.user.emailVerified,
      });
      if (typeof data.user.emailVerified === "boolean") setEmailVerified(data.user.emailVerified);
      setSaved(section);
      setTimeout(() => setSaved((s) => (s === section ? null : s)), 2500);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      return false;
    } finally {
      setSaving(null);
    }
  };

  const accountDirty =
    displayName !== savedAccount.displayName ||
    username !== savedAccount.username ||
    email !== savedAccount.email ||
    bio !== savedAccount.bio;

  /**
   * Saves every account field that actually changed, in one request.
   *
   * Sending only the diff matters: PUT /api/auth/profile marks the address
   * unverified whenever `email` differs from the stored one, so posting an
   * unchanged email back would silently cost the user their verified status.
   */
  const saveAccount = async () => {
    if (!accountDirty) return;
    const body: Record<string, unknown> = {};
    if (displayName !== savedAccount.displayName) body.displayName = displayName;
    if (username !== savedAccount.username) body.username = username;
    if (email !== savedAccount.email) body.email = email;
    if (bio !== savedAccount.bio) body.bio = bio;

    const ok = await save("account", body);
    if (ok) setSavedAccount({ displayName, username, email, bio });
  };

  const discardAccount = () => {
    setDisplayName(savedAccount.displayName);
    setUsername(savedAccount.username);
    setEmail(savedAccount.email);
    setBio(savedAccount.bio);
    setError("");
  };

  const changeAvatar = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
      setError("Please choose an image");
      return;
    }
    setAvatarBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/media/upload", { method: "POST", body: fd });
      const upData = await up.json();
      if (!up.ok) throw new Error(upData.error || "Upload failed");
      await save("avatar", { avatarUrl: upData.mediaUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-hidden">
      <div className="mx-auto h-full max-w-[720px] overflow-y-auto border-x border-[var(--border-color)]">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--border-color)] bg-[var(--bg-header)] px-4 py-3 backdrop-blur">
          <BackButton fallback="/profile" />
          <div>
            <h1 className="text-xl font-extrabold text-[var(--text-primary)]">Settings</h1>
            <p className="text-xs text-[var(--text-muted)]">Manage your account, appearance and privacy</p>
          </div>
        </div>

        {error && (
          <p className="mx-6 mt-4 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>
        )}

        <Section icon={User} title="Account">
          {/* Avatar */}
          <div className="mb-6 flex items-center gap-4">
            <div className="relative">
              <img
                src={prettyAvatar(currentUser.avatarUrl, currentUser.username)}
                onError={(e) => handleAvatarError(e, currentUser.username)}
                alt=""
                className="h-20 w-20 rounded-full object-cover ring-2 ring-[var(--border-color)]"
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={(e) => {
                  changeAvatar(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={avatarBusy}
                title="Change profile picture"
                aria-label="Change profile picture"
                className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-[var(--bg-app)] bg-[var(--accent)] text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
              >
                {avatarBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              </button>
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Profile picture</p>
              <p className="text-xs text-[var(--text-muted)]">JPG, PNG, WebP or HEIC. Optimised automatically.</p>
            </div>
          </div>

          {isAdmin && (
            <Link href="/admin" className="mb-4 flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent-muted)] p-3.5 text-sm font-semibold text-[var(--accent)] transition-colors duration-200 hover:bg-[var(--accent)] hover:text-[var(--text-on-accent)]">
              <Shield className="h-4 w-4" /> Open the company admin dashboard
            </Link>
          )}
          <Field label="Display name" value={displayName} onChange={setDisplayName} onSubmit={saveAccount} maxLength={50} />
          <Field
            label="Username"
            prefix="@"
            value={username}
            onChange={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
            onSubmit={saveAccount}
            maxLength={20}
            hint="3–20 characters, letters, numbers and underscores. People mention you with this."
          />
          <Field label="Bio" value={bio} onChange={setBio} multiline maxLength={160} />
          <Field label="Email" value={email} onChange={setEmail} onSubmit={saveAccount} />

          {/* One Save for the whole section, shown only when there is something to save. */}
          {accountDirty && (
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={saveAccount}
                disabled={saving === "account"}
                className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                {saving === "account" && <Loader2 className="h-4 w-4 animate-spin" />}
                Save changes
              </button>
              <button
                type="button"
                onClick={discardAccount}
                disabled={saving === "account"}
                className="h-9 cursor-pointer rounded-lg px-3 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-60"
              >
                Discard
              </button>
            </div>
          )}
          {saved === "account" && !accountDirty && (
            <p className="mb-4 flex items-center gap-1.5 text-sm text-[var(--color-online)]">
              <Check className="h-4 w-4" /> Saved
            </p>
          )}

          {/* Email verification — what makes code sign-in and password reset trustworthy */}
          <div className="-mt-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3">
            {emailVerified ? (
              <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <MailCheck className="h-4 w-4 text-[var(--color-online)]" />
                <span><strong className="font-semibold text-[var(--text-primary)]">Email verified.</strong> You can sign in with a code and reset your password.</span>
              </p>
            ) : verifyStage === "sent" ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-[var(--text-muted)]">{verifyNote}</p>
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    inputMode="numeric"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={(e) => e.key === "Enter" && confirmVerifyCode()}
                    placeholder="000000"
                    className="w-32 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-center text-sm font-bold tracking-[0.3em] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    onClick={confirmVerifyCode}
                    disabled={verifyBusy || verifyCode.length !== 6}
                    className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
                  >
                    {verifyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Verify
                  </button>
                  <button
                    type="button"
                    onClick={sendVerifyCode}
                    disabled={verifyBusy}
                    className="cursor-pointer text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    Resend
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <AlertCircle className="h-4 w-4 text-[var(--warning)]" />
                  <span><strong className="font-semibold text-[var(--text-primary)]">Email not verified.</strong> Verify it to sign in with a code and reset your password.</span>
                </p>
                <button
                  type="button"
                  onClick={sendVerifyCode}
                  disabled={verifyBusy || !email}
                  className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
                >
                  {verifyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Verify
                </button>
              </div>
            )}
          </div>
        </Section>

        <Section icon={Palette} title="Appearance">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Theme</p>
              <p className="text-xs text-[var(--text-muted)]">Light, dark, or follow your system</p>
            </div>
            <ThemeToggle />
          </div>
        </Section>

        <Section icon={Shield} title="Posts & privacy">
          {/* Push notifications */}
          <div className="mb-5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  {notifOn ? <Bell className="h-4 w-4 text-[var(--accent)]" /> : <BellOff className="h-4 w-4 text-[var(--text-muted)]" />}
                  Notifications
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {notifOn
                    ? "This device gets notified about new messages and incoming calls, even with WASP closed."
                    : "Get notified about new messages and incoming calls, even with WASP closed."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifOn}
                disabled={notifBusy || !pushSupported()}
                onClick={toggleNotifications}
                className={[
                  "relative box-border h-[26px] w-[46px] shrink-0 cursor-pointer self-center rounded-full border-0 p-0 transition-colors disabled:opacity-60",
                  notifOn ? "bg-[var(--accent)]" : "bg-[var(--layer-4)]",
                ].join(" ")}
              >
                <span
                  aria-hidden
                  className="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-[left]"
                  style={{ left: notifOn ? 23 : 3 }}
                />
              </button>
            </div>
            {notifNote && <p className="mt-2 text-xs text-[var(--danger)]">{notifNote}</p>}
          </div>

          {/* Private account */}
          <div className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                {accountPrivate ? <Lock className="h-4 w-4 text-[var(--accent)]" /> : <Globe className="h-4 w-4 text-[var(--text-muted)]" />}
                Private account
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {accountPrivate
                  ? "People must send a follow request; only accepted followers can see your profile and posts."
                  : "Anyone can find you in Explore, view your profile, and follow you instantly."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={accountPrivate}
              disabled={saving === "accountPrivate"}
              onClick={() => {
                const next = !accountPrivate;
                setAccountPrivate(next);
                save("accountPrivate", { accountPrivate: next });
              }}
              className={[
                "relative box-border h-[26px] w-[46px] shrink-0 cursor-pointer self-center rounded-full border-0 p-0 transition-colors disabled:opacity-60",
                accountPrivate ? "bg-[var(--accent)]" : "bg-[var(--layer-4)]",
              ].join(" ")}
            >
              <span
                aria-hidden
                className="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-[left]"
                style={{ left: accountPrivate ? 23 : 3 }}
              />
            </button>
          </div>

          <p className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Default audience for new posts</p>
          <p className="mb-3 text-xs text-[var(--text-muted)]">You can still change it per post from the composer.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {VISIBILITY_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  setDefaultVisibility(o.value);
                  save("visibility", { preferences: { defaultPostVisibility: o.value } });
                }}
                aria-pressed={defaultVisibility === o.value}
                className={[
                  "flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  defaultVisibility === o.value
                    ? "border-[var(--accent)] bg-[var(--accent-muted)]"
                    : "border-[var(--border-color)] bg-[var(--bg-surface)] hover:border-[var(--accent-ring)]",
                ].join(" ")}
              >
                <o.Icon className={`mt-0.5 h-4 w-4 ${defaultVisibility === o.value ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`} />
                <span>
                  <span className="block text-sm font-semibold text-[var(--text-primary)]">{o.label}</span>
                  <span className="block text-[11px] leading-snug text-[var(--text-muted)]">{o.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </Section>

        <Section icon={Mail} title="Accounts & session">
          <p className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Accounts on this device</p>
          <p className="mb-3 text-xs text-[var(--text-muted)]">Switch instantly between accounts you&apos;ve signed into here.</p>
          <ul className="mb-4 overflow-hidden rounded-xl border border-[var(--border-color)]">
            {accounts.map((a) => {
              const active = a.id === currentUser.id;
              return (
                <li key={a.id} className="flex items-center gap-3 border-b border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 last:border-b-0">
                  <img src={prettyAvatar(a.avatarUrl, a.username)} onError={(e) => handleAvatarError(e, a.username)} alt="" className="h-9 w-9 rounded-full object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{a.displayName || a.username}{active ? " (current)" : ""}</p>
                    <p className="truncate text-xs text-[var(--text-muted)]">@{a.username}</p>
                  </div>
                  {active ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-[var(--accent)]"><Check className="h-3.5 w-3.5" /> Active</span>
                  ) : (
                    <>
                      <button type="button" onClick={() => switchTo(a)} disabled={!!switching} className="cursor-pointer rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60">
                        {switching === a.id ? "Switching…" : "Switch"}
                      </button>
                      <button type="button" onClick={() => { removeAccount(a.id); setAccounts(getSavedAccounts()); }} title="Forget on this device" aria-label={`Forget @${a.username}`} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
            <li>
              <button type="button" onClick={() => window.location.assign("/login?add=1")} className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left text-sm font-semibold text-[var(--accent)] hover:bg-[var(--bg-surface-hover)]">
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-[var(--border-color-active)]"><Plus className="h-4 w-4" /></span>
                Add another account
              </button>
            </li>
          </ul>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Signed in as @{currentUser.username}</p>
              <p className="text-xs text-[var(--text-muted)]">Log out on this device</p>
            </div>
            <button
              type="button"
              onClick={() => { removeAccount(currentUser.id); onLogout(); }}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-sm font-semibold text-[var(--danger)] hover:opacity-90"
            >
              <LogOut className="h-4 w-4" /> Log out
            </button>
          </div>
        </Section>
        <div className="h-10" />
      </div>
    </div>
  );
}

