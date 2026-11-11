"use client";

import React, { useEffect, useState } from "react";

export const AI_NOTICE_KEY = "zoora-ai-notice";
export const AI_NOTICE = "Zoora is an AI, not a human.";

export function aiNoticeOpen(stored: string | null): boolean {
  return stored !== "1";
}

export function AiNotice() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (aiNoticeOpen(localStorage.getItem(AI_NOTICE_KEY))) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);
  if (!open) return null;
  return (
    <div className="banner" role="dialog" aria-label="AI disclosure">
      <p>{AI_NOTICE}</p>
      <button
        type="button"
        onClick={() => {
          try { localStorage.setItem(AI_NOTICE_KEY, "1"); } catch { /* the notice can return next visit */ }
          setOpen(false);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
