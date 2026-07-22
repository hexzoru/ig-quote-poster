import sharp from "sharp";

const WIDTH = 1080;
const HEIGHT = 1350; // Instagram 4:5 portrait, works well for feed + carousel

// Free, no credit card: Google's Gemini API image generation (Gemini 2.5 Flash Image,
// aka "Nano Banana"). Get a free key at https://aistudio.google.com/apikey
// This is Google-run infrastructure (not a small community project), which is why
// it's used here instead of Pollinations (chronically unreliable per their own
// GitHub issue tracker) or Hugging Face's shifting Inference Providers routing.
const GEMINI_MODEL = "gemini-2.5-flash-image";

function buildPrompt(prompt) {
  return `Generate an image: ${prompt}, minimal, aesthetic, soft lighting, no text, no watermark, no people`;
}

async function fetchBackground(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY env var (get a free one at https://aistudio.google.com/apikey)");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(prompt) }] }],
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        throw new Error(`Gemini API HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
      }

      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find((p) => p.inlineData?.data);
      if (!imagePart) throw new Error("Gemini response contained no image data");

      return Buffer.from(imagePart.inlineData.data, "base64");
    } catch (e) {
      lastErr = e;
      console.log(`  Gemini attempt ${attempt}/3 failed (${e.message})`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
  }
  throw new Error(`Failed to fetch image from Gemini after 3 attempts: ${lastErr}`);
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
