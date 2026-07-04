import ngeohash from "ngeohash";

export type LatLng = { lat: number; lon: number };

export function geohashToPolygonLatLng(gh: string): LatLng[] {
  const bbox = ngeohash.decode_bbox(gh);
  const minLat = bbox[0];
  const minLon = bbox[1];
  const maxLat = bbox[2];
  const maxLon = bbox[3];

  return [
    { lat: minLat, lon: minLon },
    { lat: minLat, lon: maxLon },
    { lat: maxLat, lon: maxLon },
    { lat: maxLat, lon: minLon },
    { lat: minLat, lon: minLon }
  ];
}

export function numberOrNull(v: unknown): number | null {
  if (typeof v !== "number") return null;
  if (!Number.isFinite(v)) return null;
  return v;
}

export function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function colorRampRedYellowGreen(t: number): string {
  const x = clamp01(t);
  const r = Math.round(255 * x);
  const g = Math.round(200 * (1 - x) + 55 * x);
  const b = Math.round(80 * (1 - x));
  return `rgb(${r},${g},${b})`;
}

export function colorRampBlueRed(t: number): string {
  const x = clamp01(t);
  const r = Math.round(100 + 155 * x);
  const g = Math.round(200 - 50 * x);
  const b = Math.round(255 - 100 * x);
  return `rgb(${r},${g},${b})`;
}

const DENSITY_COLORS = [
  "#ffffff", // 0 - 1/8 (low density)
  "#ffcccc", // 1/8 - 2/8
  "#ff9999", // 2/8 - 3/8
  "#ff6666", // 3/8 - 4/8
  "#ff3333", // 4/8 - 5/8
  "#ff0000", // 5/8 - 6/8
  "#cc0000", // 6/8 - 7/8
  "#990000"  // 7/8 - 1 (high density)
];

export function colorRampRedWhite8Class(t: number): string {
  const x = clamp01(t);
  const index = Math.floor(x * 8);
  return DENSITY_COLORS[Math.min(index, 7)];
}

