import type { ImageLoader } from "next/image";

// `next/image` normally requires an allowlist of remote domains for optimization.
// This app stores user-provided image URLs (e.g., club/event images), so we use a
// passthrough loader + `unoptimized` at call-sites to preserve existing behavior
// (render like a normal <img>) while satisfying Next.js lint rules safely.
export const passthroughImageLoader: ImageLoader = ({ src }) => src;

