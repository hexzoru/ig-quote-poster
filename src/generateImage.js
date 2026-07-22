import sharp from "sharp";

const WIDTH = 1080;
const HEIGHT = 1350; // Instagram 4:5 portrait, works well for feed + carousel

// Free (with a free Hugging Face account + token): https://huggingface.co/docs/api-inference
// Pollinations.ai was tried first but has had a long, ongoing history of widespread
// 500 errors across all its models (documented extensively in their own GitHub issue
// tracker from Dec 2025 through mid-2026) - it isn't reliable enough for a daily job.
// Hugging Face's hosted inference for open image models is free and far more stable.
const HF_MODELS = [
  "black-forest-labs/FLUX.1-schnell",
  "stabilityai/stable-diffusion-xl-base-1.0",
];

function buildPrompt(prompt) {
  return `${prompt}, minimal, aesthetic, soft lighting, no text, no watermark, no people`;
}

async function fetchFromHuggingFace(prompt, model, token) {
  const res = await fetch(
    `https://api-inference.huggingface.co/models/${model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: buildPrompt(prompt) }),
      signal: AbortSignal.timeout(90000),
    }
  );

  if (res.status === 503) {
    const body = await res.json().catch(() => ({}));
    const waitSec = Math.min(body.estimated_time ?? 20, 30);
    throw new Error(`HF model ${model} is loading, retry after ~${waitSec}s`);
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`HF API HTTP ${res.status} (model=${model}): ${bodyText.slice(0, 200)}`);
  }

  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  if (buf.length < 1000) throw new Error(`HF API returned an empty/invalid image (model=${model})`);
  return buf;
}

async function fetchBackground(prompt) {
  const token = process.env.HF_API_TOKEN;
  if (!token) throw new Error("Missing HF_API_TOKEN env var (get a free one at https://huggingface.co/settings/tokens)");

  let lastErr;
  for (let attempt = 1; attempt <= HF_MODELS.length; attempt++) {
    const model = HF_MODELS[attempt - 1];
    try {
      return await fetchFromHuggingFace(prompt, model, token);
    } catch (e) {
      lastErr = e;
      console.log(`  HF attempt ${attempt}/${HF_MODELS.length} failed (${e.message})`);
      if (attempt < HF_MODELS.length) await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error(`Failed to fetch image from Hugging Face after ${HF_MODELS.length} attempts: ${lastErr}`);
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
