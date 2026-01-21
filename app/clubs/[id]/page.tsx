import ClubDetailClient from '@/components/ClubDetailClient';

export default async function ClubDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id: clubId } = await params;

    return <ClubDetailClient clubId={clubId} />;
}