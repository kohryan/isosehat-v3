import L from "leaflet";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FaHospital, FaLocationDot } from "react-icons/fa6";
import { LuCrosshair, LuMapPinPlus } from "react-icons/lu";
import { RiGovernmentFill, RiMedicineBottleFill } from "react-icons/ri";

type MarkerConfig = {
  icon: any;
  size: number;
  iconSize: number;
  color: string;
  glow: string;
  ring: string;
  soft?: boolean;
};

const priorityMarkerCache = new Map<string, L.DivIcon>();

function createLeafletMarker(config: MarkerConfig) {
  const html = renderToStaticMarkup(
    createElement(
      "div",
      {
        style: {
          width: `${config.size}px`,
          height: `${config.size}px`,
          borderRadius: config.soft ? "14px" : "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: config.color,
          background: "rgba(4, 10, 24, 0.92)",
          border: `1px solid ${config.ring}`,
          boxShadow: `0 0 0 1px rgba(255,255,255,0.05) inset, 0 0 18px ${config.glow}, 0 8px 18px rgba(2,6,23,0.55)`,
          backdropFilter: "blur(10px)",
          position: "relative",
        },
      },
      createElement(config.icon, { size: config.iconSize }),
      createElement("div", {
        style: {
          position: "absolute",
          inset: "-4px",
          borderRadius: config.soft ? "18px" : "999px",
          border: `1px solid ${config.glow}`,
          opacity: 0.38,
        },
      })
    )
  );

  return L.divIcon({
    className: "facility-icon",
    html,
    iconSize: [config.size, config.size],
    iconAnchor: [config.size / 2, config.size / 2],
    popupAnchor: [0, -Math.round(config.size * 0.55)],
  });
}

function createLocationPinMarker(size: number, iconSize: number, color: string, glow: string) {
  const html = renderToStaticMarkup(
    createElement(
      "div",
      {
        style: {
          width: `${size}px`,
          height: `${size}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color,
          position: "relative",
          filter: `drop-shadow(0 0 14px ${glow}) drop-shadow(0 10px 18px rgba(2, 6, 23, 0.55))`,
        },
      },
      createElement(FaLocationDot, { size: iconSize }),
      createElement("div", {
        style: {
          position: "absolute",
          width: `${Math.round(size * 0.34)}px`,
          height: `${Math.round(size * 0.34)}px`,
          bottom: `${Math.round(size * 0.12)}px`,
          borderRadius: "999px",
          background: glow,
          filter: "blur(8px)",
          opacity: 0.65,
          zIndex: -1,
        },
      })
    )
  );

  return L.divIcon({
    className: "facility-icon location-pin-icon",
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, Math.round(size * 0.88)],
    popupAnchor: [0, -Math.round(size * 0.72)],
  });
}

export const hospitalIcon = createLeafletMarker({
  icon: FaHospital,
  size: 34,
  iconSize: 18,
  color: "#fb7185",
  glow: "rgba(251, 113, 133, 0.5)",
  ring: "rgba(251, 113, 133, 0.7)",
});

export const puskesmasIcon = createLeafletMarker({
  icon: RiGovernmentFill,
  size: 32,
  iconSize: 17,
  color: "#38bdf8",
  glow: "rgba(56, 189, 248, 0.48)",
  ring: "rgba(56, 189, 248, 0.68)",
  soft: true,
});

export const clinicIcon = createLeafletMarker({
  icon: RiMedicineBottleFill,
  size: 28,
  iconSize: 15,
  color: "#67e8f9",
  glow: "rgba(34, 211, 238, 0.48)",
  ring: "rgba(34, 211, 238, 0.68)",
});

export const plannedFacilityIcon = createLeafletMarker({
  icon: LuMapPinPlus,
  size: 34,
  iconSize: 18,
  color: "#fbbf24",
  glow: "rgba(251, 191, 36, 0.48)",
  ring: "rgba(251, 191, 36, 0.68)",
  soft: true,
});

export function getPlannedFacilityPriorityIcon(type: "hospital" | "puskesmas" | "clinic", priorityScore: number) {
  const bucket = priorityScore >= 85 ? "critical" : priorityScore >= 70 ? "high" : priorityScore >= 55 ? "watch" : "baseline";
  const cacheKey = `${type}-${bucket}`;
  const cached = priorityMarkerCache.get(cacheKey);
  if (cached) return cached;

  const palette =
    bucket === "critical"
      ? { color: "#f97316", glow: "rgba(249, 115, 22, 0.52)", ring: "rgba(249, 115, 22, 0.74)" }
      : bucket === "high"
        ? { color: "#fbbf24", glow: "rgba(251, 191, 36, 0.48)", ring: "rgba(251, 191, 36, 0.7)" }
        : bucket === "watch"
          ? { color: "#38bdf8", glow: "rgba(56, 189, 248, 0.46)", ring: "rgba(56, 189, 248, 0.68)" }
          : { color: "#94a3b8", glow: "rgba(148, 163, 184, 0.42)", ring: "rgba(148, 163, 184, 0.62)" };

  const icon = type === "hospital" ? FaHospital : type === "puskesmas" ? RiGovernmentFill : RiMedicineBottleFill;
  const marker = createLeafletMarker({
    icon,
    size: 34,
    iconSize: 18,
    color: palette.color,
    glow: palette.glow,
    ring: palette.ring,
    soft: true,
  });

  priorityMarkerCache.set(cacheKey, marker);
  return marker;
}

export const locationPinIcon = createLocationPinMarker(42, 30, "#ef4444", "rgba(239, 68, 68, 0.55)");

export const focusPinIcon = createLeafletMarker({
  icon: LuCrosshair,
  size: 38,
  iconSize: 18,
  color: "#22d3ee",
  glow: "rgba(34, 211, 238, 0.52)",
  ring: "rgba(34, 211, 238, 0.7)",
});
