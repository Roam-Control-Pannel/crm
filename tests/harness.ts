/**
 * The smallest thing that can run the suite.
 *
 * This repo had no test infrastructure at all, which is why every fix in it
 * so far was verified by a throwaway script and then thrown away — and why
 * the same read-modify-write mistake was made in nine places before anyone
 * counted them. The bar here is deliberately low: no framework, no config, no
 * watcher. A test file exports `run(t)` and calls the assertions below.
 */

export interface T {
  readonly passed: number;
  readonly failed: number;
  group(name: string): void;
  is(name: string, got: unknown, want: unknown): void;
  ok(name: string, got: unknown): void;
  match(name: string, got: string, want: RegExp): void;
  throws(name: string, fn: () => unknown | Promise<unknown>, is?: (e: unknown) => boolean): Promise<void>;
}

export function createT(): T {
  let passed = 0;
  let failed = 0;
  const pass = (name: string) => { passed++; console.log(`    ✓ ${name}`); };
  const fail = (name: string, detail: string) => {
    failed++;
    console.log(`    ✗ ${name}\n        ${detail.replace(/\n/g, '\n        ')}`);
  };
  return {
    get passed() { return passed; },
    get failed() { return failed; },
    group(name) { console.log(`\n  ${name}`); },
    is(name, got, want) {
      const g = JSON.stringify(got);
      const w = JSON.stringify(want);
      g === w ? pass(name) : fail(name, `got:  ${g}\nwant: ${w}`);
    },
    ok(name, got) {
      got ? pass(name) : fail(name, `got: ${JSON.stringify(got)}\nwant: truthy`);
    },
    match(name, got, want) {
      want.test(got) ? pass(name) : fail(name, `got:  ${JSON.stringify(got)}\nwant: ${want}`);
    },
    async throws(name, fn, is) {
      try {
        await fn();
        fail(name, 'did not throw');
      } catch (err) {
        if (!is || is(err)) pass(name);
        else fail(name, `threw the wrong error: ${(err as any)?.name}: ${(err as any)?.message}`);
      }
    },
  };
}
