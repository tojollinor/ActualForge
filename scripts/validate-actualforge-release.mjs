import fs from 'node:fs';

const readJson = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const fail = message => {
  console.error('Release validation failed: ' + message);
  process.exit(1);
};

const release = readJson('ACTUALFORGE_RELEASE.json');
const base = readJson('ACTUALFORGE_BASE.json');
const financePackage = readJson('packages/finance-engine/package.json');
const releaseCompose = fs.readFileSync('compose.release.yaml', 'utf8');
const migrations = fs.readFileSync('packages/finance-engine/src/migrations.ts', 'utf8');
const plan = fs.readFileSync('docs/IMPLEMENTATION_PLAN.md', 'utf8');

if (release.project !== 'ActualForge') fail('unexpected project name');
if (!/^\d+\.\d+\.\d+$/.test(release.version)) fail('version is not semver');
if (release.tag !== 'v' + release.version) fail('tag does not match version');
if (release.actualBudget?.release !== base.upstream?.release) fail('Actual Budget release differs from base pin');
if (release.actualBudget?.commit !== base.upstream?.commit) fail('Actual Budget commit differs from base pin');
if (release.components?.financeEngineVersion !== financePackage.version) fail('finance-engine version differs from manifest');

const schemaVersion = release.components?.financeEngineSchemaVersion;
if (!Number.isInteger(schemaVersion) || !migrations.includes('version: ' + schemaVersion + ',')) {
  fail('finance-engine schema version is not present in migrations');
}

for (const [name, image] of Object.entries(release.images ?? {})) {
  if (typeof image !== 'string' || !image.endsWith(':' + release.version)) {
    fail(name + ' image is not pinned to the release version');
  }
  if (!releaseCompose.includes(image.split(':')[0] + ':')) {
    fail(name + ' image repository is missing from compose.release.yaml');
  }
}

if (releaseCompose.includes('\n    build:')) fail('release Compose must not contain build directives');
if (!releaseCompose.includes('ACTUALFORGE_TAG:-' + release.version)) fail('ActualForge release tag mismatch');
if (!releaseCompose.includes('FINANCE_ENGINE_TAG:-' + release.version)) fail('finance-engine release tag mismatch');
if (!fs.existsSync(release.releaseNotes)) fail('release notes file is missing');
if (!plan.includes('✅ Block 8 complete')) fail('implementation plan is not complete');

console.log('ActualForge release metadata valid: v' + release.version);
