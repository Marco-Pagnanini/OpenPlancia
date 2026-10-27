// electron-builder afterPack hook. node-pty starts every shell through `spawn-helper`; npm
// does not always keep its executable bit (the copies in node-pty/prebuilds have none), and
// without it every terminal fails with "posix_spawnp failed".
const { chmodSync, existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

function helpers(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name === 'spawn-helper')
    .map((entry) => join(entry.parentPath, entry.name));
}

/** @param {{ appOutDir: string, electronPlatformName: string, packager: { appInfo: { productFilename: string } } }} context */
exports.default = function afterPack(context) {
  if (context.electronPlatformName === 'win32') return;
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : join(context.appOutDir, 'resources');
  const found = helpers(join(resources, 'app.asar.unpacked', 'node_modules', 'node-pty'));
  for (const file of found) chmodSync(file, 0o755);
  console.log(`  • afterPack       spawn-helper made executable: ${found.length}`);
};
