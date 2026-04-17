import { getSequenceTemplate, type SequenceStep } from '@hyperscale/config';

export interface ResolvedSequenceStep {
  step: number;
  delay_days: number;
  subject: string;
  body: string;
}

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Maps our template variable names to Instantly's variable format.
 * Instantly resolves {{first_name}} from the lead record and
 * {{custom.<key>}} from custom_variables on the lead.
 */
const INSTANTLY_VARIABLE_MAP: Record<string, string> = {
  firstName: '{{first_name}}',
  leadMagnet: '{{custom.leadMagnet}}',
};

export function loadTemplate(source: string): SequenceStep[] {
  const template = getSequenceTemplate(source);
  if (!template) {
    throw new Error(`No sequence template found for source: ${source}`);
  }
  return template;
}

/**
 * Resolve template variables with actual lead data.
 * Used for previewing what a lead will see.
 */
export function resolveSequence(
  steps: SequenceStep[],
  variables: Record<string, string>,
): ResolvedSequenceStep[] {
  return steps.map((step) => ({
    step: step.step,
    delay_days: step.delay_days,
    subject: resolveVariables(step.subject, variables),
    body: resolveVariables(step.body, variables),
  }));
}

/**
 * Convert our template variables into Instantly's format for campaign setup.
 * e.g. {{firstName}} → {{first_name}}, {{leadMagnet}} → {{custom.leadMagnet}}
 */
export function toInstantlyFormat(steps: SequenceStep[]): ResolvedSequenceStep[] {
  return steps.map((step) => ({
    step: step.step,
    delay_days: step.delay_days,
    subject: mapToInstantlyVars(step.subject),
    body: mapToInstantlyVars(step.body),
  }));
}

function resolveVariables(template: string, variables: Record<string, string>): string {
  return template.replace(VARIABLE_PATTERN, (match, key) => variables[key] ?? match);
}

function mapToInstantlyVars(template: string): string {
  return template.replace(VARIABLE_PATTERN, (match, key) => {
    return INSTANTLY_VARIABLE_MAP[key] ?? match;
  });
}
