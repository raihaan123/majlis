export const HOOKS_CONFIG = {
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: 'command' as const,
            command: "majlis status --json 2>/dev/null || true",
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command' as const,
            command: "majlis check-commit 2>/dev/null || true",
            timeout: 10,
          },
        ],
      },
    ],
    SubagentStop: [
      {
        hooks: [
          {
            type: 'command' as const,
            command: "echo 'Subagent completed. Run majlis next to continue the cycle.'",
            timeout: 5,
          },
        ],
      },
    ],
  },
};
