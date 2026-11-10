import { FloorView } from "../../components/FloorView";
import { tape } from "../../trading/book";
import { getEngine } from "../../server/engine";

export default function FloorPage() {
  const engine = getEngine();
  const board = tape(engine.db, engine.env);
  return <FloorView board={board} now={Date.now()} />;
}
