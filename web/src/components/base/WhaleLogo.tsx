/** DeepSeek 品牌鲸鱼标识：蓝色渐变圆底 + 白色鲸鱼，用于欢迎页与加载态 */
export const WhaleLogo = ({ size = 72 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <defs>
      <linearGradient id="whale-brand" x1="12" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
        <stop stopColor="#7C9BFF" />
        <stop offset="0.55" stopColor="#4D6BFE" />
        <stop offset="1" stopColor="#2A46D6" />
      </linearGradient>
    </defs>
    <circle cx="32" cy="32" r="30" fill="url(#whale-brand)" />
    <path
      d="M13 34.5c0-7.2 6.1-13 13.9-13 5 0 9.3 2.4 11.9 5.9l6.7-3.1-2.5 7.2 2.5 7.2-6.7-3.1c-2.6 3.5-6.9 5.9-11.9 5.9C19.1 41.5 13 38 13 34.5Z"
      fill="#fff"
      fillOpacity="0.97"
    />
    <circle cx="34.5" cy="29.5" r="1.7" fill="#2A46D6" />
    <path
      d="M20 47c3 2.2 7 3.4 11.4 3.4 5.2 0 9.8-1.6 12.9-4.3"
      stroke="#fff"
      strokeOpacity="0.5"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
)
