import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import ts from 'typescript';

const sdkUrl = 'https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js';
const documentUrl = 'https://www.bilibili.com/toy/publish/sdk';
const repositoryUrl = 'https://api.github.com/repos/bilibili/toy/commits/main';
const cliVersionUrl = 'https://boss.hdslb.com/toy-cli/toy/latest/VERSION';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const textDecoder = new TextDecoder('utf-8', { fatal: true });

async function download(url, maxBytes) {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
    headers: { accept: '*/*' },
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} from ${url}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error(`Response exceeds size limit: ${url}`);
    chunks.push(chunk);
  }
  let bytes = Buffer.concat(chunks);
  // Some CDN responses include a gzip body without Content-Encoding.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const { gunzipSync } = await import('node:zlib');
    bytes = gunzipSync(bytes, { maxOutputLength: maxBytes });
  }
  return { bytes, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') };
}

function sourceFile(filename, text) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`Could not parse ${filename}`);
  return source;
}

function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, child => visit(child, fn));
}

function assignmentOwner(source) {
  let owner;
  const declarations = new Map();
  visit(source, node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.set(node.name.text, node.initializer);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && node.left.expression.getText(source) === 'window'
      && node.left.name.text === 'toy' && ts.isIdentifier(node.right)) {
      if (owner) throw new Error('Multiple window.toy assignments');
      owner = node.right.text;
    }
  });
  const instance = declarations.get(owner);
  if (!instance || !ts.isNewExpression(instance)) throw new Error('Could not locate SDK instance');
  const sdk = declarations.get(instance.expression.getText(source));
  if (!sdk || !ts.isClassExpression(sdk)) throw new Error('Could not locate SDK class');
  return sdk;
}

function inspectSdk(bytes) {
  const text = textDecoder.decode(bytes);
  const sdk = assignmentOwner(sourceFile('upstream.js', text));
  const methods = sdk.members.filter(ts.isMethodDeclaration).map(member => {
    if (!ts.isIdentifier(member.name)) throw new Error('Unrecognized SDK method declaration');
    return member.name.text;
  }).sort();
  return {
    sha256: sha256(bytes),
    bytes: bytes.length,
    version: text.match(/\bsdk_version\s*:\s*[`"'](\d+\.\d+\.\d+)[`"']/)?.[1] ?? null,
    methods,
  };
}

function inspectDocument(text) {
  let declaration;
  let updatedAt;
  visit(sourceFile('publish-doc.js', text), node => {
    if (ts.isNoSubstitutionTemplateLiteral(node) && node.text.includes('declare namespace ToySDK')) {
      if (declaration) throw new Error('Multiple Toy SDK declarations in documentation');
      declaration = node.text;
    }
    if (ts.isPropertyAssignment(node) && node.name.getText() === 'updatedAt'
      && ts.isObjectLiteralExpression(node.parent)
      && node.parent.properties.some(prop => ts.isPropertyAssignment(prop) && prop.name.getText() === 'title'
        && prop.initializer.text === 'Toy JS SDK 能力清单')) {
      updatedAt = node.initializer.text;
    }
  });
  if (!declaration || !updatedAt) throw new Error('Could not find SDK declaration or date in official documentation');
  const source = sourceFile('toy-sdk.d.ts', declaration);
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  const fingerprints = Object.create(null);
  let methodHashes;
  visit(source, node => {
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      fingerprints[name] = sha256(printer.printNode(ts.EmitHint.Unspecified, node, source));
      if (name === 'Toy' && ts.isInterfaceDeclaration(node)) {
        methodHashes = Object.fromEntries(node.members.filter(ts.isMethodSignature)
          .map(member => [member.name.getText(source), sha256(printer.printNode(ts.EmitHint.Unspecified, member, source))]));
      }
    }
  });
  if (!methodHashes || Object.keys(methodHashes).length === 0) throw new Error('Could not extract documented methods');
  return { updatedAt, declarationSha256: sha256(declaration), methodHashes, typeHashes: fingerprints };
}

async function fetchDocument() {
  const { bytes } = await download(documentUrl, 512 * 1024);
  const html = textDecoder.decode(bytes);
  const asset = html.match(/(?:https:)?\/\/s1\.hdslb\.com\/bfs\/static\/toy\/app\/publish\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!asset) throw new Error('Could not find official documentation asset');
  const url = new URL(asset, documentUrl).href;
  const script = await download(url, 4 * 1024 * 1024);
  return { url, ...inspectDocument(textDecoder.decode(script.bytes)) };
}

function diffKeys(current, stable) {
  return {
    added: Object.keys(current).filter(name => !Object.hasOwn(stable, name)).sort(),
    removed: Object.keys(stable).filter(name => !Object.hasOwn(current, name)).sort(),
    changed: Object.keys(current).filter(name => Object.hasOwn(stable, name) && current[name] !== stable[name]).sort(),
  };
}

function compare(candidate, stable) {
  const diff = {
    sdk: {
      hashChanged: candidate.sdk.sha256 !== stable.sdk.sha256,
      versionChanged: candidate.sdk.version !== stable.sdk.version,
      ...diffKeys(Object.fromEntries(candidate.sdk.methods.map(name => [name, true])),
        Object.fromEntries(stable.sdk.methods.map(name => [name, true]))),
    },
  };
  if (candidate.document) {
    diff.document = {
      dateChanged: candidate.document.updatedAt !== stable.document.updatedAt,
      declarationChanged: candidate.document.declarationSha256 !== stable.document.declarationSha256,
      methods: diffKeys(candidate.document.methodHashes, stable.document.methodHashes),
      types: diffKeys(candidate.document.typeHashes, stable.document.typeHashes),
    };
  }
  if (candidate.repository) diff.repositoryChanged = candidate.repository.commit !== stable.repository.commit;
  if (candidate.cli) {
    diff.cliVersionChanged = candidate.cli.version !== stable.cli.version;
    diff.cliBinaryChanged = candidate.cli.linuxX64Sha256 !== stable.cli.linuxX64Sha256;
  }
  return diff;
}

async function main() {
  const { values } = parseArgs({
    options: {
      sdk: { type: 'string' }, output: { type: 'string', default: 'dist/sdk-monitor' },
      baseline: { type: 'string', default: 'upstream/stable/manifest.json' },
    },
  });
  const local = values.sdk;
  const candidate = { checkedAt: new Date().toISOString() };
  if (local) {
    const file = await stat(local);
    if (!file.isFile() || file.size > 2 * 1024 * 1024) throw new Error('Offline SDK must be a regular file up to 2 MiB');
    const bytes = await readFile(local);
    if (bytes.length > 2 * 1024 * 1024) throw new Error('Offline SDK exceeds size limit');
    candidate.sdk = { url: sdkUrl, source: 'offline', ...inspectSdk(bytes) };
  } else {
    const [sdk, document, repository, cli] = await Promise.all([
      download(sdkUrl, 2 * 1024 * 1024), fetchDocument(),
      download(repositoryUrl, 512 * 1024), download(cliVersionUrl, 4096),
    ]);
    candidate.sdk = { url: sdkUrl, etag: sdk.etag, lastModified: sdk.lastModified, ...inspectSdk(sdk.bytes) };
    candidate.document = document;
    const commit = JSON.parse(textDecoder.decode(repository.bytes)).sha;
    const version = textDecoder.decode(cli.bytes).trim();
    if (!/^[a-f0-9]{40}$/.test(commit) || !/^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) {
      throw new Error('Unrecognized official repository or CLI version');
    }
    candidate.repository = { url: repositoryUrl, commit };
    const checksumUrl = new URL(`../releases/${version}/toy_linux_amd64.sha256`, cliVersionUrl).href;
    const checksum = await download(checksumUrl, 4096);
    const digest = textDecoder.decode(checksum.bytes).trim().split(/\s/)[0];
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Unrecognized official CLI archive checksum');
    candidate.cli = { url: cliVersionUrl, version, checksumUrl, linuxX64Sha256: digest };
  }

  await mkdir(values.output, { recursive: true });
  await writeFile(join(values.output, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n');
  const stable = JSON.parse(await readFile(values.baseline, 'utf8'));
  const report = compare(candidate, stable);
  const output = JSON.stringify(report, null, 2) + '\n';
  await writeFile(join(values.output, 'diff.json'), output);
  console.log(output.trimEnd());
  if (process.env.GITHUB_OUTPUT) {
    const changed = report.sdk.hashChanged || report.document?.declarationChanged || report.document?.dateChanged
      || report.repositoryChanged || report.cliVersionChanged || report.cliBinaryChanged;
    const { appendFile } = await import('node:fs/promises');
    // The fingerprint excludes timestamps and CDN cache headers.
    const fingerprint = sha256(JSON.stringify([
      candidate.sdk.sha256, candidate.document?.declarationSha256, candidate.document?.updatedAt,
      candidate.repository?.commit, candidate.cli?.version, candidate.cli?.linuxX64Sha256,
    ])).slice(0, 12);
    await appendFile(process.env.GITHUB_OUTPUT, `changed=${Boolean(changed)}\nfingerprint=${fingerprint}\n`);
  }
}

await main();
