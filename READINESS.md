# Preparing a Project for Majlis

This is a directive for Claude Code. When a user asks you to prepare their project for Majlis integration, follow these steps in order. The goal is to wire up the project so Majlis can capture metrics automatically, detect regressions, and give agents enough context to work effectively.

After completing these steps, the user should be able to run `npx create-majlis --init` and immediately have a functional Majlis setup.

---

## Step 1: Understand the Project

Read the project's existing documentation, build system, and test infrastructure. You need to answer:

1. **What does this project do?** Write a one-sentence objective.
2. **How do you build it?** Identify the build command (e.g., `npm run build`, `cmake --build build --parallel`, `cargo build`).
3. **How do you test it?** Identify the test/verification command and what its output looks like.
4. **What are the test fixtures?** Identify distinct test cases, benchmarks, or datasets the project uses.
5. **What numeric values indicate progress?** Identify metrics that can be tracked (error rates, pass counts, accuracy, timing, coverage).

## Step 2: Write or Update CLAUDE.md

Majlis agents read `CLAUDE.md` for project context. It must exist and contain at minimum:

- **What the project is** (1-2 sentences)
- **How to build** (exact command)
- **How to test** (exact command)
- **File layout** (where source, tests, configs, and docs live)
- **Key patterns** (architectural decisions agents need to respect)

If CLAUDE.md already exists, check that it covers the above. Fill in any gaps.

## Step 3: Create a Metrics Command

Majlis captures metrics automatically before and after each build. It needs a command that outputs JSON in this exact format:

```json
{
  "fixtures": {
    "fixture_name": {
      "metric_name": 123.4,
      "another_metric": 56.7
    }
  }
}
```

**If the project already outputs structured JSON from tests:** Point the metrics command at it, or write a thin wrapper that reshapes the output.

**If the project outputs human-readable text:** Write a script that runs the tests, parses the output, and prints the JSON format above. Put it at `scripts/majlis-metrics.sh` or `scripts/majlis-metrics.py`.

**If the project has no numeric test output:** Start simple. Even `{ "fixtures": { "main": { "tests_passing": 42, "build_time_ms": 3200 } } }` is useful. You can refine later.

Example wrapper for a project that outputs text:

```bash
#!/usr/bin/env bash
# scripts/majlis-metrics.sh
set -euo pipefail

# Run your actual test command and capture output
OUTPUT=$(./run_tests 2>&1)

# Parse relevant numbers and emit JSON
PASS_COUNT=$(echo "$OUTPUT" | grep -oP '\d+ passed' | grep -oP '\d+')
FAIL_COUNT=$(echo "$OUTPUT" | grep -oP '\d+ failed' | grep -oP '\d+')

cat <<EOF
{
  "fixtures": {
    "unit_tests": {
      "passing": ${PASS_COUNT:-0},
      "failing": ${FAIL_COUNT:-0}
    }
  }
}
EOF
```

**Verify the command works:** Run it and confirm it produces valid JSON.

## Step 4: Identify Fixtures and Gates

Fixtures are your distinct test cases or benchmarks. One of them should be designated as a **gate** — the regression baseline that must never get worse.

Common patterns:
- A project with a test suite + a new feature target: the test suite is the gate, the feature target is not.
- A project with multiple benchmarks: the stable production benchmark is the gate, the experimental one is not.
- A project with progressive difficulty levels: the levels already passing are gates, the target level is not.

If you have only one fixture, it can still be a gate (it protects against regressions while you work on improvements).

Prepare the fixture config:

```json
"fixtures": {
  "existing_tests": { "gate": true },
  "new_feature": {}
}
```

## Step 5: Define Tracked Metrics

For each metric your command outputs, decide:

| Direction | Use when |
|---|---|
| `lower_is_better` | Error counts, failure rates, latency |
| `higher_is_better` | Pass counts, accuracy, coverage |
| `closer_to_gt` | Values that should approach a known target (set `target` field) |

```json
"tracked": {
  "failing": { "direction": "lower_is_better" },
  "passing": { "direction": "higher_is_better" },
  "error_pct": { "direction": "closer_to_gt", "target": 0 }
}
```

## Step 6: Write the Project Objective

One clear sentence that describes what success looks like. This gets used in Maqasid checks (purpose audits) when experiments stall.

Good: "Achieve zero test failures on all verification levels for all fixtures."
Good: "Reduce API latency p99 below 200ms without regressing throughput."
Bad: "Make the project better." (Too vague for agents to evaluate.)

## Step 7: Prepare the Config

Assemble what you've gathered into the config structure that `create-majlis --init` will use. Don't write the config file yet (the scaffolder does that), but have the values ready:

```json
{
  "project": {
    "name": "<project name>",
    "description": "<one line>",
    "objective": "<from step 6>"
  },
  "metrics": {
    "command": "<from step 3>",
    "fixtures": { "<from step 4>" },
    "tracked": { "<from step 5>" }
  },
  "build": {
    "pre_measure": "<build command from step 2, or null>"
  }
}
```

## Step 8: Verify Readiness

Run through this checklist:

- [ ] CLAUDE.md exists with build/test instructions
- [ ] Metrics command runs and outputs valid JSON
- [ ] At least one fixture identified
- [ ] At least one gate fixture designated
- [ ] At least one tracked metric with direction set
- [ ] Project objective is specific and evaluable
- [ ] Build command identified (for `pre_measure`)

If any items are missing, they aren't blockers — Majlis works with zero config. But each one you wire up removes a failure mode and makes experiment cycles more autonomous.

## After Preparation

The user can now run:

```bash
npx create-majlis --init
```

Then edit `.majlis/config.json` with the values from Step 7, and run:

```bash
majlis status
```

The readiness section of status output will confirm what's wired up.
