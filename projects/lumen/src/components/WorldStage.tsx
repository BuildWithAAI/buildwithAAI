"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { PublicWorld } from "../world/public";

const WorldView = dynamic(() => import("./WorldView").then((mod) => mod.WorldView), {
  ssr: false,
  loading: () => <p className="world-loading">The island is coming into view.</p>,
});

export function WorldStage({ initial, cam }: { initial: PublicWorld; cam: string }) {
  return <WorldView initial={initial} cam={cam} />;
}
