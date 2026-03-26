import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("preview/:noteId", "routes/note-preview.tsx"),
	route("tags", "routes/tags.tsx"),
	route("ops", "routes/ops.tsx"),
] satisfies RouteConfig;
