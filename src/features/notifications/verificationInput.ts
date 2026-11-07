export const RESEND_WAIT_MS = 60_000;

/** Normalize the complete clipboard value before the input's maxlength truncates it. */
export function normalizeVerificationCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

export function remainingSeconds(deadline: number | null, now = Date.now()): number {
  return deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
}
