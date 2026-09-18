import type { APIRoute, GetStaticPaths } from "astro";
import { getProjects, type Project } from "@/lib/posts";
import { markdownResponse, projectToMarkdown } from "@/lib/markdown-export";

export const getStaticPaths = (async () =>
  (await getProjects()).map((project) => ({ params: { slug: project.id }, props: { project } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  markdownResponse(projectToMarkdown((props as { project: Project }).project));
