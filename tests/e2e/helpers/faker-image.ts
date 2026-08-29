import { faker } from "@faker-js/faker";

/**
 * Generate a deterministic fake image buffer using faker.
 * Uses offline SVG data-URI — no network request.
 *
 * @param seed - optional seed for determinism
 * @param variant - svg encoding variant
 */
export function fakeImageBuffer(
  seed?: number,
  variant: "svg-base64" | "svg-uri" = "svg-base64",
): Buffer {
  if (seed !== undefined) faker.seed(seed);

  const dataUri = faker.image.dataUri({ type: variant });
  const comma = dataUri.indexOf(",");
  const data = dataUri.slice(comma + 1);

  if (variant === "svg-base64") {
    return Buffer.from(data, "base64");
  }
  // svg-uri is URL-encoded
  return Buffer.from(decodeURIComponent(data), "utf-8");
}

/**
 * Generate a random binary buffer of given size, seeded via faker for determinism.
 */
export function fakeBinaryBuffer(size: number, seed?: number): Buffer {
  if (seed !== undefined) faker.seed(seed);
  // Use faker.string.alphanumeric to generate deterministic bytes, then expand.
  // Fallback to crypto for large sizes if needed, but keep deterministic.
  const str = faker.string.alphanumeric({ length: size });
  // str length == size, each char 1 byte in utf-8 for alphanumeric
  return Buffer.from(str, "utf-8");
}
