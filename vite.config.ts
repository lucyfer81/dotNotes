import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

function getPackageName(id: string): string | null {
	const normalizedId = id.replace(/\\/g, "/");
	const marker = "/node_modules/";
	const index = normalizedId.lastIndexOf(marker);
	if (index === -1) {
		return null;
	}
	const packagePath = normalizedId.slice(index + marker.length);
	const segments = packagePath.split("/");
	if (segments.length === 0) {
		return null;
	}
	if (segments[0].startsWith("@")) {
		if (segments.length < 2) {
			return null;
		}
		return `${segments[0]}/${segments[1]}`;
	}
	return segments[0];
}

export default defineConfig({
	plugins: [
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tailwindcss(),
		reactRouter(),
		tsconfigPaths(),
	],
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					const packageName = getPackageName(id);
					if (!packageName) {
						return undefined;
					}
					if (packageName === "@uiw/react-codemirror") {
						return "editor-vendor";
					}
					if (packageName.startsWith("@codemirror/")) {
						return `editor-${packageName.split("/")[1]}`;
					}
					if (packageName.startsWith("@lezer/")) {
						return `editor-${packageName.split("/")[1]}`;
					}
					if (packageName === "codemirror" || packageName === "style-mod" || packageName === "w3c-keyname") {
						return "editor-support";
					}
					if (
						packageName === "react-markdown" ||
						packageName === "remark-gfm" ||
						packageName.startsWith("remark-") ||
						packageName.startsWith("rehype-") ||
						packageName.startsWith("micromark") ||
						packageName.startsWith("mdast-") ||
						packageName.startsWith("hast-") ||
						packageName.startsWith("unist-")
					) {
						return "markdown-vendor";
					}
					return undefined;
				},
			},
		},
	},
});
