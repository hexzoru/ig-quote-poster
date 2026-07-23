// Instagram Graph API - carousel publishing
// Docs: https://developers.facebook.com/docs/instagram-platform/content-publishing
//
// Flow:
//   1. POST /{ig-user-id}/media  (per image, is_carousel_item=true) -> creation_id
//   2. POST /{ig-user-id}/media  (media_type=CAROUSEL, children=[...ids], caption) -> container_id
//   3. Poll GET /{container_id}?fields=status_code until FINISHED
//   4. POST /{ig-user-id}/media_publish (creation_id=container_id)

// Uses graph.instagram.com because our access token comes from the "Instagram API
// with Instagram Login" flow (direct login), not the Facebook Login flow. Tokens
// from Instagram Login only work against this host - using graph.facebook.com with
// this token type causes "Cannot parse access token" errors.
const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

function requireEnv() {
  const igUserId = process.env.IG_USER_ID;
  const accessToken = process.env.IG_ACCESS_TOKEN;
  if (!igUserId || !accessToken) {
    throw new Error("Missing IG_USER_ID or IG_ACCESS_TOKEN env vars");
  }
  return { igUserId, accessToken };
}

async function graphPost(path, params) {
  const url = `${GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Graph API error at ${path}: ${JSON.stringify(data.error || data)}`);
  }
  return data;
}

async function graphGet(path, params) {
  const url = `${GRAPH_BASE}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Graph API error at ${path}: ${JSON.stringify(data.error || data)}`);
  }
  return data;
}

async function waitUntilFinished(containerId, accessToken, { timeoutMs = 120000, intervalMs = 4000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await graphGet(`/${containerId}`, {
      fields: "status_code",
      access_token: accessToken,
    });
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR") {
      throw new Error(`Container ${containerId} failed processing`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for container ${containerId} to finish processing`);
}

/**
 * @param {string[]} imageUrls - public URLs of the carousel images, in display order
 * @param {string} caption
 */
export async function postCarousel(imageUrls, caption) {
  const { igUserId, accessToken } = requireEnv();

  if (!imageUrls || imageUrls.length < 2) {
    throw new Error("Carousel posts need at least 2 images");
  }

  // 1. Create a child container per image
  const childIds = [];
  for (const imageUrl of imageUrls) {
    const child = await graphPost(`/${igUserId}/media`, {
      image_url: imageUrl,
      is_carousel_item: "true",
      access_token: accessToken,
    });
    childIds.push(child.id);
  }

  // 2. Create the parent carousel container
  const parent = await graphPost(`/${igUserId}/media`, {
    media_type: "CAROUSEL",
    caption,
    children: childIds.join(","),
    access_token: accessToken,
  });

  // 3. Wait for Instagram to finish processing all images
  await waitUntilFinished(parent.id, accessToken);

  // 4. Publish
  const published = await graphPost(`/${igUserId}/media_publish`, {
    creation_id: parent.id,
    access_token: accessToken,
  });

  return published; // { id: "<published media id>" }
}
