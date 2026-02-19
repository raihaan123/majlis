import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ManifestInfo {
  type: string;             // 'package.json' | 'Cargo.toml' | 'pyproject.toml' | 'go.mod' | 'Makefile'
  name: string;
  testCommand: string | null;
  buildCommand: string | null;
  extras: Record<string, string>;
}

export interface ProjectProfile {
  name: string;
  description: string;
  readmeExcerpt: string;
  primaryLanguage: string;
  languages: Record<string, number>;
  totalFiles: number;
  topLevelDirs: string[];
  fileTree: string;
  manifests: ManifestInfo[];
  buildSystem: string | null;
  testFramework: string | null;
  testCommand: string | null;
  buildCommand: string | null;
  hasCI: boolean;
  isMonorepo: boolean;
  workspaces: string[];
  sizeCategory: 'small' | 'medium' | 'large' | 'huge';
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', '__pycache__',
  'vendor', '.tox', '.venv', 'venv', '.next', '.nuxt', 'coverage',
  '.majlis', '.claude',
]);

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.c': 'C', '.h': 'C',
  '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++',
  '.cs': 'C#',
  '.swift': 'Swift',
  '.scala': 'Scala',
  '.ex': 'Elixir', '.exs': 'Elixir',
  '.zig': 'Zig',
  '.lua': 'Lua',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
};

// ─── File tree walker ───────────────────────────────────────────────────────────

interface WalkResult {
  totalFiles: number;
  extensions: Record<string, number>;
  topLevelDirs: string[];
  tree: string[];
}

function walkFileTree(root: string, maxDepth: number = 3): WalkResult {
  const extensions: Record<string, number> = {};
  let totalFiles = 0;
  const topLevelDirs: string[] = [];
  const tree: string[] = [];
  const MAX_ENTRIES_PER_DIR = 20;

  function walk(dir: string, depth: number, prefix: string): void {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort: dirs first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    let shown = 0;
    let hidden = 0;

    for (const entry of entries) {
      if (entry.name.startsWith('.') && depth === 0 && entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name) && entry.isDirectory()) continue;

      if (entry.isDirectory()) {
        if (depth === 0) topLevelDirs.push(entry.name);
        if (shown < MAX_ENTRIES_PER_DIR) {
          tree.push(`${prefix}${entry.name}/`);
          shown++;
          walk(path.join(dir, entry.name), depth + 1, prefix + '  ');
        } else {
          hidden++;
        }
      } else {
        totalFiles++;
        const ext = path.extname(entry.name).toLowerCase();
        if (ext) extensions[ext] = (extensions[ext] ?? 0) + 1;
        if (shown < MAX_ENTRIES_PER_DIR) {
          tree.push(`${prefix}${entry.name}`);
          shown++;
        } else {
          hidden++;
        }
      }
    }

    if (hidden > 0) {
      tree.push(`${prefix}... (${hidden} more)`);
    }
  }

  walk(root, 0, '');
  return { totalFiles, extensions, topLevelDirs, tree };
}

// ─── Language detection ─────────────────────────────────────────────────────────

function detectLanguages(extensions: Record<string, number>): {
  primaryLanguage: string;
  languages: Record<string, number>;
} {
  const languages: Record<string, number> = {};
  for (const [ext, count] of Object.entries(extensions)) {
    const lang = LANGUAGE_MAP[ext];
    if (lang) {
      languages[lang] = (languages[lang] ?? 0) + count;
    }
  }

  let primaryLanguage = 'Unknown';
  let maxCount = 0;
  for (const [lang, count] of Object.entries(languages)) {
    if (count > maxCount) {
      maxCount = count;
      primaryLanguage = lang;
    }
  }

  return { primaryLanguage, languages };
}

// ─── Manifest parsers ───────────────────────────────────────────────────────────

function parsePackageJson(root: string): ManifestInfo | null {
  const filePath = path.join(root, 'package.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const pkg = JSON.parse(raw);
    const scripts = pkg.scripts ?? {};

    let testCommand: string | null = null;
    if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
      testCommand = `npm test`;
    }

    let testFramework: string | null = null;
    const testScript = scripts.test ?? '';
    if (/jest/.test(testScript)) testFramework = 'jest';
    else if (/vitest/.test(testScript)) testFramework = 'vitest';
    else if (/mocha/.test(testScript)) testFramework = 'mocha';
    else if (/node --test|node:test/.test(testScript)) testFramework = 'node:test';

    return {
      type: 'package.json',
      name: pkg.name ?? '',
      testCommand,
      buildCommand: scripts.build ? 'npm run build' : null,
      extras: {
        ...(testFramework ? { testFramework } : {}),
        ...(pkg.workspaces ? { workspaces: JSON.stringify(pkg.workspaces) } : {}),
        ...(pkg.description ? { description: pkg.description } : {}),
      },
    };
  } catch { return null; }
}

function parseCargoToml(root: string): ManifestInfo | null {
  const filePath = path.join(root, 'Cargo.toml');
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const nameMatch = raw.match(/^name\s*=\s*"([^"]+)"/m);
    const isWorkspace = /\[workspace\]/.test(raw);
    const membersMatch = raw.match(/members\s*=\s*\[([\s\S]*?)\]/);
    return {
      type: 'Cargo.toml',
      name: nameMatch?.[1] ?? '',
      testCommand: 'cargo test',
      buildCommand: 'cargo build',
      extras: {
        testFramework: 'cargo test',
        ...(isWorkspace ? { workspace: 'true' } : {}),
        ...(membersMatch ? { members: membersMatch[1].replace(/\s+/g, ' ').trim() } : {}),
      },
    };
  } catch { return null; }
}

function parsePyprojectToml(root: string): ManifestInfo | null {
  const filePath = path.join(root, 'pyproject.toml');
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const nameMatch = raw.match(/^name\s*=\s*"([^"]+)"/m);
    const hasPytest = raw.includes('pytest') || fs.existsSync(path.join(root, 'pytest.ini'));
    return {
      type: 'pyproject.toml',
      name: nameMatch?.[1] ?? '',
      testCommand: hasPytest ? 'pytest' : 'python -m unittest discover',
      buildCommand: null,
      extras: {
        testFramework: hasPytest ? 'pytest' : 'unittest',
      },
    };
  } catch { return null; }
}

function parseGoMod(root: string): ManifestInfo | null {
  const filePath = path.join(root, 'go.mod');
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const moduleMatch = raw.match(/^module\s+(\S+)/m);
    return {
      type: 'go.mod',
      name: moduleMatch?.[1] ?? '',
      testCommand: 'go test ./...',
      buildCommand: 'go build ./...',
      extras: { testFramework: 'go test' },
    };
  } catch { return null; }
}

function parseMakefile(root: string): ManifestInfo | null {
  const filePath = path.join(root, 'Makefile');
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const hasTest = /^test\s*:/m.test(raw);
    const hasBuild = /^build\s*:/m.test(raw);
    return {
      type: 'Makefile',
      name: '',
      testCommand: hasTest ? 'make test' : null,
      buildCommand: hasBuild ? 'make build' : null,
      extras: {},
    };
  } catch { return null; }
}

// ─── CI detection ───────────────────────────────────────────────────────────────

function detectCI(root: string): boolean {
  const ciPaths = [
    '.github/workflows',
    '.gitlab-ci.yml',
    '.circleci/config.yml',
    'Jenkinsfile',
    '.travis.yml',
    'azure-pipelines.yml',
    'bitbucket-pipelines.yml',
  ];
  return ciPaths.some(p => fs.existsSync(path.join(root, p)));
}

// ─── Monorepo detection ────────────────────────────────────────────────────────

function detectMonorepo(root: string, manifests: ManifestInfo[]): {
  isMonorepo: boolean;
  workspaces: string[];
} {
  // npm/yarn workspaces via package.json
  const pkgManifest = manifests.find(m => m.type === 'package.json');
  if (pkgManifest?.extras.workspaces) {
    try {
      const ws = JSON.parse(pkgManifest.extras.workspaces);
      const workspaces = Array.isArray(ws) ? ws : (ws.packages ?? []);
      if (workspaces.length > 0) return { isMonorepo: true, workspaces };
    } catch { /* fall through */ }
  }

  // pnpm workspace
  if (fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))) {
    try {
      const raw = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf-8');
      const pkgMatches = raw.match(/-\s*['"]?([^'":\n]+)/g) ?? [];
      const workspaces = pkgMatches.map(m => m.replace(/^-\s*['"]?/, '').replace(/['"]?$/, ''));
      return { isMonorepo: true, workspaces };
    } catch { /* fall through */ }
  }

  // lerna.json
  if (fs.existsSync(path.join(root, 'lerna.json'))) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(root, 'lerna.json'), 'utf-8'));
      return { isMonorepo: true, workspaces: raw.packages ?? ['packages/*'] };
    } catch {
      return { isMonorepo: true, workspaces: ['packages/*'] };
    }
  }

  // Cargo workspace
  const cargoManifest = manifests.find(m => m.type === 'Cargo.toml');
  if (cargoManifest?.extras.workspace === 'true') {
    const members = cargoManifest.extras.members
      ? cargoManifest.extras.members.replace(/"/g, '').split(',').map(s => s.trim()).filter(Boolean)
      : [];
    return { isMonorepo: true, workspaces: members };
  }

  return { isMonorepo: false, workspaces: [] };
}

// ─── README ─────────────────────────────────────────────────────────────────────

function readReadme(root: string): string {
  for (const name of ['README.md', 'readme.md', 'README.rst', 'README.txt', 'README']) {
    const filePath = path.join(root, name);
    if (fs.existsSync(filePath)) {
      try {
        return fs.readFileSync(filePath, 'utf-8').slice(0, 500);
      } catch { /* fall through */ }
    }
  }
  return '';
}

// ─── Size categorisation ────────────────────────────────────────────────────────

function categoriseSize(totalFiles: number): ProjectProfile['sizeCategory'] {
  if (totalFiles < 500) return 'small';
  if (totalFiles < 5_000) return 'medium';
  if (totalFiles < 50_000) return 'large';
  return 'huge';
}

// ─── Main scan function ─────────────────────────────────────────────────────────

export function surfaceScan(root: string): ProjectProfile {
  // Walk file tree
  const { totalFiles, extensions, topLevelDirs, tree } = walkFileTree(root);

  // Detect languages
  const { primaryLanguage, languages } = detectLanguages(extensions);

  // Parse manifests
  const manifests: ManifestInfo[] = [];
  const parsers = [parsePackageJson, parseCargoToml, parsePyprojectToml, parseGoMod, parseMakefile];
  for (const parser of parsers) {
    const result = parser(root);
    if (result) manifests.push(result);
  }

  // Infer build/test commands from manifests
  let buildCommand: string | null = null;
  let testCommand: string | null = null;
  let testFramework: string | null = null;
  let buildSystem: string | null = null;

  for (const m of manifests) {
    if (!testCommand && m.testCommand) testCommand = m.testCommand;
    if (!buildCommand && m.buildCommand) buildCommand = m.buildCommand;
    if (!testFramework && m.extras.testFramework) testFramework = m.extras.testFramework;
    if (!buildSystem) {
      switch (m.type) {
        case 'package.json': buildSystem = 'npm'; break;
        case 'Cargo.toml': buildSystem = 'cargo'; break;
        case 'pyproject.toml': buildSystem = 'pip'; break;
        case 'go.mod': buildSystem = 'go'; break;
        case 'Makefile': buildSystem = 'make'; break;
      }
    }
  }

  // Detect CI
  const hasCI = detectCI(root);

  // Detect monorepo
  const { isMonorepo, workspaces } = detectMonorepo(root, manifests);

  // Read README
  const readmeExcerpt = readReadme(root);

  // Project name + description from first manifest
  const primaryManifest = manifests[0];
  const name = primaryManifest?.name || path.basename(root);
  const description = primaryManifest?.extras.description || '';

  return {
    name,
    description,
    readmeExcerpt,
    primaryLanguage,
    languages,
    totalFiles,
    topLevelDirs,
    fileTree: tree.join('\n'),
    manifests,
    buildSystem,
    testFramework,
    testCommand,
    buildCommand,
    hasCI,
    isMonorepo,
    workspaces,
    sizeCategory: categoriseSize(totalFiles),
  };
}
