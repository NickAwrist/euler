/** Explains that shell rules compare command text and do not replace the OS sandbox. */
export function ShellRuleNote() {
  return (
    <p className="text-[0.6875rem] text-muted-foreground">
      Shell rules compare command text as a guardrail. The OS sandbox still
      limits what commands can access.
    </p>
  );
}
