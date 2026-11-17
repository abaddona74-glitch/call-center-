import { Link } from '@tanstack/react-router';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[50svh] flex-col items-center justify-center gap-3">
      <p className="text-4xl font-semibold">404</p>
      <Link to="/" className="text-primary underline">
        ←
      </Link>
    </div>
  );
}
