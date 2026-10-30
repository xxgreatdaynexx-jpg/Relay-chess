/** Admin: delete a name's account (and sessions) so it can be claimed again. Usage: npm run reset-password -- <name> */
import { createPgAccountStore, nameKey } from '../server/accounts.js';
import { databaseUrl } from '../server/leaderboard-store.js';

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('Usage: npm run reset-password -- <name>');
  process.exit(1);
}
const url = databaseUrl();
if (!url) {
  console.error('Set DATABASE_URL first.');
  process.exit(1);
}
const store = createPgAccountStore(url);
await store.init();
const removed = await store.remove(nameKey(name));
console.log(removed ? `Cleared account for "${name}". It can be claimed again.` : `No account for "${name}".`);
process.exit(0);
