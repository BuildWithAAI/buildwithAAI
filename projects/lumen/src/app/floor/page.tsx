import { FloorView } from "../../components/FloorView";
import { ProofPanel } from "../../components/ProofPanel";
import { proof } from "../../economy/economy";
import { tape } from "../../trading/book";
import { getEngine } from "../../server/engine";

export default function FloorPage() {
  const engine = getEngine();
  const board = tape(engine.db, engine.env);
  const now = Date.now();
  return (
    <>
      <FloorView board={board} now={now} />
      <ProofPanel proof={proof(engine.db, now)} />
    </>
  );
}
