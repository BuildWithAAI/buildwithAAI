import { FloorView } from "../../components/FloorView";
import { floorBoard } from "../../trading/floor";
import { getEngine } from "../../server/engine";

export default function FloorPage() {
  const engine = getEngine();
  return <FloorView board={floorBoard(engine.db, engine.env)} now={Date.now()} />;
}
