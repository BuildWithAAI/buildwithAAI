import { readSolOrder } from "../../../money/solana";
import { getEngine } from "../../../server/engine";
import { solVerify } from "../../actions";

export default async function SolPayPage({ searchParams }: { searchParams: Promise<{ order?: string; error?: string; paid?: string }> }) {
  const params = await searchParams;
  const order = params.order ? readSolOrder(getEngine().db, params.order) : null;
  return (
    <div className="card">
      <p className="kicker">Pay with SOL</p>
      <h1>{order?.title ?? "No quote"}</h1>
      {params.paid === "1" ? <p>Paid. The file link is on the way.</p> : null}
      {params.error ? <p className="warn">Not paid: {params.error}. No file was delivered.</p> : null}
      {order && order.status === "quoted" ? (
        <>
          <p>Send at least {order.sol} SOL to the owner's public wallet. This quote ends at {new Date(order.expiresAt).toISOString()}.</p>
          <p><a href={order.url}>{order.url}</a></p>
          <form action={solVerify}>
            <input type="hidden" name="order" value={order.id} />
            <input name="signature" placeholder="Transaction signature" />
            <button type="submit">I've paid</button>
          </form>
        </>
      ) : null}
    </div>
  );
}
