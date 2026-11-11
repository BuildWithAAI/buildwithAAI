"use client";

import React, { useEffect, useState } from "react";

export function HydrationMark() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  return <span data-hydrated="yes" hidden>ready</span>;
}