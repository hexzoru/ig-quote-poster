import sharp from "sharp";

const WIDTH = 1080;
const HEIGHT = 1350;

// Free, no credit card required: Cloudflare Workers AI (10,000 free "neurons"/day,
// resets daily at 00:00 UTC). Solid production infrastructure run by Cloudflare,
// unlike Pollinations (chronically unreliable per their own GitHub issues) or
// Gemini's image model (free quota was set to 0 in Dec 2025, requiring billing).
const CF_MODEL = "@cf/black-forest-labs/flux-1-schnell";

function buildPrompt(prompt) {
  return `${prompt}, minimal, aesthetic, soft lighting, no text, no watermark, no people`;
}

async function fetchBackground(prompt) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    throw new Error("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN env vars (free at https://dash.cloudflare.com)");
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_MODEL}`;

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: buildPrompt(prompt),
          steps: 6,
          seed: Math.floor(Math.random() * 1_000_000),
        }),
        signal: AbortSignal.timeout(60000),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(`Cloudflare AI HTTP ${res.status}: ${JSON.stringify(data.errors || data).slice(0, 300)}`);
      }

      const base64 = data.result?.image;
      if (!base64) throw new Error("Cloudflare AI response contained no image data");

      return Buffer.from(base64, "base64");
    } catch (e) {
      lastErr = e;
      console.log(`  Cloudflare AI attempt ${attempt}/3 failed (${e.message})`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
  }
  throw new Error(`Failed to fetch image from Cloudflare AI after 3 attempts: ${lastErr}`);
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text, maxCharsPerLine) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildTextOverlaySvg({ text, fontSize = 62, isClosing = false }) {
  const lines = wrapText(text, isClosing ? 26 : 20);
  const lineHeight = fontSize * 1.25;
  const totalTextHeight = lines.length * lineHeight;
  const startY = HEIGHT / 2 - totalTextHeight / 2 + fontSize / 2;

  const tspans = lines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      return `<text x="50%" y="${y}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
        font-size="${fontSize}" font-weight="600" fill="#ffffff" style="paint-order: stroke;">
        ${escapeXml(line)}
      </text>`;
    })
    .join("\n");

  return `
  <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="dim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.15"/>
        <stop offset="50%" stop-color="#000000" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.15"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#dim)"/>
    ${tspans}
  </svg>`;
}

export async function generateSlideImage({ text, imagePrompt, isClosing = false }) {
  const bgBuffer = await fetchBackground(imagePrompt);

  const svgOverlay = Buffer.from(
    buildTextOverlaySvg({ text, fontSize: isClosing ? 48 : 62, isClosing })
  );

  const finalImage = await sharp(bgBuffer)
    .resize(WIDTH, HEIGHT, { fit: "cover" })
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return finalImage;
}
