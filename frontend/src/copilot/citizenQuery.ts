import type { FaskesPoint } from "../types";

export type CitizenPreference = "nearby" | "puskesmas_first" | "rs_first" | "any";
export type CitizenLevel = "puskesmas" | "klinik" | "rs" | "igd";

export type CitizenQueryInput = {
  lat: number;
  lon: number;
  symptoms: string;
  preference: CitizenPreference;
};

export type CitizenFacilityRecommendation = {
  id: string;
  nama: string;
  tipe_label: string;
  tipe_kode: string;
  lat: number;
  lon: number;
  distance_km: number;
};

export type CitizenQueryResult = {
  level: CitizenLevel;
  reasons: string[];
  caution: string[];
  facilities: CitizenFacilityRecommendation[];
};

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(s));
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(text: string, phrases: string[]): boolean {
  return phrases.some((p) => text.includes(p));
}

function classifyLevel(symptoms: string): { level: CitizenLevel; reasons: string[]; caution: string[] } {
  const t = normalizeText(symptoms);
  const caution = [
    "Ini triase ringan, bukan diagnosis.",
    "Jika kondisi memburuk atau ada tanda bahaya, segera ke IGD/RS terdekat.",
    "Untuk anak kecil, ibu hamil, lansia, atau komorbid berat: ambil tingkat layanan lebih tinggi."
  ];

  const redFlags = [
    "sesak napas",
    "sulit bernapas",
    "nyeri dada",
    "pingsan",
    "tidak sadar",
    "kejang",
    "kelumpuhan",
    "bicara pelo",
    "stroke",
    "perdarahan hebat",
    "muntah darah",
    "bab berdarah",
    "kaku kuduk",
    "leher kaku"
  ];
  if (includesAny(t, redFlags)) {
    return {
      level: "igd",
      reasons: ["Ada tanda bahaya pada gejala yang disebutkan."],
      caution
    };
  }

  const moderate = ["demam tinggi", "demam 3 hari", "dehidrasi", "diare terus", "muntah terus", "batuk berat"];
  if (includesAny(t, moderate)) {
    return {
      level: "rs",
      reasons: ["Gejala berpotensi butuh evaluasi lebih lanjut (pemeriksaan dan observasi)."],
      caution
    };
  }

  const mild = ["pilek", "batuk", "demam", "sakit kepala", "nyeri tenggorokan", "mual", "diare", "pusing"];
  if (includesAny(t, mild) || t.length > 0) {
    return {
      level: "puskesmas",
      reasons: ["Keluhan umum biasanya bisa ditangani di layanan primer terlebih dahulu."],
      caution
    };
  }

  return {
    level: "puskesmas",
    reasons: ["Mulai dari layanan primer untuk penilaian awal."],
    caution
  };
}

function isPuskesmas(p: FaskesPoint): boolean {
  return ["0", "1", "2", "3"].includes(p.tipe_kode) || p.tipe_label.toLowerCase().includes("puskesmas");
}

function isRS(p: FaskesPoint): boolean {
  return p.tipe_kode === "R" || p.tipe_label.toLowerCase().includes("rumah sakit");
}

function filterByLevel(level: CitizenLevel, points: FaskesPoint[]): FaskesPoint[] {
  if (level === "igd" || level === "rs") return points.filter(isRS);
  if (level === "puskesmas") return points.filter((p) => isPuskesmas(p) || p.tipe_kode === "B");
  return points;
}

function sortByPreference(preference: CitizenPreference, points: FaskesPoint[]): FaskesPoint[] {
  if (preference === "any" || preference === "nearby") return points;
  if (preference === "puskesmas_first") {
    return [...points].sort((a, b) => Number(isPuskesmas(b)) - Number(isPuskesmas(a)));
  }
  if (preference === "rs_first") {
    return [...points].sort((a, b) => Number(isRS(b)) - Number(isRS(a)));
  }
  return points;
}

export function citizenQuery(input: CitizenQueryInput, faskes: FaskesPoint[]): CitizenQueryResult {
  const triage = classifyLevel(input.symptoms);
  const relevant = filterByLevel(triage.level, faskes);
  const ordered = sortByPreference(input.preference, relevant);

  const scored = ordered
    .map((p) => ({
      p,
      d: haversineKm(input.lat, input.lon, p.lat, p.lon)
    }))
    .filter((x) => Number.isFinite(x.d))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);

  const facilities: CitizenFacilityRecommendation[] = scored.map(({ p, d }) => ({
    id: p.id,
    nama: p.nama,
    tipe_label: p.tipe_label,
    tipe_kode: p.tipe_kode,
    lat: p.lat,
    lon: p.lon,
    distance_km: d
  }));

  const reasons = [
    ...triage.reasons,
    `Rekomendasi berdasarkan lokasi (${input.lat.toFixed(5)}, ${input.lon.toFixed(5)}) dan preferensi (${input.preference}).`
  ];

  return {
    level: triage.level,
    reasons,
    caution: triage.caution,
    facilities
  };
}

