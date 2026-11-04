// Netlify Function: uploads scans to ONE Google Drive folder owned by your storage account.
//
// Every request must carry the signed-in user's Firebase ID token. The function:
//   1. verifies the token with Firebase,
//   2. checks the user's role in Firestore (owner, admin or editor only),
//   3. talks to Google Drive using the storage account's refresh token (kept in Netlify env vars).
//
// No npm packages needed. Uses Node's built-in fetch.

const env = (k) => process.env[k] || "";
const FOLDER_NAME = env("DRIVE_FOLDER_NAME") || "Permit Scans";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_BYTES = 15 * 1024 * 1024;          // 15 MB per file
const RELAY_MAX_BYTES = 4 * 1024 * 1024;     // files up to this size go through this function
const FILE_FIELDS = "id,name,mimeType,size,webViewLink";

let tokenCache = { value: null, expires: 0 };
let folderCache = null;

const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- who is calling? ---------- */
async function verifyUser(idToken) {
  const r = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(env("FIREBASE_API_KEY")),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) }
  );
  if (!r.ok) return null;
  const d = await r.json();
  const u = d.users && d.users[0];
  if (!u || !u.email || !u.emailVerified) return null;
  return u.email.toLowerCase();
}

// Reads the caller's own members/{email} document AS the caller, so Firestore rules apply.
async function roleOf(email, idToken) {
  const url =
    "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(env("FIREBASE_PROJECT_ID")) +
    "/databases/(default)/documents/members/" + encodeURIComponent(email);
  const r = await fetch(url, { headers: { Authorization: "Bearer " + idToken } });
  if (!r.ok) return null;
  const d = await r.json();
  return (d.fields && d.fields.role && d.fields.role.stringValue) || null;
}

/* ---------- Google Drive ---------- */
async function driveToken() {
  if (tokenCache.value && Date.now() < tokenCache.expires - 60000) return tokenCache.value;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: env("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    throw new HttpError(502, "Google Drive authorization failed (" + (d.error || r.status) +
      "). The storage account’s refresh token may be missing, expired or revoked.");
  }
  tokenCache = { value: d.access_token, expires: Date.now() + (d.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

async function driveJson(url, token, options) {
  const r = await fetch(url, Object.assign({}, options, {
    headers: Object.assign({ Authorization: "Bearer " + token }, (options && options.headers) || {}),
  }));
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (d.error && (d.error.message || d.error)) || r.status;
    throw new HttpError(502, "Google Drive error: " + msg);
  }
  return d;
}

// Finds (or creates once) the scan folder. With the narrow drive.file scope the app can only
// see folders and files it created itself, so it creates its own folder on first use.
async function getFolderId(token) {
  if (folderCache) return folderCache;
  const safeName = FOLDER_NAME.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = "mimeType='application/vnd.google-apps.folder' and name='" + safeName + "' and trashed=false";
  const found = await driveJson(
    "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({ q, fields: "files(id)", pageSize: "1", spaces: "drive" }),
    token
  );
  if (found.files && found.files[0]) { folderCache = found.files[0].id; return folderCache; }

  const created = await driveJson("https://www.googleapis.com/drive/v3/files?fields=id", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  // Anyone with the link can view. Files placed in the folder inherit this.
  await driveJson("https://www.googleapis.com/drive/v3/files/" + created.id + "/permissions", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  folderCache = created.id;
  return folderCache;
}

function cleanName(name) {
  const n = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 120);
  return n || "scan";
}
function checkType(mime) {
  if (ALLOWED_TYPES.indexOf(mime) < 0) throw new HttpError(400, "Only JPG, PNG, WebP and PDF files are allowed.");
}
function shape(f) {
  return { id: f.id, name: f.name, mime: f.mimeType, size: Number(f.size) || 0, url: f.webViewLink };
}

/* ---------- actions ---------- */
async function uploadSmall(body) {
  const name = cleanName(body.name), mime = String(body.mime || "");
  checkType(mime);
  if (typeof body.data !== "string" || !body.data) throw new HttpError(400, "No file data.");
  const buf = Buffer.from(body.data, "base64");
  if (buf.length === 0) throw new HttpError(400, "The file is empty.");
  if (buf.length > RELAY_MAX_BYTES) throw new HttpError(413, "File is too large for this upload path.");

  const token = await driveToken();
  const folderId = await getFolderId(token);
  const boundary = "permit" + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name, parents: [folderId] });
  const payload = Buffer.concat([
    Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
      "\r\n--" + boundary + "\r\nContent-Type: " + mime + "\r\n\r\n"),
    buf,
    Buffer.from("\r\n--" + boundary + "--"),
  ]);
  const f = await driveJson(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=" + FILE_FIELDS,
    token,
    { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body: payload }
  );
  return shape(f);
}

// For bigger files: create a resumable upload session; the browser sends the file straight to Google.
async function startSession(body, origin) {
  const name = cleanName(body.name), mime = String(body.mime || ""), size = Number(body.size);
  checkType(mime);
  if (!size || size < 1) throw new HttpError(400, "The file is empty.");
  if (size > MAX_BYTES) throw new HttpError(413, "Files can be up to 15 MB.");

  const token = await driveToken();
  const folderId = await getFolderId(token);
  const r = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=" + FILE_FIELDS,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime,
        "X-Upload-Content-Length": String(size),
        Origin: origin, // lets the browser upload to the session URL and read the reply
      },
      body: JSON.stringify({ name, parents: [folderId] }),
    }
  );
  const sessionUrl = r.headers.get("location");
  if (!r.ok || !sessionUrl) throw new HttpError(502, "Google Drive didn’t start the upload (" + r.status + ").");
  return { sessionUrl };
}

async function deleteFile(body) {
  const id = String(body.id || "");
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new HttpError(400, "Bad file id.");
  const token = await driveToken();
  const folderId = await getFolderId(token);

  const info = await fetch("https://www.googleapis.com/drive/v3/files/" + id + "?fields=parents", {
    headers: { Authorization: "Bearer " + token },
  });
  if (info.status === 404) return { deleted: true };           // already gone
  const d = await info.json().catch(() => ({}));
  if (!info.ok) throw new HttpError(502, "Google Drive error: " + ((d.error && d.error.message) || info.status));
  if (!d.parents || d.parents.indexOf(folderId) < 0) throw new HttpError(403, "That file isn’t in the scan folder.");

  const del = await fetch("https://www.googleapis.com/drive/v3/files/" + id, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
  });
  if (!del.ok && del.status !== 404) throw new HttpError(502, "Couldn’t delete the file (" + del.status + ").");
  return { deleted: true };
}

/* ---------- entry point ---------- */
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const missing = ["FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]
    .filter((k) => !env(k));
  if (missing.length) return json(500, { error: "The upload service isn’t configured yet. Missing: " + missing.join(", ") });

  try {
    const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!idToken) throw new HttpError(401, "Please sign in again.");
    const email = await verifyUser(idToken);
    if (!email) throw new HttpError(401, "Your sign-in has expired. Please sign in again.");
    const role = await roleOf(email, idToken);
    if (["owner", "admin", "editor"].indexOf(role) < 0) throw new HttpError(403, "Your role can’t upload or remove scans.");

    let body;
    try { body = await req.json(); } catch (e) { throw new HttpError(400, "Bad request."); }

    switch (body.action) {
      case "upload": return json(200, await uploadSmall(body));
      case "start": return json(200, await startSession(body, new URL(req.url).origin));
      case "delete": return json(200, await deleteFile(body));
      default: throw new HttpError(400, "Unknown action.");
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error(e);
    return json(status, { error: e.message || "Something went wrong." });
  }
};
