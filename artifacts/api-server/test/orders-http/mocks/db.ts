// No database connection is permitted in the HTTP security suite.
export const db = new Proxy({}, {
  get() { throw new Error("Unexpected database access in order HTTP tests"); },
});
export const inquiriesTable = {};
export const storeSettingsTable = {};
