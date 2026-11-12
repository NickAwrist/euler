import { labelClass, selectClass } from "./constants";

export type Option<T extends number> = { id: T; name: string };

export function OptionSelect<T extends number>({
  id,
  label,
  value,
  options,
  slugs,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly Option<T>[];
  slugs: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="min-w-0 max-w-64 space-y-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select
        id={id}
        className={selectClass}
        value={slugs[value]}
        onChange={(event) => {
          const option = options.find(
            (candidate) => slugs[candidate.id] === event.target.value,
          );
          if (option) onChange(option.id);
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={slugs[option.id]}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}
