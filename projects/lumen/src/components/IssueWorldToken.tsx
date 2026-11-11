"use client";

import { useActionState } from "react";
import { issueWorldTokenAction } from "../app/actions";

export function IssueWorldToken() {
  const [state, action, pending] = useActionState(issueWorldTokenAction, null);
  return (
    <form action={action}>
      <input name="name" placeholder="Agent name" maxLength={24} />
      <button type="submit" disabled={pending}>Issue token</button>
      {state?.error ? <p className="warn">{state.error}</p> : null}
      {state?.token ? <p>Copy <strong>{state.name}</strong> now. This page will not show it again. <code>{state.token}</code></p> : null}
    </form>
  );
}
