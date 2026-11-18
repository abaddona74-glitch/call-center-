import { createFileRoute } from '@tanstack/react-router';
import { ProfilePage } from '@/pages/profile';

/** Every signed-in user (operators too): own password, email, passkeys, sessions. */
export const Route = createFileRoute('/_app/profile')({
  component: ProfilePage,
});
