import { login } from "../../actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return (
    <section className="card" style={{ maxWidth: 460 }}>
      <p className="kicker">Keeper</p>
      <h1>Owner login</h1>
      <p className="muted">Use the access token or the password. Visitors cannot open the money desk.</p>
      {params.error ? <p className="warn">That secret was refused.</p> : null}
      <form action={login}>
        <input name="secret" type="password" autoComplete="current-password" required />
        <button type="submit">Enter</button>
      </form>
    </section>
  );
}
