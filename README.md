# Drive Clone

A Google Drive-style cloud file storage app.

- **Frontend:** React + TypeScript + Vite + Tailwind CSS + Lucide icons
- **Backend:** Hono (Node.js) + Zod
- **Database:** MongoDB via Prisma
- **File storage:** a folder on your computer (default), or Cloudflare R2 (S3-compatible, private bucket). Switch with `STORAGE_DRIVER` in `.env`.

## Features

- Email/password accounts (Argon2 hashing, HttpOnly session cookies, rate-limited login)
- Upload one or many files (button or drag-and-drop) with progress bars and cancel
- Grid and list views, sort by name / upload date / size, search by name
- Preview images, PDFs, video, audio and text; download via short-lived signed URLs
- Rename, move, star, and details panel; right-click context menu with keyboard support
- Folders and subfolders with breadcrumbs
- Recent, Starred, Trash (restore, delete forever, empty Trash)
- Storage usage indicator (5 GB per user by default)

---

## 1. Architecture

```
Browser (React)  ──/api/*──▶  Vite dev proxy  ──▶  Hono API (Node, :3001)
                                                    │            │
                                                 Prisma      AWS S3 SDK
                                                    ▼            ▼
                                       MongoDB (replica set)  server/storage/ folder  (STORAGE_DRIVER=local)
                                                              or Cloudflare R2   (STORAGE_DRIVER=r2)
```

- **Local storage (default):** files are saved in `server/storage/users/<userId>/<uuid>`. Downloads and previews use links like `/api/blobs/file?...&sig=...` that are signed by the server (HMAC) and expire after a few minutes, which works the same way as R2's presigned URLs.

- The browser **never** talks to R2 with credentials.
  - Uploads go through the API, which checks type, size and quota, then streams the file to R2.
  - Downloads and previews use **signed URLs that expire after 60 seconds to 5 minutes**.
- Every database query filters by the logged-in user's id, which comes from the session and never from the request.
  - Someone else's file or folder returns **404**, so attackers can't even learn that an id exists.
- Deleting moves items to **Trash**.
  - Deleting a folder trashes everything inside it, and restoring the folder brings it all back.
  - "Delete forever" removes the R2 objects first, then the database documents.

## 2. Project structure

```
drive-clone/
├── package.json            # npm workspaces + `npm run dev` (runs both apps)
├── server/
│   ├── .env.example        # copy to .env
│   ├── prisma/schema.prisma  # MongoDB models + indexes
│   ├── scripts/local-mongo.ts  # `npm run db:local`: MongoDB without installing it
│   ├── src/
│   │   ├── index.ts        # starts the server
│   │   ├── app.ts          # Hono app: security headers, CORS, CSRF, routes
│   │   ├── env.ts          # validated environment variables
│   │   ├── lib/            # db, storage (R2), sessions, passwords, rate limit, mime, filenames
│   │   ├── middleware/     # requireAuth, error handler
│   │   ├── schemas/        # Zod request schemas
│   │   ├── services/       # business logic: files, folders, trash
│   │   └── routes/         # auth, files, folders, trash/storage
│   └── tests/              # Vitest: auth, ownership isolation, files/folders/trash, uploads
└── web/
    ├── vite.config.ts      # dev proxy /api → :3001
    └── src/
        ├── api/            # fetch wrapper, typed endpoints, XHR upload with progress
        ├── context/        # Auth, Toasts, Drive (refresh, uploads, view mode, usage)
        ├── hooks/          # useLoader
        ├── components/     # layout/, files/, dialogs/, ui/
        └── pages/          # Drive, Recent, Starred, Trash, Search, Login/Signup
```

---

## 3. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 or newer | `node -v` |
| MongoDB | 6 or newer, **as a replica set** | Nothing to install for development: `npm run db:local` downloads and runs it. Or use free **MongoDB Atlas** (cloud). |
| Cloudflare account | — | R2 has a free tier (10 GB) but requires a payment method on file |

## 4. Setup

### 4.1 Install dependencies

```bash
cd drive-clone
npm install
```

npm 11+ blocks package install scripts by default. Prisma and esbuild need theirs, and they're already approved in the root `package.json` (`allowScripts`). If npm still warns, run:

```bash
npm install-scripts approve prisma @prisma/client @prisma/engines esbuild
npm rebuild
```

### 4.2 Start MongoDB

Prisma needs MongoDB to run as a **replica set**, because it uses transactions. Pick one option.

**Option A: local, no installation (recommended for development).** In its own terminal, run:

```bash
npm run db:local
```

- The first run downloads the MongoDB server (about 100 MB, cached in your user folder).
- MongoDB runs on `127.0.0.1:27017` as replica set `rs0`.
- Data is saved in `server/.mongo-data/` (git-ignored) and kept between runs.
- Keep this terminal open while you use the app, and stop it with Ctrl+C.

**Option B: MongoDB Atlas (free cloud).**
1. Create a free M0 cluster at mongodb.com/atlas. Atlas clusters are always replica sets.
2. Under **Database Access**, create a database user.
3. Under **Network Access**, allow your IP address.
4. Click **Connect → Drivers** and copy the connection string.
5. Add the database name `drive_clone` before the `?`, for example:
   ```
   mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/drive_clone?retryWrites=true&w=majority
   ```

A normal standalone `mongod` (for example a default Windows MongoDB service install) will **not** work unless you configure it as a replica set.

### 4.3 File storage

By default (`STORAGE_DRIVER=local`) uploaded files are stored in `server/storage/` on your computer, so **no setup is needed**. Back this folder up together with your database. It is git-ignored.

To use **Cloudflare R2** instead, follow the steps below, then set `STORAGE_DRIVER=r2` and fill in the four `R2_` values in `server/.env`. Files already stored locally are not copied to R2 automatically.

1. In the Cloudflare dashboard, open **R2 Object Storage** and enable it.
2. **Create bucket**, named for example `drive-clone`. **Leave public access disabled.**
3. Go to **R2 → Manage API tokens → Create API token**:
   - Permissions: **Object Read & Write**
   - Specify bucket: only `drive-clone`
4. Copy these values:
   - **Account ID**
   - **Access Key ID**
   - **Secret Access Key** (shown only once)

You don't need a CORS rule on the bucket. The browser only loads signed URLs as images, videos, iframes and downloads; it never uploads to R2 directly.

### 4.4 Configure environment variables

```bash
cp server/.env.example server/.env      # Windows PowerShell: copy server\.env.example server\.env
```

Edit `server/.env`:

| Variable | Example | Meaning |
|---|---|---|
| `DATABASE_URL` | `mongodb://127.0.0.1:27017/drive_clone?replicaSet=rs0` | MongoDB connection (the default value matches `npm run db:local`) |
| `WEB_ORIGIN` | `http://localhost:3000` | Where the React app runs (CORS + CSRF) |
| `STORAGE_DRIVER` | `local` | `local` = folder on this computer, `r2` = Cloudflare R2 |
| `LOCAL_STORAGE_DIR` | `./storage` | Where local files go (relative to `server/`) |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | — | Only for `STORAGE_DRIVER=r2` (step 4.3) |
| `MAX_UPLOAD_MB` | `0` | Max size per file in MB; `0` = no limit (uploads are streamed, so big files don't use extra memory) |
| `STORAGE_QUOTA_MB` | `5120` | Storage per user (5 GB) |
| `SESSION_TTL_DAYS` | `7` | Login lifetime (extended while active) |
| `TRUST_PROXY` | `false` | Set `true` only behind a reverse proxy that sets `X-Forwarded-For` |

`.env` is listed in `.gitignore`, so it is never committed. All secrets stay on the server; the React app has no environment variables at all.

### 4.5 Create the indexes

With MongoDB running:

```bash
npm run db:push
```

MongoDB has no tables or SQL migrations, because collections are created automatically. `prisma db push` creates the **indexes** (including the unique index on email) and generates the Prisma client. Run it again whenever you change `schema.prisma`.

### 4.6 Start the app

In a second terminal (keep `npm run db:local` running in the first):

```bash
npm run dev
```

- API: http://localhost:3001
- App: **http://localhost:3000**

Open the app, create an account, and upload some files.

---

## 5. Tests

```bash
npm test
```

The tests start their **own throwaway in-memory MongoDB replica set** and use an **in-memory storage driver**. They need no setup and never touch your real database or R2 bucket. They cover:

- **auth** (`auth.test.ts`):
  - signup, login and logout
  - identical errors for a wrong password and an unknown email
  - session token stored only as a hash
  - expired and forged sessions
  - rate limiting
  - CSRF blocking
- **ownership isolation** (`ownership.test.ts`):
  - user B gets 404 for every read and write on user A's files and folders
  - B can't upload or move items into A's folders
  - an `ownerId` sent in the request body is ignored
- **files / folders / trash** (`files.test.ts`):
  - upload, sorting, duplicate names, rename, preview and download
  - star, recent, search (including special characters like `(` and `.`) and storage usage
  - nested folders, moving, and preventing a folder from being moved into itself
  - Trash: restore, delete forever and empty Trash, including R2 object cleanup
- **upload validation** (`upload.test.ts`):
  - the server decides the MIME type
  - blocked types (`.exe`, `.ps1`, …), size limit and quota
  - filenames containing `..\` or `/`
  - cleanup of already-stored objects when an upload fails part-way
- **local disk storage** (`localStorage.test.ts`):
  - files are written to disk, then served by signed links with the correct headers
  - tampered, forged and expired links are rejected
  - range requests work (video seeking)
  - keys that try to escape the storage folder are rejected
  - files are removed from disk when deleted forever

Other commands:

```bash
npm run typecheck -w server
npm run typecheck -w web
npm run build            # builds server (dist/) and web (web/dist)
```

## 6. Production

1. Set `NODE_ENV=production` and `WEB_ORIGIN=https://your-domain`.
2. Point `DATABASE_URL` at a production MongoDB (for example Atlas), then run `npm run build` and `npm run db:push`.
3. Run `npm start -w server`. In production the Hono server also serves `web/dist`, so the app and API share one origin.
4. Put it behind HTTPS. Cookies are `Secure` and use the `__Host-` prefix in production.

---

## 7. API reference

All endpoints except signup and login require the session cookie. Every error has the same shape:

```json
{ "error": { "code": "NOT_FOUND", "message": "File not found" } }
```

| Method | Path | Body / query | Response |
|---|---|---|---|
| POST | `/api/auth/signup` | `{name,email,password}` | `{user}` 201 |
| POST | `/api/auth/login` | `{email,password}` | `{user}` |
| POST | `/api/auth/logout` | – | `{ok}` |
| GET | `/api/auth/me` | – | `{user}` |
| GET | `/api/files` | `?folderId&sort=name\|date\|size&order=asc\|desc` | `{files}` |
| GET | `/api/files/search` | `?q=` | `{files,folders}` |
| GET | `/api/files/recent` | – | `{files}` |
| GET | `/api/files/starred` | `?sort&order` | `{files}` |
| POST | `/api/files/upload` | multipart `files` (1–20), optional `folderId` | `{files}` 201 |
| GET | `/api/files/:id` | – | `{file}` |
| GET | `/api/files/:id/download` | – | `{url,expiresIn}` (signed, attachment) |
| GET | `/api/files/:id/preview` | – | `{kind,url}` or `{kind:'text',content,truncated}` or `{kind:'none'}` |
| GET | `/api/files/:id/thumbnail` | – | `{url}` (images only) |
| PATCH | `/api/files/:id` | `{name?, folderId?}` | `{file}` (rename / move) |
| POST | `/api/files/:id/star` | `{starred}` | `{file}` |
| DELETE | `/api/files/:id` | – | `{file}` (to Trash) |
| POST | `/api/files/:id/restore` | – | `{file}` |
| DELETE | `/api/files/:id/permanent` | – | `{ok}` (must be in Trash) |
| GET | `/api/folders` | `?parentId&sort&order` | `{folders}` |
| POST | `/api/folders` | `{name,parentId?}` | `{folder}` 201 |
| GET | `/api/folders/:id` | – | `{folder,breadcrumbs}` |
| PATCH | `/api/folders/:id` | `{name?, parentId?}` | `{folder}` |
| DELETE | `/api/folders/:id` | – | `{folder}` (folder + contents to Trash) |
| POST | `/api/folders/:id/restore` | – | `{folder}` |
| DELETE | `/api/folders/:id/permanent` | – | `{ok}` |
| GET | `/api/trash` | – | `{files,folders}` |
| DELETE | `/api/trash` | – | `{deletedFiles,deletedFolders}` |
| GET | `/api/storage/usage` | – | `{used,quota,fileCount,maxUploadBytes}` |

## 8. Security notes

| Concern | How it is handled |
|---|---|
| Passwords | Argon2id, never returned by the API; same login error for unknown email / wrong password, with timing equalised |
| Sessions | 256-bit random token in an `HttpOnly`, `SameSite=Lax` (and `Secure` in prod) cookie; only its SHA-256 is stored; sliding 7-day expiry; logout deletes the row |
| CSRF | `SameSite=Lax` cookies + Hono `csrf()` origin check for form-like requests + strict CORS (JSON requests need a preflight) |
| Brute force | 20 auth attempts per IP per 15 minutes |
| IDOR | Every query filters by `ownerId` from the session; other users' ids return 404 |
| Path traversal | Storage keys are server-generated (`users/<userId>/<uuid>`); names are display-only and sanitised |
| Upload validation | Extension allowlist, MIME decided by the server, optional per-file size limit, per-user quota (checked while streaming), max 20 files per request, all-or-nothing cleanup |
| Active content | HTML/SVG/JS are never rendered: previews show them as plain text in `<pre>`, downloads are forced `attachment`; locally served files also get `nosniff` and a `sandbox` Content-Security-Policy |
| Local file links | HMAC-signed with a per-start random secret, expire in 1–5 minutes, and the key must match `users/<id>/<uuid>`, so no path traversal |
| Storage cleanup | Failed uploads delete already-stored objects; permanent deletes remove R2 objects before DB documents |
| NoSQL injection | Ids must be 24-hex ObjectIds (validated by Zod); search text is regex-escaped before querying |
| Secrets | Only on the server, validated at startup; `.env` is git-ignored |

## 9. Troubleshooting

- **`Invalid environment variables` on start:** `server/.env` is missing or a value is empty.
- **`Server selection timeout` / can't connect to MongoDB:** `npm run db:local` isn't running, or `DATABASE_URL` is wrong.
- **`Transactions are not supported by this deployment` / "replica set" errors:** your MongoDB is a standalone server. Use `npm run db:local` or Atlas instead.
- **Port 27017 already in use:** another MongoDB is running. Stop it, or run `MONGO_PORT=27018 npm run db:local` and change the port in `DATABASE_URL`.
- **Uploads fail with "Could not save the file to cloud storage":** with `STORAGE_DRIVER=r2`, check the R2 keys, account id and bucket name. With `local`, check that the disk isn't full and the folder is writable. The real error is printed in the server terminal.
- **A preview stops loading after you leave it open a long time, or after a server restart:** the signed link expired. Close and reopen the preview.
- **Images or PDFs don't preview:** the signed URL comes from `<account>.r2.cloudflarestorage.com`. Make sure browser extensions aren't blocking it.
- **Logged out unexpectedly:** sessions expire after `SESSION_TTL_DAYS` without activity.
