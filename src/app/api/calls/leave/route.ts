// POST /api/calls/leave?callId=... — a `navigator.sendBeacon`-friendly alias of
// DELETE /api/calls. Beacons can only POST, and they are the one thing that
// still fires when the tab is closing, so this is how a call is handed back
// before the browser goes away.
export { DELETE as POST } from "../route";
