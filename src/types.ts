/** Public option + IR types for the walkthrough library. */

export interface StepOptions {
  /** When to capture relative to the step's action. Defaults vary by helper:
   *  `act` → 'before' (show the highlighted target before acting);
   *  `step`/`check`/`screenshot` → 'after' (show the resulting state). */
  screenshot?: 'before' | 'after' | 'both' | 'none';
  /** Capture the full scrollable page rather than just the viewport. */
  fullPage?: boolean;
  /** Settle hook run immediately before a screenshot is taken — e.g. wait for a
   *  loading spinner to disappear or content to render. Errors are swallowed so
   *  a flaky settle never fails the test. */
  waitFor?: () => Promise<void>;
}

export type StepKind =
  | 'intro' | 'section' | 'step' | 'act' | 'note' | 'check' | 'outro' | 'screenshot';

export interface Rect { x: number; y: number; width: number; height: number }

export interface IRScreenshot {
  phase: 'before' | 'after';
  /** Path relative to the walkthrough's own directory, e.g. `assets/01-foo.png`. */
  path: string;
}

export interface IRStep {
  index: number;
  kind: StepKind;
  /** Markdown narration; also used as image alt text. */
  narration: string;
  target?: { selector?: string; box?: Rect | null };
  screenshots: IRScreenshot[];
}

export interface WalkthroughIR {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  tags: string[];
  source: { file: string; line: number };
  status: 'complete' | 'incomplete' | 'failed';
  generatedAt: string;
  environment: {
    viewport: { width: number; height: number } | null;
    browser: string;
  };
  steps: IRStep[];
}
