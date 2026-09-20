import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ComponentType, ForwardedRef } from "react";
import { forwardRef } from "react";
import { cx } from "../styles";

export type IconButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type IconButtonSize = "sm" | "md";

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ComponentType<{ size?: number; className?: string }>;
  label?: string;
  loading?: boolean;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

const variantStyles: Record<IconButtonVariant, string> = {
  primary:
    "bg-accent font-semibold text-accent-foreground hover:bg-accent-hover active:scale-[0.985] active:brightness-[0.94]",
  secondary:
    "border border-border-subtle bg-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground active:scale-[0.96] active:bg-muted/70",
  ghost:
    "border border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.96] active:bg-muted/70",
  danger:
    "border border-transparent bg-transparent text-red-400 hover:border-red-500/20 hover:bg-red-500/[0.06] hover:text-red-300 active:scale-[0.96]",
};

const sizeStyles: Record<IconButtonSize, { box: string; icon: number }> = {
  md: { box: "size-9 rounded-lg", icon: 17 },
  sm: { box: "size-8 rounded-md", icon: 15 },
};

export const IconButton = forwardRef(function IconButton(
  {
    icon: Icon,
    label,
    loading = false,
    disabled = false,
    variant = "secondary",
    size = "md",
    type = "button",
    title,
    className,
    ...rest
  }: IconButtonProps,
  ref: ForwardedRef<HTMLButtonElement>,
) {
  const isDisabled = disabled || loading;
  const sizeConfig = sizeStyles[size];

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
      aria-label={label ?? rest["aria-label"] ?? title}
      title={title ?? label ?? rest["aria-label"]}
      className={cx(
        "inline-flex items-center justify-center transition-[color,background-color,border-color,transform] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
        sizeConfig.box,
        variantStyles[variant],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2
          size={sizeConfig.icon}
          className="animate-spin motion-reduce:animate-none shrink-0"
        />
      ) : (
        <Icon size={sizeConfig.icon} />
      )}
    </button>
  );
});
