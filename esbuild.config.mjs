import { build } from 'esbuild'

// Bundle the plugin worker entry to a single ESM file. Zero runtime
// dependencies, so the output is self-contained plain Node.
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/main.mjs',
  sourcemap: true,
  logLevel: 'info'
})
