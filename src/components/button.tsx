interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  className?: string;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
}: ButtonProps) {
  const base = "cta px-[16px] py-[12px] rounded cursor-pointer";
  const variants = {
    primary: "bg-accent-1 text-white hover:bg-accent-1-dark",
    secondary: "bg-accent-2-light text-accent-2 hover:bg-accent-2 hover:text-white",
  };
  const disabled_styles = disabled ? "opacity-50 cursor-not-allowed" : "";

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={`${base} ${variants[variant]} ${disabled_styles} ${className}`}
    >
      {children}
    </div>
  );
}
