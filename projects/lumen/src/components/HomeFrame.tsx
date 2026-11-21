"use client";

import React, { useState } from "react";
import type { PublicWorld } from "../world/public";
import type { PublicChunk, PublicGuest } from "../world/chunkMath";
import { CLAIM_BUFFER, CLAIM_START_RADIUS } from "../world/territoryRules";
import type { PublicBooks } from "../money/publicBooks";
import type { WishlistItemView } from "./WishlistView";
import { WorldStage } from "./WorldStage";
import { HomeDrawer, LedgerPanel, WishPanel } from "./WorldPanels";

export function HomeFrame({
  world,
  cam,
  greeting,
  thoughts,
  books,
  wishes,
  showKeeper,
  showMoney,
  chunks = [],
  guests = [],
  territory = { radius: CLAIM_START_RADIUS, buffer: CLAIM_BUFFER },
}: {
  world: PublicWorld;
  cam: string;
  greeting: string;
  thoughts: string[];
  books: PublicBooks;
  wishes: WishlistItemView[];
  showKeeper: boolean;
  showMoney: boolean;
  chunks?: PublicChunk[];
  guests?: PublicGuest[];
  territory?: { radius: number; buffer: number };
}) {
  const [panel, setPanel] = useState<null | "books" | "wishes">(null);
  return (
    <div className="home-stage" data-home-world="1" data-world-chunks={chunks.length} data-world-guests={guests.length} data-territory-radius={territory.radius} data-territory-buffer={territory.buffer}>
      <WorldStage initial={world} cam={cam} thoughts={thoughts} chunks={chunks} guests={guests} territory={territory} />
      <div className="home-tools">
        <button type="button" onClick={() => setPanel(panel === "books" ? null : "books")}>Ledger</button>
        <button type="button" onClick={() => setPanel(panel === "wishes" ? null : "wishes")}>Wishes</button>
      </div>
      {panel === "books" ? <LedgerPanel books={books} /> : null}
      {panel === "wishes" ? <WishPanel items={wishes} /> : null}
      <HomeDrawer greeting={greeting} showKeeper={showKeeper} showMoney={showMoney} />
    </div>
  );
}
