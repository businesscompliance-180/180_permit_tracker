# Permit tracker: setup guide

A web app with Google sign-in, a shared live database (Firebase), and **in-app scan uploads that are saved to Google Drive automatically**. Hosted on Netlify.

```
permit-tracker/
  index.html                  the app
  firebase-config.js          YOUR Firebase settings (you edit this)
  firestore.rules             access rules (you edit one line, then paste into Firebase)
  netlify.toml                Netlify settings (no changes needed)
  netlify/functions/drive.mjs the upload service (no changes needed)
  README.md                   this guide
```

## How uploads work

1. In the Add permit form, a user clicks **Upload scan** and picks a JPG, PNG or PDF. Large photos are shrunk in the browser first.
2. The file goes to a small Netlify Function. The function checks the user is signed in and is an Owner, Admin or Editor, then saves the file into one Google Drive folder owned by your **storage account**.
3. The permit stores the file's link. Anyone on the team opens it from the permit with one click.
4. The storage account's Google credentials live only in Netlify environment variables. They never reach the browser.

You never open Drive yourself. The app creates the folder (named **Permit Scans**) in the storage account the first time someone uploads, and sets it to "anyone with the link can view".

Plan about 45 minutes for the first setup. Do the steps in order.

---

## Part A. Firebase (sign-in and database)

### A1. Create the project
1. Go to https://console.firebase.google.com and **Create a project**. Analytics can be off.
2. **Build, then Authentication, then Get started.** Under **Sign-in method**, enable **Google**.
3. **Build, then Firestore Database, then Create database.** Pick a nearby location and start in **production mode**.

### A2. Get your web app settings
1. Gear icon, **Project settings**, then under **Your apps** click the web icon (`</>`). Register an app (no Firebase Hosting needed).
2. Copy the `firebaseConfig` values into `firebase-config.js`: `apiKey`, `authDomain`, `projectId`, `appId`. Also set `ownerEmail` to the Google account that will be the Owner (lowercase).

These values are not secret. The rules in the next step protect your data.

### A3. Publish the security rules
1. In `firestore.rules`, replace `PASTE_YOUR_GMAIL@gmail.com` with your owner email (lowercase, identical to `firebase-config.js`).
2. Firebase console, **Firestore Database, then Rules.** Paste the file's contents and **Publish**.

---

## Part B. Google Drive access (done once, signed in as the storage account)

Use the Gmail account you want to hold the scans. It can be the same as the owner, or a separate one.

### B1. Create a Google Cloud project and turn on the Drive API
1. Go to https://console.cloud.google.com and sign in as the **storage account**.
2. Create a new project (any name).
3. **APIs & Services, then Library**, search **Google Drive API**, and click **Enable**.

### B2. Set up the consent screen
1. **APIs & Services, then OAuth consent screen** (Google may call this "Google Auth Platform").
2. User type **External**. Fill in the app name and your email.
3. Add the scope `https://www.googleapis.com/auth/drive.file` (under Data Access or Scopes).
4. **Publish the app** so its status is **In production**.

> This matters. While the app is in "Testing", Google expires its refresh token after 7 days and uploads would silently stop. Publishing is what avoids that. You may see an "unverified app" warning when you authorize in B4. Since only you use it, that's fine: click **Advanced, then Go to (app name)**.

### B3. Create the OAuth client
1. **APIs & Services, then Credentials, then Create credentials, then OAuth client ID.**
2. Application type **Web application**.
3. Under **Authorized redirect URIs** add exactly: `https://developers.google.com/oauthplayground`
4. Create it, then copy the **Client ID** and **Client secret**.

### B4. Get the refresh token
1. Open https://developers.google.com/oauthplayground
2. Click the gear icon (top right), tick **Use your own OAuth credentials**, and paste your Client ID and Client secret.
3. In **Step 1**, type the scope `https://www.googleapis.com/auth/drive.file` in the box at the bottom and click **Authorize APIs**. Sign in as the **storage account** and allow access.
4. In **Step 2**, click **Exchange authorization code for tokens**.
5. Copy the **Refresh token**. Treat it like a password.

---

## Part C. Deploy to Netlify

The upload service is a Netlify Function, which needs a deploy method that builds functions. Drag-and-drop is meant for static files only, so use one of these (confirm against Netlify's current docs):

**Option 1: GitHub (recommended).** Put this folder in a GitHub repository. In Netlify choose **Add new site, then Import an existing project**, pick the repository, leave the build command empty and set the publish directory to `.`. Every push redeploys.

**Option 2: Netlify CLI.** Install Node.js, then in this folder run `npx netlify-cli deploy --prod`.

### C1. Add the environment variables
In Netlify: **Site configuration, then Environment variables.** Add these five (mark the secret ones as secret if offered):

| Name | Value |
|---|---|
| `FIREBASE_API_KEY` | the `apiKey` from `firebase-config.js` |
| `FIREBASE_PROJECT_ID` | the `projectId` from `firebase-config.js` |
| `GOOGLE_CLIENT_ID` | from B3 |
| `GOOGLE_CLIENT_SECRET` | from B3 |
| `GOOGLE_REFRESH_TOKEN` | from B4 |

Optional: `DRIVE_FOLDER_NAME` to rename the folder (default `Permit Scans`).

Then **trigger a new deploy** so the function picks them up.

### C2. Authorize your Netlify address in Firebase
Firebase console, **Authentication, then Settings, then Authorized domains, then Add domain.** Add your Netlify address without `https://`, for example `my-permits.netlify.app`. Add any custom domain later as well. Google sign-in won't work until you do.

---

## Part D. First use

1. Open your site and **Sign in with Google** using the owner email. The first sign-in creates your Owner account.
2. In **Team access**, add each teammate's Google email and role.
3. Add a permit, click **Upload scan**, pick a file. It appears in the list with its size when done. Save the permit.
4. Check Drive: the storage account now has a **Permit Scans** folder containing the file.

If you used the earlier single-file version in the same browser and address, a banner offers to import those permits.

---

## On a phone

The app switches to a phone layout on small screens: a tab bar along the bottom (Permits, Dashboard, Settings, Team), a round **+** button to add a permit, forms that slide up from the bottom, and the table turns into a list of cards with a Filters button and a sort menu. Sign out is under **Settings, then Account**.

To keep it handy, open your site in the phone's browser and use **Add to Home Screen** (Share menu on iPhone, browser menu on Android).

## Final or Temporary

Each permit can be ticked **Final** or **Temporary** (or neither). It shows in the table's Stage column and in the permit details, and the table has a Stage filter. **If you already published `firestore.rules` earlier, paste and publish the updated file again**, because the rules now check this field.

## Roles

| Role | Can do |
|---|---|
| Owner | Everything. Cannot be removed. |
| Admin | Manage members, permits, properties, types, and upload or remove scans |
| Editor | Add and edit permits, properties, types, and upload or remove scans |
| Viewer | View permits and open scans |

Someone not on the team list can sign in with Google but sees "No access yet" and can't read data or upload.

## Scan behavior

- **Types and size:** JPG, PNG, WebP or PDF, up to 15 MB each, five per permit.
- **Photos** are resized (longest side 2400 px) and saved as JPEG before upload.
- **Renewing** a permit moves its old scans into the permit's history (the files stay in Drive) and starts the new term with no scans.
- **Removing a scan or deleting a permit** deletes the file from Drive too.
- **Cancelling the form** after uploading discards files uploaded in that session.
- If someone closes the browser tab mid-form, an uploaded file can be left behind in Drive. You can delete stray files in the **Permit Scans** folder.

## Good to know

- **Anyone with a scan's link can open it, even without signing in.** The links are only visible to signed-in team members, but a forwarded link works for whoever receives it. Keep the storage account for scans only, with 2-step verification on.
- **Storage space:** the storage account's Drive quota (15 GB on a free Google account) is shared with its Gmail and Photos.
- **Removing someone** only needs Team access. Scan links they already saw could still work if they saved them.
- **Free tier:** a permit tracker uses very little of Firebase's and Netlify's free limits. Check their current pricing pages for exact numbers.
- **Preferences** (theme, due-soon window, sidebar) are saved per device.
- **Testing on your computer:** run `npx netlify-cli dev` in this folder (it serves the page and the function together). Add `localhost` to Firebase's authorized domains if it isn't there already. A plain file server won't run the upload function.

## Troubleshooting

| What you see | Likely cause |
|---|---|
| "Setup needed" page | `firebase-config.js` still has the `PASTE_` placeholders |
| Google popup says unauthorized domain | C2 not done, or typed with `https://` |
| "Access was denied" after sign-in | Rules not published, or `ownerEmail` differs between the rules file and `firebase-config.js` |
| "No access yet" for a teammate | Their exact Google email isn't in Team access |
| Upload says "The upload service isn't set up" | Site was deployed without functions (drag-and-drop). Redeploy with GitHub or the CLI |
| Upload says "Missing: ..." | An environment variable in C1 is missing. Add it and redeploy |
| "Google Drive authorization failed" | Refresh token expired or revoked. If the consent screen was left in Testing, publish it (B2), then repeat B4 and update `GOOGLE_REFRESH_TOKEN` |
| Small files upload but large PDFs fail | The direct-to-Google path for files over about 3.5 MB is blocked or misconfigured. Try a smaller file and tell me, so I can adjust |
