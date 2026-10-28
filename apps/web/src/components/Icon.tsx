/** Path data of the icons in docs/design/app/ (24 px grid, drawn with a stroke). */
const PATHS = {
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
  logout: <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  small = false,
  className,
}: {
  name: IconName;
  small?: boolean;
  className?: string;
}) {
  const classes = ['icon', small ? 'icon--sm' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <svg className={classes} viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
