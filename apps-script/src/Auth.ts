// Who is allowed to do what. A SCRIPT, not a module.
//
// The web app is deployed `access: ANYONE_ANONYMOUS` and `executeAs: USER_DEPLOYING`,
// because a PWA on a phone cannot carry a Google sign-in through a fetch without a CORS
// preflight Apps Script is unable to answer. So the token in the envelope IS the whole
// access control. There is nothing behind it.
//
// Two consequences the tests pin down:
//
// 1. The check runs BEFORE the write, never after. A token check that happens after the
//    row is appended is not a check; it is an audit log.
// 2. The two identities are not interchangeable. A person token authorises the
//    production ops. The `TEST_TOKEN` script property authorises the `test.*` namespace
//    plus the short allowlist in `TEST_ALLOWED_OPS_`, and nothing else. `auth.test.ts`
//    sends a valid person token to `test.read` and requires a refusal — because `test.*`
//    reads and writes raw rows, and a hole there is a hole in the real deployment.

interface Identity {
  /** "person" for a People row, "test" for the test-support token. */
  readonly kind: "person" | "test";
  /** The People row id, or "" for the test identity. */
  readonly personId: string;
}

interface AuthOutcome {
  readonly identity: Identity | null;
  readonly error: string;
}

function isTestOp_(op: string): boolean {
  return op.indexOf("test.") === 0;
}

/**
 * The only non-`test.*` ops the test token may drive.
 *
 * Both are household-wide jobs that belong to no person, so the integration suite has no
 * person token to send them with: `testkit.ts` `runSweep` and `reconcileCalendar` both
 * go out on the default token, which is `TEST_TOKEN`.
 *
 * Everything else the suite drives — `complete`, `chore.update`, `chore.delete` — is sent
 * with `household.personA.token` or `household.personB.token`, so it does not belong
 * here. Keeping the list this short matters because the test identity has no People row:
 * for it `opComplete_` takes `personId` from the PAYLOAD, so a test token that could
 * reach `complete` could attribute a completion to either person. It cannot reach it.
 *
 * Add an op here only when a test genuinely cannot send it with a person token.
 */
const TEST_ALLOWED_OPS_: readonly string[] = ["sweep.run", "calendar.reconcile"];

function isTestAllowedOp_(op: string): boolean {
  for (let index = 0; index < TEST_ALLOWED_OPS_.length; index += 1) {
    if (TEST_ALLOWED_OPS_[index] === op) return true;
  }
  return false;
}

/**
 * Resolves the envelope's token for this op, or explains why it is refused.
 *
 * The `test.*` branch is gated twice, and the order matters. TEST_MODE is checked FIRST,
 * so a deployment that never opted in refuses the whole namespace without ever
 * comparing a token — which means a leaked TEST_TOKEN cannot wipe a production sheet,
 * and the ops are dead code in production rather than a dormant back door.
 */
function authenticate_(token: string, op: string): AuthOutcome {
  if (op === "") return { identity: null, error: "No op given." };

  if (isTestOp_(op)) {
    if (!testModeEnabled_()) {
      return {
        identity: null,
        error:
          `Test-support ops are disabled on this deployment. Op "${op}" refused. ` +
          "Set the TEST_MODE script property to \"true\" to enable them.",
      };
    }
    const expected = testToken_();
    if (expected === "") {
      return { identity: null, error: "The TEST_TOKEN script property is not set." };
    }
    if (token === "" || token !== expected) {
      return { identity: null, error: `Not authorised for "${op}".` };
    }
    return { identity: { kind: "test", personId: "" }, error: "" };
  }

  if (token === "") return { identity: null, error: "No token." };

  // The test identity may drive a SHORT ALLOWLIST of production ops, and only on a
  // deployment that has opted into test mode. It is not a master key: an op outside the
  // list is refused by name even with TEST_MODE on, so the test token can never stand in
  // for a person. On a production deployment TEST_MODE is unset and none of this runs.
  if (testModeEnabled_() && testToken_() !== "" && token === testToken_()) {
    if (!isTestAllowedOp_(op)) {
      return {
        identity: null,
        error:
          `The test token is not authorised for "${op}". ` +
          `It may only drive the test.* ops and: ${TEST_ALLOWED_OPS_.join(", ")}. ` +
          "Send this op with a person token.",
      };
    }
    return { identity: { kind: "test", personId: "" }, error: "" };
  }

  const person = findRow_(readRows_("People"), "token", token);
  if (person === null) return { identity: null, error: "Unknown token." };
  return { identity: { kind: "person", personId: asText_(person.values["id"]) }, error: "" };
}
