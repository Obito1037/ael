// Adapted from Caho1/open-claude-ui/code-examples/CdsButton.tsx.
// Upstream commit and modifications are recorded in ../UPSTREAM.md.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface CdsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon';
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  isLoading?: boolean;
  indicator?: ReactNode;
}

export const CdsButton = forwardRef<HTMLButtonElement, CdsButtonProps>(function CdsButton(
  {
    variant = 'secondary', size = 'md', icon, iconPosition = 'left',
    isLoading = false, indicator, disabled = false, children, className = '',
    type = 'button', ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      data-cds="Button"
      data-variant={variant}
      data-size={size}
      aria-busy={isLoading || props['aria-busy'] || undefined}
      disabled={disabled || isLoading}
      className={`ael-cds-button cds-btn-squish ${className}`.trim()}
    >
      <span aria-hidden="true" data-cds-part="paint" />
      {isLoading ? <span className="ael-cds-spinner" aria-hidden="true" /> :
        icon && iconPosition === 'left' ? <span className="ael-cds-icon">{icon}</span> : null}
      {children && <span className="ael-cds-button-label">{children}</span>}
      {!isLoading && icon && iconPosition === 'right' && (
        <span className="ael-cds-icon">{icon}</span>
      )}
      {indicator && <span data-cds-part="indicator">{indicator}</span>}
    </button>
  );
});
