import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
  /** Text for screen readers; leave empty when a visible name sits next to it */
  label?: string;
}

/**
 * Qu Student logo ("Calendar Q"): a calendar whose corner turns into the tail of a Q.
 * The same artwork lives in public/icons/logo.svg (used for the Chrome icons).
 */
const Logo: React.FC<LogoProps> = ({ size = 44, className, label }) => (
  <svg
    className={className}
    viewBox="0 0 128 128"
    width={size}
    height={size}
    role={label ? 'img' : undefined}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : true}
    focusable="false"
  >
    <rect width="128" height="128" rx="30" fill="#0E7490" />
    <rect x="26" y="34" width="72" height="62" rx="14" fill="none" stroke="#FFFFFF" strokeWidth={9} />
    <path d="M46 24v16M78 24v16" fill="none" stroke="#FFFFFF" strokeWidth={9} strokeLinecap="round" />
    <path d="M26 56h72" fill="none" stroke="#FFFFFF" strokeWidth={7} />
    <rect x="37" y="66" width="22" height="18" rx="5" fill="#7FD3E3" />
    <path d="M80 78l24 24" fill="none" stroke="#0E7490" strokeWidth={21} strokeLinecap="round" />
    <path d="M80 78l24 24" fill="none" stroke="#FFFFFF" strokeWidth={11} strokeLinecap="round" />
  </svg>
);

export default Logo;
