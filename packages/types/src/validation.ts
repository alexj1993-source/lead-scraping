import type { EmailValidationResult } from './lead';

export type ValidationProvider = 'neverbounce' | 'bounceban';

export interface ValidationResult {
  email: string;
  neverbounce?: EmailValidationResult;
  bounceban?: EmailValidationResult;
  bouncebanScore?: number;
  isValid: boolean;
  isRoleBased: boolean;
}
