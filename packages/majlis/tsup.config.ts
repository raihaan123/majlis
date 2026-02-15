import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['cjs'],
  clean: true,
  platform: 'node',
  target: 'es2022',
});
