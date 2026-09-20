import { Loader2 } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  ComponentType,
  ForwardedRef,
  ReactNode,
} from "react";
import { forwardRef } from "react";
import { cx } from "../styles";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ComponentType<{ size?: number; className?: string }>;
  iconPosition?: "left" | "right";
  children?: ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-accent font-semibold text-accent-foreground hover:bg-accent-hover active:scale-[0.985] active:brightness-[0.94]",
  secondary:
    "border border-border-subtle bg-transparent text-foreground hover:border-border hover:bg-muted active:scale-[0.99] active:bg-muted/80",
  danger:
    "bg-[#991b1b] font-semibold text-white hover:bg-[#b91c1c] active:scale-[0.985] active:brightness-[0.94]",
  ghost:
    "border border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.985]",
};

const sizeStyles: Record<ButtonSize, string> = {
  md: "px-3 py-2 text-[0.8125rem]",
  sm: "px-2.5 py-1.5 text-[0.75rem]",
};

export const Button = forwardRef(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    disabled = false,
    icon: Icon,
    iconPosition = "left",
    type = "button",
    className,
    children,
    ...rest
  }: ButtonProps,
  ref: ForwardedRef<HTMLButtonElement>,
) {
  const isDisabled = disabled || loading;
  const iconSize = size === "sm" ? 14 : 15;

  const iconElement = loading ? (
    <Loader2
      size={iconSize}
      className="animate-spin motion-reduce:animate-none shrink-0"
    />
  ) : Icon ? (
    <Icon size={iconSize} className="shrink-0" />
  ) : null;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg transition-[color,background-color,border-color,transform,filter] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
        variantStyles[variant],
        sizeStyles[size],
        loading && "opacity-80",
        className,
      )}
      {...rest}
    >
      {iconPosition === "left" && iconElement}
      {children}
      {iconPosition === "right" && iconElement}
    </button>
  );
});
