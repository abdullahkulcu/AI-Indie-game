export type GameIconName =
  | "divan"
  | "krallik"
  | "savas"
  | "diyar"
  | "general"
  | "istihbarat";

export default function GameIcon({
  name,
  label,
  className,
}: {
  name: GameIconName;
  label?: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      viewBox="0 0 512 512"
    >
      <use href={`/game-icons.svg#${name}`} />
    </svg>
  );
}
