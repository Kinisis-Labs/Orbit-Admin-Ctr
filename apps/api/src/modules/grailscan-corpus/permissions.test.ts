import assert from "node:assert/strict";
import test from "node:test";
import { mapOrbitCorpusPermissions } from "./permissions.js";

test("maps Orbit permissions to normalized backend permissions", () => {
  assert.deepEqual(
    mapOrbitCorpusPermissions([
      "grailscan.corpus.view",
      "grailscan.corpus.manage_versions",
      "untrusted.permission",
    ]),
    ["grailscan.corpus.read", "grailscan.corpus.version"],
  );
});

test("maps review workflow permissions with least privilege", () => {
  assert.deepEqual(mapOrbitCorpusPermissions(["grailscan.corpus.review"]), [
    "grailscan.corpus.review",
  ]);
  assert.deepEqual(mapOrbitCorpusPermissions(["grailscan.corpus.approve"]), [
    "grailscan.corpus.approve",
  ]);
  assert.deepEqual(mapOrbitCorpusPermissions(["grailscan.corpus.manage_rights"]), [
    "grailscan.corpus.review",
  ]);
});

test("maps corpus admin to the complete backend permission set", () => {
  const permissions = mapOrbitCorpusPermissions(["grailscan.corpus.admin"]);
  assert.ok(permissions.includes("grailscan.corpus.certificate.read"));
  assert.ok(permissions.includes("grailscan.corpus.purge"));
  assert.ok(permissions.includes("grailscan.corpus.admin"));
});
