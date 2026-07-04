declare module "ngeohash" {
  export function decode_bbox(hashstring: string): [number, number, number, number];
}

