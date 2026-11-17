import { cn } from '@/shared/lib/cn';

/**
 * Iconsax icon from the legacy sprite (public/icons/iconsax-sprite.svg), e.g. <Icon name="call" />.
 * Keeps the legacy look; lucide-react is fine for icons the sprite doesn't have.
 */
export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg className={cn('size-4 shrink-0', className)} aria-hidden="true">
      <use href={`/icons/iconsax-sprite.svg#isax-${name}`} />
    </svg>
  );
}
