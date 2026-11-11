import { openDatabase } from "../src/db/db";
import { noteChunkChainBroken, verifyChunkChain } from "../src/world/chunkEdits";

const file = process.env.LUMEN_DATA ?? `${process.cwd()}/data/lumen.sqlite`;
const db = openDatabase(file);
if (!verifyChunkChain(db)) {
  noteChunkChainBroken(db);
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "chunk_chain_broken", status: 500, route: "predeploy" }));
  process.exit(1);
}
