import { redirect } from "next/navigation";

export default async function WorldPage({ searchParams }: { searchParams: Promise<{ cam?: string }> }) {
  const params = await searchParams;
  const cam = params.cam && /^[a-z-]{1,16}$/.test(params.cam) ? `?cam=${params.cam}` : "";
  redirect(`/${cam}`);
}
