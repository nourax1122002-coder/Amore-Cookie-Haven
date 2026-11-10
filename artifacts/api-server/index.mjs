// Vercel's Express detector looks for an Express import in its entrypoint.
import "express";

// The Vercel build type-checks the sources, then serves the esbuild bundle.
export { default } from "./dist/index.mjs";
