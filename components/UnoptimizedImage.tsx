"use client";

import Image, { type ImageProps } from "next/image";
import { passthroughImageLoader } from "@/lib/nextImageLoader";

type UnoptimizedImageProps = Omit<ImageProps, "loader">;

export default function UnoptimizedImage(props: UnoptimizedImageProps) {
  const { alt, unoptimized, ...rest } = props;
  return <Image {...rest} alt={alt} loader={passthroughImageLoader} unoptimized={unoptimized ?? true} />;
}
