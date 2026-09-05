import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` otherwise appends a vendor block to CLAUDE.md on every run.
  // That file is this project's own guidance and shouldn't be machine-edited.
  agentRules: false,
};

export default nextConfig;
