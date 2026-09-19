import type { APIRoute, GetStaticPaths } from "astro";
import { getSortedPosts, type Post } from "@/lib/posts";
import { markdownResponse, postToMarkdown } from "@/lib/markdown-export";

export const getStaticPaths = (async () =>
  (await getSortedPosts()).map((post) => ({ params: { slug: post.id }, props: { post } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => markdownResponse(postToMarkdown((props as { post: Post }).post));
