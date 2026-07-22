// Uses Groq's free-tier chat completions API (OpenAI-compatible) to:
// 1. Pick a topic on its own
// 2. Write text for a 3-slide quote carousel
// 3. Write an image-generation prompt per slide (for Pollinations)
// 4. Write an Instagram caption + hashtags
//
// Get a free API key at https://console.groq.com

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You are a creative director for an Instagram page that posts short, punchy
quote carousels. Every day you must pick a NEW topic/theme (motivation, discipline, patience,
growth, self-respect, focus, resilience, minimalism, creativity, etc. - vary it, don't repeat
recent obvious ones). Then write a 3-slide carousel:

- slide 1: ONE short, original, quotable line (max 16 words). Not a famous existing quote -
  write an original one so there are no copyright/attribution issues.
- slide 2: a 1-2 sentence expansion / context on the idea (max 30 words).
- slide 3: a short closing call-to-action line inviting people to follow/save (max 14 words).

Also write, for each slide, a short visual prompt (for an AI image generator) describing a
calm, aesthetic, abstract or nature-based background that fits the mood - no text in the
image itself, no people's faces, no logos or brand names.

Finally write an Instagram caption (2-4 sentences, no hashtags in it) and a separate list of
8-12 relevant hashtags (no # symbol, just the words).

Respond with ONLY valid JSON, no markdown fences, in exactly this shape:
{
  "topic": "string",
  "slides": [
    {"text": "string", "imagePrompt": "string"},
    {"text": "string", "imagePrompt": "string"},
    {"text": "string", "imagePrompt": "string"}
  ],
  "caption": "string",
  "hashtags": ["string", "..."]
}`;

export async function generateContent() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY env var");

  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 1.0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Today's date is ${new Date().toDateString()}. Generate today's carousel.`,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Groq returned no content");

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse JSON from Groq response: ${raw}`);
  }

  if (!parsed.slides || parsed.slides.length !== 3) {
    throw new Error("Groq did not return exactly 3 slides");
  }

  return parsed;
}
