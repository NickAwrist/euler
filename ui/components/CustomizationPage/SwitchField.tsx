import { EnableSwitch } from "../ModelPreferenceControls";

/** A switch with a visible label and a hint below it. */
export function SwitchField({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 text-[0.8125rem] text-foreground">
      <EnableSwitch
        id={id}
        label={label}
        checked={checked}
        onChange={onChange}
      />
      <label htmlFor={id}>
        {label}
        <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground">
          {hint}
        </span>
      </label>
    </div>
  );
}
