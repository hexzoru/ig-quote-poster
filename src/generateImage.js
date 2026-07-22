import sharp from "sharp";

const WIDTH = 1080;
const HEIGHT = 1350; // Instagram 4:5 portrait, works well for feed + carousel

// Free, no signup required: https://image.pollinations.ai/prompt/{prompt}
// (the newer gen.pollinations.ai endpoint requires an account/bearer token, so we
// deliberately use this simpler legacy endpoint which stays free/anonymous.)
function pollinationsUrl(prompt, seed) {
  const encoded = encodeURIComponent(
    `${prompt}, minimal, aesthetic, soft lighting, no text, no watermark, no people`
  );
  return `https://image.pollinations.ai/prompt/${encoded}?width=${WIDTH}&height=${HEIGHT}&seed=${seed}&model=flux`;
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Simple word-wrap: breaks text into lines under maxCharsPerLine
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

// Downloads the Pollinations image with exponential backoff.
// Pollinations is a free shared service and its image models throw intermittent
// 500s under load - this is a known, documented issue on their end, not a bug in
// this code. A new seed is used on each retry since a fresh generation sometimes
// succeeds where a retried identical one fails.
async function fetchBackground(prompt, seed) {
  let lastErr;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptSeed = seed + attempt; // vary seed per retry
    const url = pollinationsUrl(prompt, attemptSeed);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      if (buf.length < 1000) throw new Error("Pollinations returned an empty/invalid image");
      return buf;
    } catch (e) {
      lastErr = e;
      const backoffMs = Math.min(2000 * 2 ** (attempt - 1), 30000); // 2s,4s,8s,16s,30s
      console.log(`  Pollinations attempt ${attempt}/${maxAttempts} failed (${e.message}), retrying in ${backoffMs / 1000}s...`);
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw new Error(`Failed to fetch Pollinations image after ${maxAttempts} attempts: ${lastErr}`);
}

/**
 * Generates one finished carousel slide (background + text overlay) as a PNG buffer.
 * @param {{text: string, imagePrompt: string, isClosing?: boolean, seed?: number}} opts
 */
export async function generateSlideImage({ text, imagePrompt, isClosing = false, seed }) {
  const finalSeed = seed ?? Math.floor(Math.random() * 1_000_000);
  const bgBuffer = await fetchBackground(imagePrompt, finalSeed);

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
