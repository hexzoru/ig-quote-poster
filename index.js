import { generateContent } from "./src/generateContent.js";
import { generateSlideImage } from "./src/generateImage.js";
import { uploadImagesToGithub } from "./src/uploadToGithub.js";
import { postCarousel } from "./src/postInstagram.js";

function buildCaption(content) {
  const handle = process.env.IG_HANDLE || "";
  const hashtags = (content.hashtags || []).map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  return `${content.caption}\n\n${handle}\n\n${hashtags}`.trim();
}

async function main() {
  console.log("Step 1/4: Generating today's quote + topic with Groq...");
  const content = await generateContent();
  console.log(`Topic chosen: ${content.topic}`);

  console.log("Step 2/4: Generating carousel images...");
  const images = [];
  for (let i = 0; i < content.slides.length; i++) {
    const slide = content.slides[i];
    const isClosing = i === content.slides.length - 1;
    console.log(`  - slide ${i + 1}/${content.slides.length}: "${slide.text}"`);
    const buffer = await generateSlideImage({
      text: slide.text,
      imagePrompt: slide.imagePrompt,
      isClosing,
      seed: Date.now() + i,
    });
    images.push({ buffer, filename: `slide-${i + 1}.png` });
  }

  console.log("Step 3/4: Uploading images to GitHub for public URLs...");
  const imageUrls = await uploadImagesToGithub(images);
  console.log(imageUrls.join("\n"));

  console.log("Step 4/4: Publishing carousel to Instagram...");
  const caption = buildCaption(content);
  const result = await postCarousel(imageUrls, caption);
  console.log(`Posted successfully! Media ID: ${result.id}`);
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
