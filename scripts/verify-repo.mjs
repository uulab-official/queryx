import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));
const version = readFileSync(join(root, "VERSION"), "utf8").trim();
const manifests = [
  "package.json",
  "apps/desktop/package.json",
  "packages/core/package.json",
  "packages/shared/package.json",
];
const errors = [];

if (!/^0\.\d+\.\d+$/.test(version) && !/^\d+\.\d+\.\d+$/.test(version))
  errors.push(`VERSION is not valid semver: ${version}`);
for (const manifest of manifests) {
  const manifestVersion = readJson(manifest).version;
  if (manifestVersion !== version)
    errors.push(`${manifest} has ${manifestVersion}; expected ${version}`);
}
const cargoManifest = readFileSync(
  join(root, "apps/desktop/src-tauri/Cargo.toml"),
  "utf8",
);
const cargoVersion = cargoManifest.match(/^version = "([^"]+)"/m)?.[1];
if (cargoVersion !== version)
  errors.push(
    `apps/desktop/src-tauri/Cargo.toml has ${cargoVersion}; expected ${version}`,
  );
const tauriVersion = readJson("apps/desktop/src-tauri/tauri.conf.json").version;
if (tauriVersion !== version)
  errors.push(
    `apps/desktop/src-tauri/tauri.conf.json has ${tauriVersion}; expected ${version}`,
  );
for (const required of [
  "README.md",
  "ROADMAP.md",
  "CHANGELOG.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  ".github/workflows/ci.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "docs/README.md",
  "docs/DOCUMENTATION_PLAN.md",
  "docs/getting-started.md",
  "docs/connections.md",
  "docs/sql-editor.md",
  "docs/metadata-explorer.md",
  "docs/results.md",
  "docs/troubleshooting.md",
  "docs/postgres-driver.md",
  "docs/testing.md",
  "docs/release-process.md",
]) {
  if (!existsSync(join(root, required)))
    errors.push(`Missing required file: ${required}`);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const markdownFiles = [
  join(root, "README.md"),
  join(root, "ROADMAP.md"),
  ...walk(join(root, "docs")).filter((file) => extname(file) === ".md"),
];
const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
for (const file of markdownFiles) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(linkPattern)) {
    const target = match[1].split("#")[0];
    if (
      !target ||
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("mailto:")
    )
      continue;
    const localTarget = resolve(dirname(file), target);
    if (!existsSync(localTarget))
      errors.push(`${file.replace(`${root}/`, "")} links to missing ${target}`);
  }
}

const workspaceFiles = [
  "apps/desktop/src/App.tsx",
  "apps/desktop/src/SqlEditor.tsx",
  "apps/desktop/src/store.ts",
  "apps/desktop/src/nativeDriver.ts",
  "apps/desktop/src/exportCsv.ts",
  "apps/desktop/src-tauri/src/lib.rs",
  "apps/desktop/src-tauri/src/driver.rs",
  "apps/desktop/src-tauri/src/driver_registry.rs",
  "apps/desktop/src-tauri/src/postgres_driver.rs",
  "apps/desktop/src-tauri/src/sqlite_driver.rs",
  "packages/shared/src/index.ts",
  "packages/core/src/inMemoryDriver.ts",
  "packages/core/src/csvExport.ts",
];
for (const file of workspaceFiles)
  if (!existsSync(join(root, file)))
    errors.push(`Missing workspace file: ${file}`);

if (errors.length > 0) {
  console.error(errors.map((error) => `✗ ${error}`).join("\n"));
  process.exit(1);
}
console.log(`✓ QueryX repository verified at v${version}`);
console.log(
  `✓ ${markdownFiles.length} Markdown files checked for local link integrity`,
);
