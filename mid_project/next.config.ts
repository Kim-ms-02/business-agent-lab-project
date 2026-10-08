import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Project rules live in CLAUDE.md; stop `next dev` from writing AGENTS.md.
  agentRules: false,
};

export default nextConfig;
