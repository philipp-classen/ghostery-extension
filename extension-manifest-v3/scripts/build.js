/**
 * Ghostery Browser Extension
 * https://www.ghostery.com/
 *
 * Copyright 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0
 */

import { resolve, dirname, join } from 'path';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { exec, execSync } from 'child_process';
import { build } from 'vite';
import shelljs from 'shelljs';
import webExt from 'web-ext';

import REGIONS from '../src/utils/regions.js';

const pwd = process.cwd();

const options = {
  srcDir: resolve(pwd, 'src'),
  outDir: resolve(pwd, 'dist'),
  assets: ['_locales', 'icons'],
};

// Generate arguments from command line
const argv = process.argv.slice(2).reduce(
  (acc, arg) => {
    if (arg.startsWith('--')) {
      if (arg.includes('=')) {
        const [key, value] = arg.slice(2).split('=');
        acc[key] = value;
      } else {
        acc[arg.slice(2)] = true;
      }
    } else {
      acc.target = arg;
    }
    return acc;
  },
  { target: 'chromium' },
);

const pkg = JSON.parse(readFileSync(resolve(pwd, 'package.json'), 'utf8'));

// Get manifest from source directory
console.log(`Reading manifest.${argv.target}.json...`);
const manifest = JSON.parse(
  readFileSync(resolve(options.srcDir, `manifest.${argv.target}.json`), 'utf8'),
);

// Clear out Safari platform suffix
if (argv.target.startsWith('safari')) {
  argv.target = 'safari';
}

// Add flags to manifest
if (argv.debug) manifest.debug = true;
if (argv.staging) manifest.staging = true;

// Download adblocker engines
execSync('npm run download-engines' + (argv.staging ? ' -- --staging' : ''), {
  stdio: 'inherit',
});

execSync('npm run download-wtm-bloomfilter', { stdio: 'inherit' });
execSync('npm run download-wtm-stats', { stdio: 'inherit' });

const config = {
  logLevel: argv.silent ? 'silent' : undefined,
  configFile: false,
  root: options.srcDir,
  resolve: {
    preserveSymlinks: true,
  },
  define: { __PLATFORM__: JSON.stringify(argv.target) },
  build: {
    outDir: options.outDir,
    assetsDir: '',
    emptyOutDir: false,
    minify: false,
    modulePreload: {
      polyfill: false,
    },
    watch: argv.watch ? {} : null,
  },
};

// --- Generate dist structure ---

// generate dist folder
shelljs.rm('-rf', options.outDir);
shelljs.mkdir('-p', options.outDir);

// copy static assets
options.assets.forEach((path) => {
  shelljs.mkdir('-p', resolve(options.outDir, path));
  shelljs.cp(
    '-r',
    resolve(options.srcDir, path, '*'),
    resolve(options.outDir, path),
  );
});

// copy adblocker engines
shelljs.mkdir('-p', resolve(options.outDir, 'rule_resources'));

const engines = [
  'ads',
  'tracking',
  'annoyances',
  'fixes',
  ...REGIONS.map((region) => `lang-${region}`),
];
const engineType = argv.target === 'firefox' ? '' : '-cosmetics';

engines.forEach((engine) => {
  const path = `engine-${engine}${engineType}.dat`;
  const result = shelljs.cp(
    resolve(options.srcDir, 'rule_resources', path),
    resolve(options.outDir, 'rule_resources'),
  );
  if (result.stderr) process.exit(1);
});

// copy trackerdb engine
const trackerdbResult = shelljs.cp(
  resolve(options.srcDir, 'rule_resources', 'engine-trackerdb.dat'),
  resolve(options.outDir, 'rule_resources'),
);
if (trackerdbResult.stderr) process.exit(1);

// copy declarative net request lists
if (manifest.declarative_net_request?.rule_resources) {
  let rulesCount = 0;

  manifest.declarative_net_request.rule_resources.forEach(({ path }) => {
    const dir = dirname(path);
    const sourcePath = resolve(options.srcDir, path);
    const destPath = resolve(options.outDir, dir);

    // open json file
    if (argv.target === 'safari') {
      const list = JSON.parse(readFileSync(sourcePath, 'utf8'));
      rulesCount += list?.length;
    }

    shelljs.mkdir('-p', destPath);
    const result = shelljs.cp(sourcePath, destPath);
    if (result.stderr) process.exit(1);
  });

  if (argv.target === 'safari') {
    console.log('Declarative Net Request rules:', rulesCount);

    // https://github.com/WebKit/WebKit/blob/c85962a5c0e929991e5963811da957b75d1501db/Source/WebCore/contentextensions/ContentExtensionCompiler.cpp#L199
    if (rulesCount > 75000) {
      throw new Error(
        `Warning: The number of rules exceeds the limit of 75k rules.`,
      );
    }
  }

  // copy redirect rule resources
  shelljs.mkdir('-p', resolve(options.outDir, 'rule_resources/redirects'));
  shelljs.cp(
    '-r',
    resolve(options.srcDir, 'rule_resources/redirects', '*'),
    resolve(options.outDir, 'rule_resources/redirects'),
  );

  // append web_accessible_resources
  const redirectResources = readdirSync(
    resolve(options.srcDir, 'rule_resources/redirects'),
  );

  if (manifest.manifest_version === 3) {
    manifest.web_accessible_resources.push({
      resources: redirectResources.map((filename) =>
        join('rule_resources/redirects', filename),
      ),
      all_frames: true,
      matches: ['<all_urls>'],
    });
  } else {
    redirectResources.forEach((filename) =>
      manifest.web_accessible_resources.push(
        join('rule_resources/redirects', filename),
      ),
    );
  }
}

// generate license file
execSync('npm run licenses', { stdio: 'inherit' });

// --- Save manifest ---

// set manifest version from package.json
manifest.version = pkg.version;

if (manifest.permissions.includes('declarativeNetRequest') && argv.watch) {
  manifest.permissions.push('declarativeNetRequestFeedback');
}

writeFileSync(
  resolve(options.outDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2),
);

// --- Generate entry points ---

const source = [];
const content_scripts = [];

if (manifest.action?.default_popup) {
  source.push(manifest.action.default_popup);
}

if (manifest.browser_action?.default_popup) {
  source.push(manifest.browser_action.default_popup);
}

// offscreen documents
if (
  manifest.permissions.includes('offscreen') ||
  manifest.optional_permissions?.includes('offscreen')
) {
  readdirSync(join(options.srcDir, 'pages', 'offscreen'), {
    withFileTypes: true,
  })
    .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.'))
    .forEach((dirent) =>
      source.push(join('pages', 'offscreen', dirent.name, 'index.html')),
    );
}

// options page
if (manifest.options_ui?.page) {
  source.push(manifest.options_ui?.page);
}

// content scripts
manifest.content_scripts?.forEach(({ js = [], css = [] }) => {
  [...js, ...css].forEach((src) => content_scripts.push(src));
});

// web-accessible resources
manifest.web_accessible_resources?.forEach((entry) => {
  const paths = [];

  if (typeof entry === 'string') {
    paths.push(entry);
  } else {
    entry.resources.forEach((src) => paths.push(src));
  }

  paths.forEach((path) => {
    if (path.includes('/redirects/')) {
      return;
    }
    if (!path.match(/\.(js|css|html)$/)) {
      const dir = dirname(path);
      shelljs.mkdir('-p', resolve(options.outDir, dir));
      shelljs.cp('', path, resolve(options.outDir, dir));
    } else {
      if (path.match(/\.html$/)) {
        source.push(path);
      } else {
        content_scripts.push(path);
      }
    }
  });
});

// background
if (manifest.background) {
  source.push(
    manifest.background.service_worker ||
      manifest.background.page ||
      manifest.background.scripts[0],
  );
}

// --- Build  ---

function mapPaths(paths) {
  return paths.reduce((acc, src) => {
    acc[src.replace(/\.js/, '')] = src.startsWith('node_modules')
      ? resolve(src)
      : resolve(options.srcDir, src);
    return acc;
  }, {});
}

const buildPromise = build({
  ...config,
  build: {
    ...config.build,
    target: 'esnext',
    rollupOptions: {
      input: mapPaths(source),
      preserveEntrySignatures: 'exports-only',
      output: {
        banner:
          argv.target === 'firefox' &&
          'globalThis.chrome = globalThis.browser;\n',
        dir: options.outDir,
        manualChunks: false,
        preserveModules: true,
        preserveModulesRoot: 'src',
        minifyInternalExports: false,
        entryFileNames: '[name].js',
        assetFileNames: 'assets/[name].[ext]',
        sanitizeFileName: (name) => {
          name = name
            .replace(/[\0?*]+/g, '_') // eslint-disable-line no-control-regex
            .replace('node_modules', 'npm')
            .replace('_virtual', 'virtual');

          const path = name.replace(resolve(pwd, '..'), '');
          if (path.length > 100 && !argv['no-filename-limit']) {
            throw new Error(
              `Filename too long: ${path} (${path.length}) (pass --no-filename-limit to disable; for instance, "npm run build firefox -- --no-filename-limit")`,
            );
          }

          return name;
        },
      },
    },
  },
});

// --- Build content scripts ---

for (const [id, path] of Object.entries(mapPaths(content_scripts))) {
  // Copy assets
  if (!path.endsWith('.js')) {
    shelljs.mkdir(
      '-p',
      resolve(options.outDir, id.split('/').slice(0, -1).join('/')),
    );
    shelljs.cp(
      path.replace('node_modules', '../node_modules'),
      resolve(options.outDir, id),
    );
  } else {
    // build content scripts
    build({
      ...config,
      build: {
        ...config.build,
        target: 'esnext',
        rollupOptions: {
          input: { [id]: path },
          output: {
            banner:
              argv.target === 'firefox' &&
              'globalThis.chrome = globalThis.browser;\n',
            format: 'iife',
            dir: options.outDir,
            entryFileNames: '[name].js',
          },
        },
      },
    });
  }
}

if (argv.watch) {
  buildPromise.then((watchEmitter) =>
    watchEmitter.on('event', function callback(e) {
      if (e.code === 'BUNDLE_END') {
        watchEmitter.off('event', callback);

        let settings;
        switch (argv.target) {
          case 'safari':
            exec('xed xcode');
            return;
          case 'firefox':
            settings = {
              target: 'firefox-desktop',
              devtools: true,
              firefoxBinary:
                '/Applications/Firefox Nightly.app/Contents/MacOS/firefox-bin',
            };
            break;
          case 'chromium': {
            settings = { target: 'chromium' };

            if (argv.browser === 'opera') {
              settings.chromiumBinary =
                '/Applications/Opera.app/Contents/MacOS/Opera';
            } else if (argv.browser === 'edge') {
              settings.chromiumBinary =
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
            }

            break;
          }
          default:
            break;
        }

        webExt.cmd.run({
          ...settings,
          noReload: true,
          sourceDir: options.outDir,
        });
      }
    }),
  );
}
