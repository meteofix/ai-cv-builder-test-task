/** Path data of the icons in docs/design/app/ (24 px grid, drawn with a stroke). */
const PATHS = {
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  logout: <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M9 7V4.5h6V7M6 7l1 13h10l1-13" />,
  retry: <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  up: <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />,
  down: <path d="M12 5v14M5.5 12.5 12 19l6.5-6.5" />,
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
