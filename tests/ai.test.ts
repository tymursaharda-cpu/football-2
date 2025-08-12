import { describe, it, expect } from 'vitest';

// The AI profiles are defined in main.js; here we re‑create a minimal
// representation to demonstrate how unit tests can validate simple data.
const aiProfiles = {
  Rookie:  { reactionTime: 0.30, aimError: 15 },
  Amateur: { reactionTime: 0.25, aimError: 12 },
  Pro:     { reactionTime: 0.20, aimError: 9  },
  Elite:   { reactionTime: 0.15, aimError: 6  },
  Legend:  { reactionTime: 0.12, aimError: 3  }
};

describe('AI profiles', () => {
  it('should have five difficulty levels', () => {
    expect(Object.keys(aiProfiles).length).toBe(5);
  });
  it('higher difficulty should react faster than lower difficulty', () => {
    expect(aiProfiles.Pro.reactionTime).toBeLessThan(aiProfiles.Rookie.reactionTime);
    expect(aiProfiles.Legend.aimError).toBeLessThan(aiProfiles.Amateur.aimError);
  });
});