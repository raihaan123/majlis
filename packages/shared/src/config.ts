export interface ConfigTemplateAnswers {
  name: string;
  description: string;
  objective: string;
  metricsCommand: string;
  buildPre?: string | null;
  buildPost?: string | null;
}

export const DEFAULT_CONFIG = {
  project: {
    name: '',
    description: '',
    objective: '',
  },
  metrics: {
    command: 'echo \'{"fixtures":{}}\'',
    fixtures: {} as Record<string, { gate?: boolean }>,
    tracked: {},
  },
  build: {
    pre_measure: null,
    post_measure: null,
  },
  cycle: {
    compression_interval: 5,
    circuit_breaker_threshold: 3,
    require_doubt_before_verify: true,
    require_challenge_before_verify: false,
    auto_baseline_on_new_experiment: true,
  },
  models: {
    builder: 'opus',
    critic: 'opus',
    adversary: 'opus',
    verifier: 'opus',
    reframer: 'opus',
    compressor: 'opus',
    gatekeeper: 'sonnet',
    scout: 'opus',
  },
};

export function configTemplate(answers: ConfigTemplateAnswers): string {
  return JSON.stringify({
    project: {
      name: answers.name,
      description: answers.description,
      objective: answers.objective,
    },
    metrics: {
      command: answers.metricsCommand,
      fixtures: {},
      tracked: {},
    },
    build: {
      pre_measure: answers.buildPre || null,
      post_measure: answers.buildPost || null,
    },
    cycle: {
      compression_interval: 5,
      circuit_breaker_threshold: 3,
      require_doubt_before_verify: true,
      require_challenge_before_verify: false,
      auto_baseline_on_new_experiment: true,
    },
    models: {
      builder: 'opus',
      critic: 'opus',
      adversary: 'opus',
      verifier: 'opus',
      reframer: 'opus',
      compressor: 'opus',
      gatekeeper: 'sonnet',
      scout: 'opus',
    },
  }, null, 2);
}
