import { createApp } from "./app-factory";
import { runRssCronJob } from "./services/rss-cron-service";

const app = createApp();

const worker: ExportedHandler<Env> & { request: typeof app.request } = {
	fetch: app.fetch.bind(app),
	scheduled: (event, env, ctx) => {
		ctx.waitUntil(runRssCronJob(event, env));
	},
	request: app.request.bind(app),
};

export default worker;
