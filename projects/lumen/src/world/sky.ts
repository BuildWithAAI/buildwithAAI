import SunCalc from "suncalc";

export const DEFAULT_LAT = 33.99;
export const DEFAULT_LON = -96.37;
export const DEFAULT_TZ = "America/Chicago";

export type SkyState = {
  utc: string;
  lat: number;
  lon: number;
  tz: string;
  localTime: string;
  sunAltitude: number;
  sunAzimuth: number;
  moonAltitude: number;
  moonAzimuth: number;
  moonPhase: number;
  moonPhaseName: string;
  sunrise: string;
  sunset: string;
};

type SkyEnv = { LUMEN_WORLD_LAT?: string; LUMEN_WORLD_LON?: string; LUMEN_WORLD_TZ?: string; LUMEN_SKY_AT?: string };

export function worldLocation(env: SkyEnv = {}): { lat: number; lon: number; tz: string } {
  const lat = Number(env.LUMEN_WORLD_LAT ?? DEFAULT_LAT);
  const lon = Number(env.LUMEN_WORLD_LON ?? DEFAULT_LON);
  const tz = env.LUMEN_WORLD_TZ || DEFAULT_TZ;
  return {
    lat: Number.isFinite(lat) ? lat : DEFAULT_LAT,
    lon: Number.isFinite(lon) ? lon : DEFAULT_LON,
    tz,
  };
}

export function skyInstant(env: SkyEnv = {}, now = Date.now()): Date {
  if (env.LUMEN_SKY_AT) {
    const parsed = new Date(env.LUMEN_SKY_AT);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(now);
}

export function localMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return ((hour % 24) * 60) + minute;
}

export function formatLocal(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function moonPhaseName(phase: number): string {
  const names = ["new", "waxing crescent", "first quarter", "waxing gibbous", "full", "waning gibbous", "last quarter", "waning crescent"];
  const index = Math.round(((phase % 1) + 1) % 1 * 8) % 8;
  return names[index] ?? "new";
}

export function skyAt(date: Date, env: SkyEnv = {}): SkyState {
  const { lat, lon, tz } = worldLocation(env);
  const sun = SunCalc.getPosition(date, lat, lon);
  const moon = SunCalc.getMoonPosition(date, lat, lon);
  const illumination = SunCalc.getMoonIllumination(date);
  const times = SunCalc.getTimes(date, lat, lon);
  return {
    utc: date.toISOString(),
    lat,
    lon,
    tz,
    localTime: formatLocal(date, tz),
    sunAltitude: sun.altitude,
    sunAzimuth: sun.azimuth,
    moonAltitude: moon.altitude,
    moonAzimuth: moon.azimuth,
    moonPhase: illumination.phase,
    moonPhaseName: moonPhaseName(illumination.phase),
    sunrise: times.sunrise.toISOString(),
    sunset: times.sunset.toISOString(),
  };
}

/** South is azimuth 0 and positive azimuth points west, matching suncalc. */
export function directionFromHorizon(altitude: number, azimuth: number): { x: number; y: number; z: number } {
  const cosAlt = Math.cos(altitude);
  return {
    x: -Math.sin(azimuth) * cosAlt,
    y: Math.sin(altitude),
    z: -Math.cos(azimuth) * cosAlt,
  };
}
