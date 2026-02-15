import * as readline from 'node:readline';

export interface ProjectAnswers {
  name: string;
  description: string;
  objective: string;
  metricsCommand: string;
  buildPre: string;
  buildPost: string;
}

const DEFAULTS: ProjectAnswers = {
  name: '',
  description: '',
  objective: '',
  metricsCommand: 'echo \'{"fixtures":{}}\'',
  buildPre: '',
  buildPost: '',
};

function ask(rl: readline.Interface, question: string, defaultVal: string): Promise<string> {
  const suffix = defaultVal ? ` (${defaultVal})` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

export async function runPrompts(projectName?: string): Promise<ProjectAnswers> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('\n\x1b[1mMajlis Framework — Project Setup\x1b[0m\n');

    const name = projectName || await ask(rl, 'Project name', DEFAULTS.name);
    const description = await ask(rl, 'Description', DEFAULTS.description);
    const objective = await ask(rl, 'Primary objective (what are you trying to solve?)', DEFAULTS.objective);
    const metricsCommand = await ask(rl, 'Metrics command (JSON output)', DEFAULTS.metricsCommand);
    const buildPre = await ask(rl, 'Pre-measure command (e.g., npm run build)', DEFAULTS.buildPre);
    const buildPost = await ask(rl, 'Post-measure command (optional)', DEFAULTS.buildPost);

    return { name, description, objective, metricsCommand, buildPre, buildPost };
  } finally {
    rl.close();
  }
}

export function defaultAnswers(projectName: string): ProjectAnswers {
  return { ...DEFAULTS, name: projectName };
}
