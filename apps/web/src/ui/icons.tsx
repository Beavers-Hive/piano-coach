import type { ReactNode } from "react";

/** 線の細いアイコン（外部のアイコンフォントは使わない）。 */
function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconOverview = () => (
  <Svg>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    <rect x="8.5" y="9" width="7" height="6" rx="1" />
  </Svg>
);
export const IconPlay = () => (
  <Svg>
    <path d="M4 17.5 8 7h8l4 10.5" />
    <path d="M7 12.5h10M9 7v10.5M15 7v10.5" opacity=".55" />
  </Svg>
);
export const IconCloseup = () => (
  <Svg>
    <circle cx="10.5" cy="10.5" r="5.5" />
    <path d="m15 15 5 5M10.5 8v5M8 10.5h5" />
  </Svg>
);
export const IconDemo = () => (
  <Svg size={16}>
    <path d="M7 5.5v13l11-6.5z" fill="currentColor" />
  </Svg>
);
export const IconUpload = () => (
  <Svg>
    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v4h14v-4" />
  </Svg>
);
export const IconCheck = ({ size = 12 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const IconClose = () => (
  <Svg size={14}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);
export const IconAlert = () => (
  <Svg size={18}>
    <path d="M12 4 2.8 19.5h18.4z" />
    <path d="M12 10v4.5M12 17.4v.1" />
  </Svg>
);
export const IconKeys = () => (
  <Svg size={20}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M8 6v12M13 6v12M18 6v12" opacity=".6" />
    <path d="M7 6v6.5h2V6M12 6v6.5h2V6" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconStar = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="m12 2.5 2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.6 5.9 21.1l1.4-6.8L2.2 9.6l6.9-.8z" />
  </svg>
);

/** ロゴの印。鍵盤のかたち（白鍵 4 本と黒鍵 3 本）。 */
export const LogoMark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id="lm-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#7fe8ff" />
        <stop offset="1" stopColor="#4a8dff" />
      </linearGradient>
    </defs>
    <rect
      x="2"
      y="3"
      width="28"
      height="26"
      rx="6"
      fill="url(#lm-g)"
      opacity=".16"
    />
    <rect
      x="2.75"
      y="3.75"
      width="26.5"
      height="24.5"
      rx="5.25"
      fill="none"
      stroke="url(#lm-g)"
      strokeWidth="1.5"
    />
    <path
      d="M10.5 4v21M16 4v21M21.5 4v21"
      stroke="#7fe8ff"
      strokeWidth="1"
      opacity=".45"
    />
    <rect x="8" y="4" width="5" height="13" rx="1.4" fill="#e9fbff" />
    <rect x="19" y="4" width="5" height="13" rx="1.4" fill="#ff5fb0" />
  </svg>
);
