import { requireUser } from "@/lib/current-user";
import { listWorkspaces } from "@/lib/workspaces";
import { searchAll } from "@/lib/search/query";
import { SearchConsole } from "@/modules/search/components/SearchConsole";

export const metadata = {
  title: "Search · Sentinel OS",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const user = await requireUser();
  const workspaces = await listWorkspaces(user.id);
  const results = q
    ? await searchAll(user.id, workspaces.map((workspace) => workspace.id), q)
    : { task: [], agent: [], memory: [], workspace: [] };

  return <SearchConsole query={q ?? ""} results={results} />;
}
