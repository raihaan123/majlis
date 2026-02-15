// Raw ANSI codes — no chalk dependency

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';

export function bold(s: string): string { return `${BOLD}${s}${RESET}`; }
export function dim(s: string): string { return `${DIM}${s}${RESET}`; }
export function red(s: string): string { return `${RED}${s}${RESET}`; }
export function green(s: string): string { return `${GREEN}${s}${RESET}`; }
export function yellow(s: string): string { return `${YELLOW}${s}${RESET}`; }
export function blue(s: string): string { return `${BLUE}${s}${RESET}`; }
export function cyan(s: string): string { return `${CYAN}${s}${RESET}`; }

export function statusColor(status: string): string {
  switch (status) {
    case 'merged': return green(status);
    case 'dead_end': return red(status);
    case 'building':
    case 'built':
      return blue(status);
    case 'verifying':
    case 'verified':
      return cyan(status);
    case 'classified':
    case 'reframed':
      return dim(status);
    default: return yellow(status);
  }
}

export function gradeColor(grade: string): string {
  switch (grade) {
    case 'sound': return green(grade);
    case 'good': return cyan(grade);
    case 'weak': return yellow(grade);
    case 'rejected': return red(grade);
    default: return grade;
  }
}

export function evidenceColor(level: string): string {
  switch (level) {
    case 'proof': return green(level);
    case 'test': return cyan(level);
    case 'strong_consensus': return blue(level);
    case 'consensus': return blue(level);
    case 'analogy': return yellow(level);
    case 'judgment': return red(level);
    default: return level;
  }
}

/**
 * Format data as a simple table with column headers.
 */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => stripAnsi(r[i] ?? '').length))
  );

  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  const separator = widths.map(w => '─'.repeat(w)).join('──');
  const bodyLines = rows.map(row =>
    row.map((cell, i) => {
      const stripped = stripAnsi(cell);
      const padding = widths[i] - stripped.length;
      return cell + ' '.repeat(Math.max(0, padding));
    }).join('  ')
  );

  return [bold(headerLine), separator, ...bodyLines].join('\n');
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Print header banner for a command.
 */
export function header(title: string): void {
  console.log(`\n${bold(`[majlis] ${title}`)}\n`);
}

/**
 * Print a warning.
 */
export function warn(msg: string): void {
  console.log(`${yellow('[majlis]')} ${msg}`);
}

/**
 * Print an info message.
 */
export function info(msg: string): void {
  console.log(`${cyan('[majlis]')} ${msg}`);
}

/**
 * Print a success message.
 */
export function success(msg: string): void {
  console.log(`${green('[majlis]')} ${msg}`);
}
