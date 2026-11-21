/** The store's logo, or its first letter on the brand colour. */
export function StoreLogo({
  name,
  src,
  size,
  className = '',
}: {
  name: string;
  src: string | null;
  size: number;
  className?: string;
}) {
  const style = { width: size, height: size, borderRadius: `calc(var(--store-radius) * 0.6)` };
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={style}
        className={`shrink-0 bg-(--store-surface) object-contain ring-1 ring-(--store-line) ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        ...style,
        backgroundColor: 'var(--store-primary)',
        color: 'var(--store-on-primary)',
        fontSize: size * 0.45,
      }}
      className={`store-display flex shrink-0 items-center justify-center ${className}`}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
