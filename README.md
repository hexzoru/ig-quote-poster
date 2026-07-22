# Daily Instagram Quote Carousel Poster — Setup Guide

This posts an AI-picked quote as a 3-slide carousel to Instagram, once a day, fully automatically,
using only free tools:

- **Groq** (free LLM) — picks the topic and writes the text
- **Pollinations.ai** (free, no key) — generates background art
- **sharp** — overlays the quote text on the image
- **GitHub** — hosts the images publicly + runs the daily job (GitHub Actions)
- **Instagram Graph API** — publishes the carousel (free, no per-call cost)

Total one-time setup time: roughly 30-45 minutes. After that, it runs by itself every day.

---

## Part A — One-time manual setup

### A1. Convert your Instagram to a Professional account
1. Open the Instagram app → Settings → **Account type and tools** (or "Switch to Professional Account").
2. Choose **Creator** or **Business**.
3. When prompted, **link it to a Facebook Page** (create a new empty Page if you don't have one — it costs nothing and can just be a placeholder page).

### A2. Create a Meta Developer app
1. Go to https://developers.facebook.com/apps and log in with the Facebook account tied to that Page.
2. Click **Create App** → choose type **"Other"** → **"Business"**.
3. Once created, on the app dashboard click **Add Product** → find **Instagram Graph API** → **Set Up**.

### A3. Add yourself as a Tester (this is what lets you skip Meta's App Review)
1. In your app dashboard, go to **App roles → Roles**.
2. Add your own Facebook account as an **Administrator** (you're probably already the owner, so this may already be set).
3. Go to **App roles → Instagram Testers** (or similar, naming shifts slightly over time — look for "Instagram" under Roles) and add your own Instagram account as a tester.
4. Accept the tester invite from your Instagram app: Instagram app → Settings → **Apps and websites** → **Tester invites** → Accept.

Because the app stays in **Development Mode** and only touches accounts you personally added, Meta does **not** require the full App Review process — that's only mandatory once other people's accounts use your app.

### A4. Get your Instagram Business Account ID and an access token
1. In the Meta App dashboard, go to **Instagram Graph API → API setup with Instagram business login** (or use **Graph API Explorer** at https://developers.facebook.com/tools/explorer).
2. Select your app, select your Facebook Page, and generate a **User Access Token** with these permissions: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`.
3. This gives you a **short-lived token** (expires in ~1 hour). Exchange it for a **long-lived token** (~60 days) with this call (replace the placeholders):

```
GET https://graph.facebook.com/v21.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id=YOUR_APP_ID
  &client_secret=YOUR_APP_SECRET
  &fb_exchange_token=YOUR_SHORT_LIVED_TOKEN
```

You can run this in a browser or with `curl`. The response's `access_token` is your `IG_ACCESS_TOKEN`.

4. Get your Instagram **Business Account ID**:

```
GET https://graph.facebook.com/v21.0/me/accounts?access_token=YOUR_LONG_LIVED_TOKEN
```

This returns your Page(s). Take the Page's `id`, then call:

```
GET https://graph.facebook.com/v21.0/{page-id}?fields=instagram_business_account&access_token=YOUR_LONG_LIVED_TOKEN
```

The `instagram_business_account.id` in the response is your `IG_USER_ID`.

> ⚠️ **Token expiry reminder:** long-lived tokens last ~60 days and don't auto-refresh. Set yourself a calendar reminder every 50 days to redo step A4.3 (or ask me later and I'll add an auto-refresh job).

### A5. Get a free Groq API key
1. Go to https://console.groq.com → sign up (free) → **API Keys** → **Create API Key**.
2. Copy it — this is your `GROQ_API_KEY`.

### A6. Create the GitHub repo
1. Create a **new public GitHub repo** (public is needed so `raw.githubusercontent.com` image URLs are fetchable by Instagram without auth) — e.g. `ig-quote-poster`.
2. Push this project's code to it (see Part B).

### A7. Add secrets to the GitHub repo
In your repo → **Settings → Secrets and variables → Actions → New repository secret**, add:

| Secret name | Value |
|---|---|
| `GROQ_API_KEY` | from A5 |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` (optional, has a default) |
| `IG_USER_ID` | from A4 |
| `IG_ACCESS_TOKEN` | from A4 |
| `IG_HANDLE` | your `@handle`, appended to captions (optional) |

You do **not** need to add a GitHub token secret — GitHub Actions provides one (`GITHUB_TOKEN`) automatically for committing images back to the repo.

---

## Part B — Push the code and test

```bash
# from inside the ig-quote-poster folder
git init
git remote add origin https://github.com/YOUR_USERNAME/ig-quote-poster.git
git add .
git commit -m "Initial setup"
git branch -M main
git push -u origin main
```

### Test it manually before trusting the schedule
1. In your GitHub repo → **Actions** tab → select **"Daily Instagram Quote Post"** → **Run workflow** (this uses the `workflow_dispatch` trigger already in the YAML).
2. Watch the logs. If something fails, the error will point at exactly which step (content generation, image generation, GitHub upload, or Instagram publish).
3. Check your Instagram profile for the new carousel post.

### Local testing (optional, before pushing)
```bash
npm install
cp .env.example .env   # fill in real values
node --env-file=.env index.js
```

---

## Part C — Adjust the schedule / style

- **Posting time:** edit the `cron` line in `.github/workflows/daily-post.yml`. Cron times are in UTC — e.g. `30 3 * * *` = 9:00 AM IST.
- **Quote style/topics:** edit the prompt in `src/generateContent.js`.
- **Visual style:** edit the descriptive words in `src/generateImage.js`'s `pollinationsUrl()` function, or the font/overlay styling in `buildTextOverlaySvg()`.
- **Number of slides:** the pipeline currently expects exactly 3; if you want more, adjust both the prompt in `generateContent.js` (ask for N slides) and the `main()` loop in `index.js` — no other changes needed since the rest is already dynamic.

---

## Troubleshooting

- **"Graph API error... Invalid OAuth access token"** → your token expired (60-day limit) or wasn't exchanged for a long-lived one. Redo A4.
- **"Media type CAROUSEL... permission denied"** → double check your Instagram account is Professional (Business/Creator) and properly linked to the Facebook Page.
- **Pollinations image looks off / times out** → it's a free shared service and occasionally slow; the code already retries 3 times. You can also swap in Hugging Face's free inference API if you want more consistency.
- **Post looks fine but caption/hashtags missing** → check the `IG_HANDLE` secret and the `caption`/`hashtags` fields Groq returned (log them if debugging).
