// Type augmentation for the vitest-axe `toHaveNoViolations` matcher.
// vitest 5's Assertion interface is generic over <R, T>; the matcher is
// registered at runtime via expect.extend in the a11y tests.
import 'vitest'
import type { AxeMatchers } from 'vitest-axe'

declare module 'vitest' {
  /** `expect(...)` gains `toHaveNoViolations` (R and T are vitest's own type parameters, unused here). */
  interface Assertion<R, T> extends AxeMatchers {}
  /** The same matcher inside asymmetric matchers such as `expect.objectContaining`. */
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
