// Night City Map's built-in districts and their danger, as of its 0.27.1 (`scripts/data.js`), for tests that run without it.
export const DISTRICTS = [
  ['watson', 2], ['westbrook', 1], ['exec', 1], ['norcal', 3], ['oldcc', 5], ['oldcorp', 5], ['bank', 3], ['med', 3], ['marina', 2], ['europe', 2], ['uni', 2], ['south', 4],
  ['glen', 2], ['japan', 3], ['china', 3], ['ocz', 4], ['hind', 3], ['heywood', 2], ['rancho', 2], ['pacifica', 4], ['morro', 3], ['delbay', 0], ['sanbay', 0],
].map(([id, danger]) => ({ id, danger }));
