import * as esbuild from 'esbuild';
import tailwindPlugin from 'esbuild-plugin-tailwindcss';
import fs from 'fs/promises';
import path from 'path';

const buildOptions = {
  entryPoints: ['src/public/index.ts', 'src/index.css'],
  bundle: true,
  outdir: 'public',
  minify: true,
  sourcemap: true,
  plugins: [tailwindPlugin({})],
};

// Delete previous builds
{
  const files = await fs.readdir('public');
  for (const file of files) {
    if (/^index(.*)?\.(js|css)(\.map)?/.test(file)) {
      await fs.rm(path.join('public', file));
    }
  }
}

if (process.argv[2] === 'build') {
  await esbuild.build({
    ...buildOptions,
    entryNames: '[name]-[hash]',
  });

  const files = await fs.readdir('public');
  const indexCss = files.find((file) => /^index-.*\.css/.test(file));
  const indexJs = files.find((file) => /^index-.*\.js/.test(file));
  await fs.writeFile(
    '.env.client.prod',
    `INDEX_CSS_NAME="${indexCss}"\nINDEX_JS_NAME="${indexJs}"`,
    'utf-8'
  );
} else if (process.argv[2] === 'watch') {
  const ctx = await esbuild.context({
    ...buildOptions,
    entryNames: '[name]',
  });

  await ctx.watch();
  console.log('watching');
} else {
  console.error(`Unknown command ${process.argv[2]}`);
  process.exit(1);
}
