import { describe, expect, it } from "vitest";
import { skyAt, worldLocation } from "../src/world/sky";

describe("real sky", () => {
  it("puts the sun above the horizon at local noon and below it at local midnight", () => {
    const place = worldLocation({});
    expect(place.tz).toBe("America/Chicago");
    expect(place.lat).toBeCloseTo(33.99);
    expect(place.lon).toBeCloseTo(-96.37);
    const noon = skyAt(chicagoLocal(2026, 6, 21, 12, 0), {});
    const midnight = skyAt(chicagoLocal(2026, 6, 21, 0, 0), {});
    expect(noon.sunAltitude).toBeGreaterThan(0);
    expect(midnight.sunAltitude).toBeLessThan(0);
  });

  it("matches the full moon of 19 February 2019", () => {
    const sky = skyAt(new Date("2019-02-19T00:00:00Z"), {});
    expect(sky.moonPhase).toBeGreaterThan(0.45);
    expect(sky.moonPhase).toBeLessThan(0.55);
    expect(sky.moonPhaseName).toBe("full");
  });
});

function chicagoLocal(year: number, month: number, day: number, hour: number, minute: number): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  const target = utc;
  for (let i = 0; i < 4; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(utc));
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
    const shown = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour") % 24, read("minute"));
    utc += target - shown;
  }
  return new Date(utc);
}
