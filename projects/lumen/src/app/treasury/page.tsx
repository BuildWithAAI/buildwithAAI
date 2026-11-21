import { ProofPanel } from "../../components/ProofPanel";
import { proof } from "../../economy/economy";
import { getEngine } from "../../server/engine";

export const metadata = { title: "Treasury" };

/** What Zoora has earned for Zoora Technologies, and the milestones it is measured against. Totals only. */
export default function TreasuryPage() {
  const engine = getEngine();
  return <ProofPanel proof={proof(engine.db, Date.now())} />;
}
