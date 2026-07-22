import { Octokit } from "@octokit/rest";

/**
 * Uploads a list of image buffers to the repo under posts/<dateFolder>/slideN.png
 * and returns their public raw.githubusercontent.com URLs.
 *
 * @param {{buffer: Buffer, filename: string}[]} images
 * @returns {Promise<string[]>} public raw URLs, same order as input
 */
export async function uploadImagesToGithub(images) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const owner = process.env.GH_OWNER;
  const repo = process.env.GH_REPO;
  const branch = process.env.GH_BRANCH || "main";

  if (!token || !owner || !repo) {
    throw new Error("Missing GH_TOKEN/GITHUB_TOKEN, GH_OWNER, or GH_REPO env vars");
  }

  const octokit = new Octokit({ auth: token });

  const dateFolder = new Date().toISOString().slice(0, 10); // e.g. 2026-07-21
  const urls = [];

  for (const { buffer, filename } of images) {
    const path = `posts/${dateFolder}/${filename}`;
    const contentBase64 = buffer.toString("base64");

    // Check if the file already exists (needed to supply sha on update, e.g. re-runs same day)
    let sha;
    try {
      const existing = await octokit.repos.getContent({ owner, repo, path, ref: branch });
      sha = Array.isArray(existing.data) ? undefined : existing.data.sha;
    } catch (e) {
      // 404 = doesn't exist yet, that's fine
      if (e.status !== 404) throw e;
    }

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `Add carousel image ${path}`,
      content: contentBase64,
      branch,
      sha,
    });

    urls.push(
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`
    );
  }

  return urls;
}
