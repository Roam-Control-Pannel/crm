/**
 * Run every tests/*.test.ts. No framework, no config — see tests/harness.ts.
 *
 * Usage: npm test
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createT } from './harness';

async function main() {
  const dir = __dirname;
  const files = readdirSync(dir).filter(f => f.endsWith('.test.ts')).sort();
  const t = createT();

  for (const file of files) {
    console.log(`\n${'─'.repeat(64)}\n${file}`);
    const mod = await import(join(dir, file));
    if (typeof mod.run !== 'function') {
      console.log(`  (skipped: no exported run())`);
      continue;
    }
    await mod.run(t);
  }

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`${t.passed} passed, ${t.failed} failed\n`);
  process.exit(t.failed ? 1 : 0);
}

main().catch(err => {
  console.error('\nThe test run itself failed:\n', err);
  process.exit(1);
});
