import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal Cloudflare/OpenNext config for the Phase A adapter spike (issue #977).
// Incremental cache (R2), the durable-queue revalidation worker, and tag cache
// are intentionally omitted until the F2/F3 follow-ups. The app boots without
// them; ISR/SSG revalidation caching is simply disabled in this configuration.
export default defineCloudflareConfig({});
