"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { PublicWorld } from "../world/public";
import type { PublicChunk, PublicGuest } from "../world/chunkMath";
import { CLAIM_BUFFER, CLAIM_START_RADIUS } from "../world/territoryRules";

const WorldView = dynamic(() => import("./WorldView").then((mod) => mod.WorldView), {
  ssr: false,
  loading: () => <p className="world-loading">The island is coming into view.</p>,
});

export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

export function WorldFallback() {
  return (
    <section className="card" data-world-fallback="1">
      <h2>The island is resting</h2>
      <p>This browser can't draw the 3D world. Zoora is still here. Read the diary, the guestbook, or the gallery.</p>
    </section>
  );
}

export function WorldStage({
  initial,
  cam,
  thoughts = [],
  chunks = [],
  guests = [],
  territory = { radius: CLAIM_START_RADIUS, buffer: CLAIM_BUFFER },
}: {
  initial: PublicWorld;
  cam: string;
  thoughts?: string[];
  chunks?: PublicChunk[];
  guests?: PublicGuest[];
  territory?: { radius: number; buffer: number };
}) {
  const [ready, setReady] = useState<"wait" | "yes" | "no">("wait");
  useEffect(() => {
    setReady(webglAvailable() ? "yes" : "no");
  }, []);
  if (ready === "no") return <WorldFallback />;
  if (ready === "wait") return <p className="world-loading">The island is coming into view.</p>;
  return <WorldView initial={initial} cam={cam} thoughts={thoughts} chunks={chunks} guests={guests} territory={territory} />;
}
