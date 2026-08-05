# Market-Sentinal-test-002
It is fine tuned version of market sentinel i.e. 001 as it doesnt contain everyything inside main.ts of app.server only.

To run this especially after changing folder name of market sentinel 002 follow these steps:

1. run: pnpm approve-builds(if it ask to remove and reinstalled modules from scratch then approve yes)

A terminal UI should appear.

Use the arrow keys to highlight esbuild.
Press Space to select it.
Press Enter to approve.

2. run: pnpm install

3. run: pnpm --filter @market-sentinel/db generate

4. finally run: pnpm dev
