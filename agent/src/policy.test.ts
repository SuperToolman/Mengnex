import assert from "node:assert/strict";
import test from "node:test";
import { requiresApproval } from "./policy.js";

test("request approval mode gates every tool", () => {
  assert.equal(requiresApproval("request_approval", "read"), true);
  assert.equal(requiresApproval("request_approval", "low"), true);
});

test("default mode only gates high and critical tools", () => {
  assert.equal(requiresApproval("approve_high_risk", "medium"), false);
  assert.equal(requiresApproval("approve_high_risk", "high"), true);
  assert.equal(requiresApproval("approve_high_risk", "critical"), true);
});

test("full access still gates critical tools", () => {
  assert.equal(requiresApproval("full_access", "high"), false);
  assert.equal(requiresApproval("full_access", "critical"), true);
});
