import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientBucketsError,
  parseBucketLevel,
  parseCoId,
  bucketLevelLabel,
} from "../src/lib/client-buckets.ts";

test("parseCoId accepts numeric and string ids", () => {
  assert.equal(parseCoId(42), "42");
  assert.equal(parseCoId(" 99 "), "99");
});

test("parseCoId rejects empty", () => {
  assert.throws(() => parseCoId(""), ClientBucketsError);
});

test("parseBucketLevel accepts 1 2 3 only", () => {
  assert.equal(parseBucketLevel(1), 1);
  assert.equal(parseBucketLevel("2"), 2);
  assert.throws(() => parseBucketLevel(4), ClientBucketsError);
});

test("bucketLevelLabel formats N1 N2 N3", () => {
  assert.equal(bucketLevelLabel(1), "N1");
  assert.equal(bucketLevelLabel(3), "N3");
});
