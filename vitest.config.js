// Vitest configuration for the Arcade Football project. This file is
// provided as a starting point for writing unit tests. Running `npx vitest`
// will execute tests under the `tests/` directory. Note that the game
// itself runs in the browser; many modules (like PIXI) are not available
// in a Node environment, so tests should focus on pure logic (e.g., AI
// decision functions, helpers) rather than DOM rendering.

export default {
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
};