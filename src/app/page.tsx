import { headers } from 'next/headers';
import LandingPage from '@/components/home/LandingPage';
import StudioHome from '@/components/home/StudioHome';
import { appPublicUrl, isStudioHost } from '@/lib/host-routing';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') || headerList.get('host');

  if (isStudioHost(host)) {
    return <StudioHome />;
  }

  return <LandingPage appUrl={appPublicUrl()} />;
}
