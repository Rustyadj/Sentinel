/** Run explicitly on the Sentinel control-plane host, with its DB and Docker access. */
import { db } from "../src/lib/db";
import { provisionCodingComputers } from "../src/lib/agent-workspaces/coding-computers";
const [tenantWorkspaceId, ownerUserId, image] = process.argv.slice(2);
if (!tenantWorkspaceId || !ownerUserId || !image) {
  throw new Error("Usage: npx tsx scripts/provision-coding-computers.ts TENANT_ID OWNER_USER_ID PINNED_IMAGE");
}
provisionCodingComputers({ tenantWorkspaceId, ownerUserId, image })
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => db.$disconnect());
