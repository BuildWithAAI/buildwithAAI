import React from "react";

const KIT_ACTION = "https://app.kit.com/forms/10168331/subscriptions";

/** Posts the address straight to Kit. There is no API key and no server proxy. */
export function SignupForm({ id = "email" }: { id?: string }) {
  const noteId = `${id}-privacy`;
  return (
    <form name="newsletter" method="POST" action={KIT_ACTION} aria-describedby={noteId}>
      <p className="kicker">Product and build updates</p>
      <div className="field">
        <label htmlFor={id}>Email</label>
        <input
          id={id}
          name="email_address"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
          maxLength={254}
          required
        />
      </div>
      <p id={noteId} className="privacy">This signup is used for Zoora product and build updates, sent through Kit. You'll get an email asking you to confirm, and you can unsubscribe any time.</p>
      <button type="submit">Sign up</button>
    </form>
  );
}
