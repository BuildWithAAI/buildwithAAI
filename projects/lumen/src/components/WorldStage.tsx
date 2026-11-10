"use client";

import dynamic from "next/dynamic";
import type { PublicWorld } from "../world/public";

const WorldView = dynamic(() => import("./WorldView").then((mod) => mod.WorldView), { ssr: false });

export function WorldStage({ initial, cam }: { initial: PublicWorld; cam: string }) {
  return <WorldView initial={initial} cam={cam} />;
}
