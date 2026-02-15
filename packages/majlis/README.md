# majlis

Multi-agent workflow CLI for structured doubt, independent verification, and compressed knowledge.

This is the CLI package. For full documentation, see the [root README](../../README.md).

## Installation

```bash
npm install --save-dev majlis
```

Or use the scaffolder for a full setup:

```bash
npx create-majlis my-project
```

## Usage

```bash
majlis init        # Initialize in current project
majlis status      # Show experiment states
majlis new "hyp"   # Create experiment
majlis next        # Advance to next cycle step
majlis next --auto # Run full cycle automatically
```

## License

MIT
