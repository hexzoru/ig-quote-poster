import sharp from "sharp";

const WIDTH = 1080;
const HEIGHT = 1350; // Instagram 4:5 portrait, works well for feed + carousel

// Free, no API key: https://pollinations.ai
function pollinationsUrl(prompt, seed) {
  const encoded = encodeURIComponent(
    `${prompt}, minimal, aesthetic, soft lighting, no text, no watermark, no people`
  );
  return `https://image.pollinations.ai/prompt/${encoded}?width=${WIDTH}&height=${HEIGHT}&nologo=true&seed=${seed}`;
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

// Downloads the Pollinations image with a couple of retries (it can be briefly slow on cold start)
async function fetchBackground(prompt, seed) {
  const url = pollinationsUrl(prompt, seed);
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw new Error(`Failed to fetch Pollinations image after retries: ${lastErr}`);
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
